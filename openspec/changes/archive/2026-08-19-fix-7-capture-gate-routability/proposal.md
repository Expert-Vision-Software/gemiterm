## Why

The capture gate (`CookieSession.waitForGate`, `src/auth/cookie-session.ts:286-307`) polls until cookies **named** `__Secure-1PSID` and `__Secure-1PSIDTS` appear — with no routability check. A persistent Chromium profile that already carries a `.youtube.com`-scoped `__Secure-1PSIDTS` (a normal jar shape — jars carry both scopes; `docs/auth-cookie-lifecycle.md` §2.1) satisfies the gate the instant the page loads, *before* Gemini's page JS has set the `.google.com`-scoped one. `state-save` can then snapshot the youtube-only state, and `captureLogin` persists a jar whose `__Secure-1PSIDTS` is not routable to `gemini.google.com`. Field repro (2026-08-18, DHBGAMING2, profile `evs-diegohb`): `auth --renew` printed "Session renewed… (36 cookies captured)" yet the very next `fetch -p evs-diegohb` failed with `SessionValidationError: Cookie __Secure-1PSIDTS … not routable … present scopes: [.youtube.com]`, and a renew/fetch loop persisted across renew attempts. The renew reported success while persisting a jar the CLI's own validator rejects — a self-inflicted variant of the A2.2 anti-pattern (persisting from a not-actually-authed page state).

The repo already settled the selection principle (auth spec:105): armed values MUST be RFC-6265-routable to `gemini.google.com`. The gate is the one cookie-observing surface still keying on bare name presence.

## What Changes

- `waitForGate` requires `__Secure-1PSID` and `__Secure-1PSIDTS` **routable to `https://gemini.google.com`** (RFC 6265 domain/path/expiry via the existing `isRoutableTo` helper) before opening the gate — name-matching rows at other scopes no longer satisfy it.
- Backstop: immediately before `saveFullJar`, the filtered payload MUST pass `CookieValidator.validate`; a failing payload MUST NOT be persisted, and `captureLogin` rejects with a new typed error (`LoginUnroutableError`) — the pre-existing jar is preserved byte-for-byte.
- On gate timeout without a routable pair, `captureLogin` rejects with the same typed error (naming the unroutable-scope condition) instead of `LoginTimeoutError`; the existing `LoginTimeoutError` path remains for all other timeout shapes.
- The capture payload policy is unchanged: full jar, domain-filtered (`filterToGeminiDomains`), never name-filtered. The gate gets stricter; the payload does not get narrower.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `auth`: `CookieSession.captureLogin captures the full browser jar (gate is not payload)` — gate satisfaction requires gemini-routable cookies; unroutable-payload persistence is prohibited with a typed failure.

## Impact

- Code: `src/auth/cookie-session.ts` (`waitForGate`, `captureLogin`), `src/core/errors.ts` (new `LoginUnroutableError`), `src/auth/cookie-validation.ts` (reuse only).
- Tests: `tests/auth-regression/invariant-capture-integrity.test.ts` (new block: youtube-only PSIDTS never satisfies the gate; unroutable payload never persisted; existing jar byte-preserved), gate-loop unit tests.
- Docs: `docs/auth-cookie-lifecycle.md` changelog entry.
- Sequencing: second of three (`fix-6-classifier-token-extraction` → this → `fix-8-stale-profile-reachability`). Independent of fix-6 mechanically; lands after it to keep diffs reviewable per cluster.
