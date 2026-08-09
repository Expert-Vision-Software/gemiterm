# prevent-auth-complexities

**Branch:** `prevent-auth-complexities`
**Status:** Ship-ready
**Date:** 2026-08-09

## Why

Post-v2.4.0 auth work on `main` (and the `phase0-v2/regression-net` series) layered four defensive mechanisms on top of the cookie store:

1. `CookieMonitor` trimmed the browser jar to `REQUIRED_COOKIES` (PSID + PSIDTS) before persisting ([src/services/cookie-monitor.ts](src/services/cookie-monitor.ts) — fixed in `6bc51f6`).
2. `ProfileManager.hasRequiredCookies` (formerly `hasValidCookies`) gated on a **7-day PSIDTS freshness threshold** via `checkCookieFreshness` ([src/infrastructure/storage.ts](src/infrastructure/storage.ts) — fixed in this change).
3. `ensureAuthenticated` added a server-side `models()` probe that, on stale results, escalated to a headless `silentRefresh` ([src/services/profile-auth-manager.ts](src/services/profile-auth-manager.ts) — not present on this branch).
4. `RotateCookies` L1 escalation ladder layered on top ([src/services/cookie-rotation.ts](src/services/cookie-rotation.ts) — not present on this branch; the L1/L2 import residue in `CookieMonitor` was also removed in this change).

Items 1 and 2 are **necessary** — they fix real bugs (lost companion cookies, dormant-session force-prompt). Items 3 and 4 are **overcorrection** — built to detect/rotate symptoms of bugs 1 and 2 that no longer exist once 1 and 2 are fixed.

The user-facing symptom this change eliminates: a dormant user (e.g., 30 days idle) whose PSID cookie is still server-valid was being force-prompted to re-authenticate because `checkCookieFreshness` returned `false` when `PSIDTS.expires < now + 7 days`. With the freshness gate removed, dormant sessions load successfully and only fail on an actual 401 from the API.

## What Changes

- **Drop the 7-day freshness gate from `hasRequiredCookies` and `loadCookiesForApi` in [src/infrastructure/storage.ts](src/infrastructure/storage.ts).** The methods now trust the cookies: presence of `__Secure-1PSID` is the only requirement. No expiry threshold is consulted.
- **Relax to PSID-only.** `validateCookies` in [src/infrastructure/storage.ts](src/infrastructure/storage.ts) and [src/services/cookie-storage-service.ts](src/services/cookie-storage-service.ts) now checks for `__Secure-1PSID` only, matching `loadCookiesForApi` (which already treated PSIDTS as nullable).
- **Rename `hasValidCookies` → `hasRequiredCookies` in `ProfileManager`.** The new name reflects what the method actually checks (presence of the required cookie name, not "validity").
- **Remove dead code: `checkCookieFreshness` and the `COOKIE_EXPIRY_THRESHOLD_MS` constant in [src/services/cookie-storage-service.ts](src/services/cookie-storage-service.ts) and [tests/services/cookie-storage-service.test.ts](tests/services/cookie-storage-service.test.ts).** No callers remain on this branch.
- **Remove dead `requireRotation` parameter and the `isGoogleDomainCookie` import from [src/services/cookie-monitor.ts](src/services/cookie-monitor.ts).** The parameter has no callers; the `cookie-rotation.ts` module it imports from never landed on this branch. This unblocks 4 pre-existing test failures (3 smoke + 1 continue-command) and restores the full `bun test` suite to green.
- **Bump `persistRefreshedCookies` saved-`expires` horizon from 7 days to 1 year** in [src/services/gemini-client-wrapper.ts](src/services/gemini-client-wrapper.ts). The 7-day horizon was tied to the removed freshness gate; with the gate gone it is purely an on-disk display field, and 1 year matches the actual PSID server-issued horizon.
- **Remove the hard past-expiry filter from `getStatus.isActive` in [src/infrastructure/storage.ts](src/infrastructure/storage.ts).** `isActive` is now `hasRequired`; the `expiresAt` field still shows the on-disk expiry timestamp for user reference.
- **Improve the 401-triggered `AuthError` → `AuthenticationError` message in [src/services/gemini-client-wrapper.ts](src/services/gemini-client-wrapper.ts).** The new message names the profile and points to the correct re-auth command: ``Session for profile '<name>' is no longer valid (Gemini returned 401). Run 'gemiterm auth <name>' to re-authenticate.``
- **Update tests** in [tests/infrastructure/storage.test.ts](tests/infrastructure/storage.test.ts), [tests/services/profile-auth-manager.test.ts](tests/services/profile-auth-manager.test.ts), [tests/services/cookie-storage-service.test.ts](tests/services/cookie-storage-service.test.ts), and [tests/services/gemini-client-wrapper.test.ts](tests/services/gemini-client-wrapper.test.ts) to assert the new "trust cookies" semantics, the PSID-only requirement, the new `isActive` rule, and the new 401 message.

