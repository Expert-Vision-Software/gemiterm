## Context

`ProfileAuthManager.ensureAuthenticated` (`src/services/profile-auth-manager.ts:72-103`) currently:

1. Validates local cookies (`hasValidCookies`); if invalid, calls `autoExtendSession` (which calls `silentRefresh` on near-expiry jars).
2. Calls `probeServerSession(name)` (`:126-146`), which runs `geminiClient.forProfile(name).models()`.
3. If the probe classifies "stale" (`models()` threw) → calls `silentRefresh(name)`; on success returns refreshed cookies, on failure throws `AuthenticationError`.
4. If the probe classifies "valid" (`models()` succeeded) → returns loaded cookies, **no refresh**.

The blind spot: `models()` is a PSID-only RPC. Google silently rotates `__Secure-1PSIDTS` server-side while the local jar still holds the previous (locally-fresh-looking) value. `models()` succeeds, the probe says "valid", no refresh fires — but PSIDTS-requiring RPCs (`listChats`) then return empty. This is the user's "0 chats while authenticated" symptom.

The L1 rotation (`rotateCookies`, `src/services/cookie-rotation.ts`) POSTs to `accounts.google.com/RotateCookies` and refreshes `__Secure-1PSIDTS`. It is already gated by a 600 s disk-mtime guard (Google's recommended rotation interval) and an in-process throttle. `AuthService.silentRefresh` runs L1 first, then an L2 headless-browser ladder.

Constraints:
- The 600 s guard already prevents rotate-spam — `ensureAuthenticated` may call `silentRefresh` every time without abusing the endpoint.
- The `models()` probe must remain for the hard-failure path (dead `__Secure-1PSID` → `models()` throws → must refresh or throw).
- Existing phantom-auth assertions (438 lines across two files) must not be weakened.

## Goals / Non-Goals

**Goals**
- A stale `__Secure-1PSIDTS` is refreshed before `ensureAuthenticated` returns, so PSIDTS-requiring RPCs work.
- No new endpoint, no new RPC; reuse L1 `rotateCookies` via `silentRefresh`.
- Keep the 600 s guard as the abuse throttle.

**Non-Goals**
- Replacing the `models()` probe (it still detects hard session death).
- Adding a `listChats`-based probe (regressive — would require the retired `profile-has-chats` marker).
- Changing the `generateContent`-based probe option (too expensive; rejected in favor of option b).

## Decisions

### Decision 1: Unconditional L1 rotation on the valid-cookies path (option b, user-confirmed)

In `ensureAuthenticated`, after the `models()` probe runs, call the injected `rotateCookies(name)` (the L1 `RotateCookies` POST only) regardless of the probe outcome. Concretely the success path becomes: probe → `rotateCookies(name)` (L1, 600 s-guarded, no browser) → return loaded cookies. The full `silentRefresh` ladder (L1 + L2 headless browser) is reserved for the stale-probe path (`models()` threw → genuinely dead session).

**Rationale**: The 600 s disk-mtime guard inside `rotateCookies` already throttles, so calling it on every valid-cookie `ensureAuthenticated` is safe and is the smallest behavioral change that closes the blind spot. It reuses the existing, tested L1 path.

**Critical distinction discovered during smoke testing**: `silentRefresh` is the full L1→L2 ladder — when L1 returns `false` (including a 600 s-guard skip or an identical-noop), it falls through to the L2 headless browser. Calling `silentRefresh` on the valid path therefore launched a ~30 s browser on every command once the guard began skipping L1 — a severe UX regression. Option (b) as specified is `rotateCookies` (L1 POST) only, which never launches a browser. A new `rotateCookies` dependency (backed by `AuthService.rotateCookies`) is injected into `ProfileAuthManager` for this path; `silentRefresh` remains for the stale path.

**Alternatives considered** (from the diagnostic handoff):
- **(a) Augment probe with `listChats({limit:1})`** — rejected; requires reviving the `profile-has-chats` marker that Proposal B deliberately retired (regressive).
- **(c) Probe with a 1-token `generateContent` call** — most definitive signal, but most expensive per check; rejected as disproportionate.
- **(d) Round-trip `RotateCookies` and diff the returned `1PSIDTS` against the stored value** — essentially what L1 already does; option (b) simply ensures it always runs.

### Decision 2: Rotation failure on the probe-success path is non-fatal

When the probe says "valid" (`models()` succeeded), a failed rotation (network error, or 600 s guard skip) MUST NOT throw — `models()` proved the session is usable for PSID-only calls, and throwing would mis-report a working session as unauthenticated. The rotation is best-effort freshness.

When the probe says "stale" (`models()` threw), a failed `silentRefresh` MUST still throw `AuthenticationError` (existing behavior preserved).

### Decision 3: Keep the probe cache for the `models()` call

The 150 s TTL probe cache (`GEMITERM_PROBE_TTL_MS`) stays to avoid repeated `models()` RPCs across rapid `ensureAuthenticated` calls. The rotation has its own independent 600 s guard, so the two throttles do not interfere.

## Risks / Trade-offs

- **[Extra round-trip] Every `ensureAuthenticated` now issues a `rotateCookies` call** → the 600 s guard means a real `RotateCookies` POST happens at most once per 10 min per profile; sub-threshold calls return early without network I/O. No browser is ever launched on this path.
- **[Test semantics] `rotateCookies` mocks in tests have no guard** → the probe-success / probe-budget tests assert `rotateCookies` IS called (and `silentRefresh` is NOT, on the valid path). This is the intended behavior change.
- **[Residual edge case] `models()` succeeds but L1 rotation fails (e.g. 401 for a day-old `__Secure-1PSIDTS`) and the session's token is too degraded for L1** → the user still sees 0 chats until re-auth; L1 cannot recover a fully stale token, and escalating to the L2 browser on every command was rejected (UX regression). Such a session must be recovered via the stale path (`models()` eventually throwing) or an explicit `login`. Confirmed against the stale `.gemiterm` smoke profiles.
- **[Probe/rotate ordering] `rotateCookies` after the probe means up to two server round-trips on a cache miss** → the probe cache (150 s) and the rotate guard (600 s) bound the steady-state cost.

## Migration Plan

Single-PR, backwards-compatible at the CLI surface. No data/config migration. Ship in the same patch release as the other two bugfixes; the CHANGELOG entry for v2.6.1 is amended (Proposal A credit) and a v2.6.2 entry is added for the three fixes.

## Open Questions

None. (Option b was user-confirmed; the rotation's 600 s guard and in-process throttle already exist and are tested.)
