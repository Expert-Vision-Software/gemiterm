# prevent-auth-complexities

**Branch:** `prevent-auth-complexities`
**Status:** In progress
**Date:** 2026-08-09

## Why

Post-v2.4.0 auth work on `main` (and the `phase0-v2/regression-net` series) layered four defensive mechanisms on top of the cookie store:

1. `CookieMonitor` trimmed the browser jar to `REQUIRED_COOKIES` (PSID + PSIDTS) before persisting ([src/services/cookie-monitor.ts](src/services/cookie-monitor.ts) — fixed in `6bc51f6`).
2. `ProfileManager.hasValidCookies` (renamed to `hasRequiredCookies` in this change) gated on a **7-day PSIDTS freshness threshold** via `checkCookieFreshness` ([src/infrastructure/storage.ts](src/infrastructure/storage.ts) — fixed in this change).
3. `ensureAuthenticated` added a server-side `models()` probe that, on stale results, escalated to a headless `silentRefresh` ([src/services/profile-auth-manager.ts](src/services/profile-auth-manager.ts) — not present on this branch).
4. `RotateCookies` L1 escalation ladder layered on top ([src/services/cookie-rotation.ts](src/services/cookie-rotation.ts) — not present on this branch).

Items 1 and 2 are **necessary** — they fix real bugs (lost companion cookies, dormant-session force-prompt). Items 3 and 4 are **overcorrection** — built to detect/rotate symptoms of bugs 1 and 2 that no longer exist once 1 and 2 are fixed.

The user-facing symptom this change eliminates: a dormant user (e.g., 30 days idle) whose PSID cookie is still server-valid was being force-prompted to re-authenticate because `checkCookieFreshness` returned `false` when `PSIDTS.expires < now + 7 days`. With the freshness gate removed, dormant sessions load successfully and only fail on an actual 401 from the API.

## What Changes

- **Drop the 7-day freshness gate from `hasValidCookies` and `loadCookiesForApi` in [src/infrastructure/storage.ts](src/infrastructure/storage.ts).** The methods now trust the cookies: presence of `__Secure-1PSID` and `__Secure-1PSIDTS` is the only requirement. No expiry threshold is consulted.
- **Rename `hasValidCookies` → `hasRequiredCookies` in `ProfileManager`.** The new name reflects what the method actually checks (presence of required cookie names, not "validity").
- **Remove dead code: `checkCookieFreshness` and the `COOKIE_EXPIRY_THRESHOLD_MS` constant in [src/services/cookie-storage-service.ts](src/services/cookie-storage-service.ts) and [tests/services/cookie-storage-service.test.ts](tests/services/cookie-storage-service.test.ts).** No callers remain on this branch.
- **Update tests** in [tests/infrastructure/storage.test.ts](tests/infrastructure/storage.test.ts) and [tests/services/profile-auth-manager.test.ts](tests/services/profile-auth-manager.test.ts) to assert the new "trust cookies" semantics. Expired cookies now report as `hasRequiredCookies=true` and `loadCookiesForApi` returns the cookie values instead of throwing.

## Capabilities

### Modified Capabilities

- **`auth`** ([openspec/specs/auth/spec.md](openspec/specs/auth/spec.md)) — remove the 7-day PSIDTS freshness requirement from the session-validation requirement. The new posture: cookies present → trust them. Real session death is detected by an actual 401 from the Gemini API, not by a local freshness heuristic.
- **`storage`** ([openspec/specs/storage/spec.md](openspec/specs/storage/spec.md)) — `ProfileManager.hasRequiredCookies` returns `true` when both `__Secure-1PSID` and `__Secure-1PSIDTS` are present, regardless of expiry. `loadCookiesForApi` returns the cookie values without consulting a freshness threshold.

## Impact

- **Code touched**
  - `src/infrastructure/storage.ts` — removed `checkCookieFreshness`, removed `COOKIE_EXPIRY_THRESHOLD_MS`, renamed `hasValidCookies` → `hasRequiredCookies`, simplified `hasValidCookies` body and `loadCookiesForApi` body.
  - `src/services/cookie-storage-service.ts` — removed `checkCookieFreshness` method, removed `COOKIE_EXPIRY_THRESHOLD_MS` constant.
  - `src/cli/index.ts`, `src/services/profile-auth-manager.ts`, `src/services/profile-service.ts` — call-site renames.
  - `tests/infrastructure/storage.test.ts`, `tests/services/profile-auth-manager.test.ts`, `tests/services/cookie-storage-service.test.ts` — updated assertions and renamed tests.

- **Out of scope (follow-up work)**
  - **401-triggered recovery is not implemented.** The new posture says "trust cookies; recover on 401," but the current `AuthError` → `AuthenticationError` translation in [src/services/gemini-client-wrapper.ts:178-184](src/services/gemini-client-wrapper.ts#L178-L184) has no recovery path. A dormant session with server-valid cookies will work; a session that actually returns 401 will surface `AuthenticationError` instead of auto-recovering. This is a separate change.
  - **`persistRefreshedCookies` still writes `expires = now + 7 days`** when persisting SDK-rotated cookies ([src/services/gemini-client-wrapper.ts:132-144](src/services/gemini-client-wrapper.ts#L132-L144)). Since the freshness gate is now removed, this 7-day hint is informational only — it does not gate any auth path. A future change may bump it to the one-year horizon that matches actual PSIDTS lifetime.
  - **`getStatus.isActive` still applies a hard past-expiry filter** ([src/infrastructure/storage.ts:147-157](src/infrastructure/storage.ts#L147-L157)). This is display-only and reports inactive for cookies past their `expires` timestamp. The auth path does not consult `isActive`. A future change may remove this filter for display consistency.
  - **`hasRequiredCookies` still requires `__Secure-1PSIDTS` presence.** `loadCookiesForApi` treats PSIDTS as nullable (it falls back to `null` when missing). A future change may relax `hasRequiredCookies` to only require PSID.
  - **Missing `cookie-rotation.ts` module on this branch.** [src/services/cookie-monitor.ts:4](src/services/cookie-monitor.ts#L4) imports a module that does not exist. Pre-existing on `2076e52`; causes 4 smoke-test failures and 4 unhandled errors. Independent of this change.
