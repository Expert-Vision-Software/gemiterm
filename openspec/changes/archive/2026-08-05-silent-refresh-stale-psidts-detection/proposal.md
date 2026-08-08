## Why

`ProfileAuthManager.ensureAuthenticated` probes server-side session validity with `geminiClient.models()`. The `models()` RPC only requires `__Secure-1PSID`, so a server-side rotation of `__Secure-1PSIDTS` (which Google performs silently) is invisible to the probe: `models()` succeeds, the probe classifies the session as "valid", and no `silentRefresh` fires. But `listChats` (and other PSIDTS-requiring RPCs) then return empty, producing the user's production symptom — `list -i` showing 0 chats despite an "authenticated" log line. The probe has a blind spot exactly where the user's symptom lives.

## What Changes

- In `ProfileAuthManager.ensureAuthenticated` (`src/services/profile-auth-manager.ts`), unconditionally invoke `silentRefresh(name)` (which performs the L1 `RotateCookies` POST) when local cookies are valid, **independent of the `models()` probe outcome**. The existing 600 s disk-mtime guard inside `silentRefresh`/`rotateCookies` (`src/services/cookie-rotation.ts`) prevents abuse on rapid repeat calls.
- The `models()` probe is retained for the hard-failure path: when `models()` throws (session truly dead), `silentRefresh` must recover the session or `ensureAuthenticated` throws `AuthenticationError`.
- On the probe-success path, the rotation is best-effort: a rotation failure (e.g., network) does NOT throw, because `models()` confirmed the session is usable; the rotation's job is to refresh a stale `__Secure-1PSIDTS` so PSIDTS-requiring RPCs work.
- Update the spec-encoding tests that assert "`silentRefresh` is NOT called when `models()` succeeds" (`tests/services/profile-auth-manager.test.ts:511` "models() succeeds ... no silent refresh" and the probe-budget assertions at `:610`; `tests/services/phantom-auth.test.ts:234` "models() succeeds means session is valid; no silent refresh spent" and the budget test at `:262`).
- Fold in the missing CHANGELOG credit for Proposal A (commit `65b0c38`: `mergeCookies` upsert, `resolveCookie` `.google.com`-preference, `requireRotation` domain-preferring check) under the v2.6.1 entry — these shipped in v2.6.1 but are undocumented.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `phantom-auth-detection`: The probe-success path no longer skips refresh. `ensureAuthenticated` MUST attempt a cookie rotation (L1, via `silentRefresh`) whenever local cookies are valid, regardless of the `models()` probe outcome; the 600 s disk-mtime guard throttles actual rotation. The "models() succeeds — session valid, no refresh" scenario is replaced.

## Impact

- **Code**: `src/services/profile-auth-manager.ts` (`ensureAuthenticated` at `:72-103`; `probeServerSession` at `:126-146` is retained for the hard-fail path).
- **Dependencies**: reuses existing `silentRefresh` (`AuthService`) and `rotateCookies` (`src/services/cookie-rotation.ts`); no new RPCs.
- **Tests**: `tests/services/profile-auth-manager.test.ts`, `tests/services/phantom-auth.test.ts` — the probe-success and probe-budget tests that assert zero refreshes must be updated to assert a rotation is attempted (the `silentRefresh` mock is invoked). The 438 lines of existing phantom-auth assertions MUST NOT be weakened.
- **Behavior**: PSIDTS-requiring RPCs work again after a silent server-side token rotation; `list`/`list -i` show the real chat count.
- **CHANGELOG**: v2.6.1 entry gains the Proposal A credit.