## Capabilities

### Modified Capabilities

- **`auth`** ([openspec/changes/prevent-auth-complexities/specs/auth/spec.md](openspec/changes/prevent-auth-complexities/specs/auth/spec.md)) — remove the 7-day PSIDTS freshness requirement from the session-validation requirement; relax the required-cookie set to `__Secure-1PSID` only; require that 401 responses surface an actionable, profile-specific `AuthenticationError` message. The new posture: cookies present → trust them. Real session death is detected by an actual 401 from the Gemini API, not by a local freshness heuristic.
- **`storage`** ([openspec/changes/prevent-auth-complexities/specs/storage/spec.md](openspec/changes/prevent-auth-complexities/specs/storage/spec.md)) — `ProfileManager.hasRequiredCookies` returns `true` when `__Secure-1PSID` is present, regardless of expiry or PSIDTS absence. `loadCookiesForApi` returns the cookie values without consulting a freshness threshold. `getStatus.isActive` is `hasRequired` only; `expiresAt` remains a display field.

## Impact

- **Code touched**
  - `src/infrastructure/storage.ts` — removed `checkCookieFreshness`, removed `COOKIE_EXPIRY_THRESHOLD_MS`, renamed `hasValidCookies` → `hasRequiredCookies`, relaxed `validateCookies` to PSID-only, removed past-expiry filter from `getStatus.isActive`, simplified `hasRequiredCookies` body and `loadCookiesForApi` body.
  - `src/services/cookie-storage-service.ts` — removed `checkCookieFreshness` method, removed `COOKIE_EXPIRY_THRESHOLD_MS` constant, relaxed `validateCookies` to PSID-only.
  - `src/services/cookie-monitor.ts` — removed dead `requireRotation` parameter and the `isGoogleDomainCookie` import from `./cookie-rotation.ts`.
  - `src/services/gemini-client-wrapper.ts` — bumped `COOKIE_EXPIRY_THRESHOLD_MS` from 7 days to 1 year; updated the 401-triggered `AuthError` translation message to be profile-specific and actionable.
  - `src/cli/index.ts`, `src/services/profile-auth-manager.ts`, `src/services/profile-service.ts` — call-site renames.
  - `tests/infrastructure/storage.test.ts`, `tests/services/profile-auth-manager.test.ts`, `tests/services/cookie-storage-service.test.ts`, `tests/services/gemini-client-wrapper.test.ts` — updated assertions and renamed tests.

- **Test status**
  - Full suite: 818 pass / 2 skip / 0 fail / 0 errors.
  - `bun run typecheck`: clean.
  - `bun run lint:mediation`: clean (the PowerShell version is broken and out of scope; CI runs the bash form).

- **Out of scope (tracked as a separate change)**
  - Automatic silent-recovery on 401. The new `AuthError` translation surfaces a clear, actionable message; a headless re-auth path (spawn `playwright-cli` → re-capture cookies → persist → retry) would let dormant users re-auth without a manual `gemiterm auth` invocation. This requires the L2 stack from `phase0-v2/regression-net`; tracked as a separate change.
  - The committed main specs in [openspec/specs/auth/spec.md](../../specs/auth/spec.md) and [openspec/specs/storage/spec.md](../../specs/storage/spec.md) still describe the 7-day freshness requirement. They should be updated via `openspec-sync-specs` when this change is ready to be released as v2.4.3.
