# Design — fix-7-capture-gate-routability

## Context

`waitForGate` (`src/auth/cookie-session.ts:286`) gates capture on `names.has(PSID) && names.has(PSIDTS)` — set-of-names, ignoring domain/path. Persistent profiles legitimately carry PSIDTS at both `.youtube.com` and `.google.com` scopes (spec `auth:105` documents the sibling rows and already mandates routable selection everywhere else). When a renew opens on a profile whose browser DB already has a youtube-scoped PSIDTS, the gate can pass before the gemini page JS mints the `.google.com` one; the subsequent `state-save` snapshot then yields a jar with no gemini-routable PSIDTS. `CookieValidator.validate` (`src/auth/cookie-validation.ts:86-97`) hard-rejects exactly that jar on every later `ensureSession`, so the profile is bricked while renew reports success — the DHBGAMING2 `evs-diegohb` field repro.

The hard rules constrain the fix: no cookie-name filtering may enter the capture path (payload stays full-jar domain-filtered), and the dual-state doctrine (§2.4: export only from a confirmed-authed page state) is exactly what the gate must enforce.

## Goals / Non-Goals

**Goals**
- Renew/login can never persist a jar that the CLI's own validator rejects.
- The gate's notion of "signed in" matches the rest of the codebase: routable to `gemini.google.com`.
- Fail loud and typed, preserving the prior jar, so the user's next action is unambiguous.

**Non-Goals**
- Widening or narrowing the capture payload (domain filter unchanged).
- Fixing the stale-profile read paths (fetch/list/continue reachability) — fix-8.
- Reauthenticating automatically on gate failure — the user is already in a headed browser; the typed error tells them what happened.

## Decisions

1. **Gate on routable pair, via `isRoutableTo`.** `waitForGate` polls `driver.cookieList(session)` and passes only when `PSID` and `PSIDTS` are each routable to `GEMINI_APP_URL` (`isRoutableTo(c, GEMINI_APP_URL)` — same helper the validator and `findRoutableCookieValue` use). Rationale: one routability definition across the codebase; reuses `cookie-validation.ts`, no new RFC-6265 code. Alternative considered — gate on PSIDTS routable + PSID name-present (looser): rejected, asymmetric gates invite the same class of bug for PSID.
2. **Typed error `LoginUnroutableError`, thrown on both failure shapes.** (a) Gate timeout with cookies observed but none routable; (b) pre-save backstop failure. Rationale: one typed cause for "capture never observed a gemini-routable session"; the CLI top-level handler renders it as a friendly message (same pattern as `LoginCancelledError`, change `cancel-auth-on-browser-close`). Plain `LoginTimeoutError` remains for the no-cookies-at-all shape (user never signed in).
3. **Pre-save `validate` backstop despite the stricter gate.** The gate passing does not guarantee the `state-save` snapshot is good — the snapshot is a second observation of a moving jar (gate reads `cookie-list`; payload reads `state-save`). Revalidating the filtered payload closes the TOCTOU window at the cost of one in-process call. On backstop failure: no `saveFullJar`, prior jar untouched, typed error. Rationale: the A2.2 anti-pattern ("never persist from an unconfirmed-authed state") is enforced at the write site, which is the only place that matters.
4. **User-settled strictness:** accounts that legitimately set only a `.youtube.com`-scoped PSIDTS would become unrenewable. Never observed (normal jars carry both scopes; ablation §2.1) and the field alternative silently bricks profiles. Accepted per review decision 2026-08-18.

## Risks / Trade-offs

- [Google slow to mint the `.google.com` scope → gate waits longer, renew feels slower] → bounded by the existing 5-minute timeout; the wait is the correct behavior (§2.4 export-from-authed-only).
- [Backstop false-positive rejects a good jar (validator too strict)] → validator semantics are unchanged and battle-tested by `ensureSession`; a backstop firing means the jar genuinely fails arming.
- [`LoginUnroutableError` new exit path in `AuthCommand`] → reuse the `LoginCancelledError` rendering seam; covered in invariant tests.

## Migration Plan

Single PR; no persisted-state migration (bad jars are the bug; users re-run `auth --renew`, which now either persists a good jar or fails without destroying the old one). Rollback = revert.

## Open Questions

(none — strictness settled by user decision; error naming follows the `Login*Error` family.)
