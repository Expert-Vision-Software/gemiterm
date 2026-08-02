## Why

Users must manually run `gemiterm auth --renew` when sessions are about to expire, and must manually re-run `gemiterm login` when sessions have expired. The CLI should handle both proactively — silently extending the session when possible, and prompting for re-authentication only when necessary. This eliminates two manual friction points in the daily workflow.

## What Changes

- **Auto-extend**: When `checkCookieFreshness` reports cookies are within the 1-hour grace window, `ProfileAuthManager.ensureAuthenticated()` silently attempts a headless browser refresh before rejecting the session. If successful, the user sees a brief "Session auto-refreshed" message and the operation proceeds transparently. If the user is logged out on Google's side, the auto-extend fails silently and falls through to prompt-to-reauth.
- **Prompt-to-reauth**: When `AuthenticationError` is thrown (fully expired session or auto-extend failed), the CLI intercepts it before the generic error handler, presents a confirm prompt ("Session expired. Re-authenticate?"), and on `yes` launches a headed browser for manual login. On success, the failed operation is retried. On `no` or non-TTY mode, the error propagates as today.
- `AuthService` gains a `silentRefresh()` method that launches a headless browser, loads existing cookies via `stateLoad`, monitors for login with a 30s timeout, and returns success/failure.
- `PlaywrightCliDriver` gains an `openHeadless()` method (launches without `--headed` flag) for the silent auto-extend flow.
- `checkCookieFreshness` is exported from `storage.ts` so `ProfileAuthManager` can query freshness without duplicating logic.
- The reauth prompt uses the existing prompt facade (`src/cli/utils/prompts.ts`), respecting TTY gating and `--non-interactive` mode.

## Capabilities

### New Capabilities
- `auto-extend`: Silent headless session refresh when cookies are near expiry, transparent to the user. Attempted before rejecting a session in `ensureAuthenticated()`.
- `reauth-prompt`: Intercept `AuthenticationError` before the CLI error handler, present a confirm prompt via the prompt facade, and on approval launch a headed re-authentication flow. Respects non-interactive mode.

### Modified Capabilities
- `auth`: `AuthService` gains `silentRefresh(profileName)` — headless browser launch, existing cookie pre-load, `CookieMonitor` with 30s timeout, returns success/failure. `PlaywrightCliDriver` gains `openHeadless()`.
- `profiles`: `ProfileAuthManager.ensureAuthenticated()` calls auto-extend before throwing; `autoExtendSession(profileName)` added as public method.
- `storage`: `checkCookieFreshness` exported as public function so `ProfileAuthManager` can query freshness state without duplicating the 1-hour threshold logic.


## Impact

- **Source files**: `src/services/auth-service.ts` (silentRefresh), `src/services/playwright-cli-driver.ts` (openHeadless), `src/services/profile-auth-manager.ts` (autoExtendSession, ensureAuthenticated rewrite), `src/infrastructure/storage.ts` (export checkCookieFreshness), `src/cli/index.ts` (AuthenticationError interception, reauth prompt, operation retry), `src/cli/utils/prompts.ts` (no change — existing confirm reused)
- **Test files**: `tests/services/auth-service.test.ts`, `tests/services/playwright-cli-driver.test.ts`, `tests/services/profile-auth-manager.test.ts`, `tests/infrastructure/storage.test.ts`, `tests/cli/index.test.ts`
- **Dependency**: This change depends on `auth-cookie-freshness-fix` being implemented first — the 1-hour grace window from that change enables the auto-extend detection threshold.
