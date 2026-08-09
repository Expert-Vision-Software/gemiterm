# Tasks — `prevent-auth-complexities`

## 1. Foundation: drop the freshness gate

- [x] 1.1 In [src/infrastructure/storage.ts](src/infrastructure/storage.ts), remove the `COOKIE_EXPIRY_THRESHOLD_MS` constant and the `checkCookieFreshness` function (lines 14 and 41-49 in the pre-change file).
- [x] 1.2 In the same file, simplify `ProfileManager.hasValidCookies` to `return validateCookies(cookies);` — no `&& checkCookieFreshness(cookies)`.
- [x] 1.3 In the same file, simplify `ProfileManager.loadCookiesForApi` to remove the `checkCookieFreshness` throw; keep only the PSID-presence check.
- [x] 1.4 Verify [src/infrastructure/storage.ts:147-157](src/infrastructure/storage.ts#L147-L157) `getStatus` still uses `getCookieExpiryTimestamp` for the `isActive` field. (Display-only filter; out of scope for this change.)

## 2. Rename for clarity

- [x] 2.1 Rename `ProfileManager.hasValidCookies` → `hasRequiredCookies` in [src/infrastructure/storage.ts:183](src/infrastructure/storage.ts#L183).
- [x] 2.2 Update the local variable in `getStatus` ([src/infrastructure/storage.ts:147](src/infrastructure/storage.ts#L147)) from `hasValidCookies` to `hasRequired` (or remove it — the only consumer is the `isActive` line).
- [x] 2.3 Update call sites:
  - [src/cli/index.ts:48](src/cli/index.ts#L48)
  - [src/services/profile-auth-manager.ts:35, 47](src/services/profile-auth-manager.ts#L35)
  - [src/services/profile-service.ts:29, 55](src/services/profile-service.ts#L29)
- [x] 2.4 Update test references in [tests/infrastructure/storage.test.ts:295, 300, 303, 308, 311, 312, 315, 331](tests/infrastructure/storage.test.ts#L295) — both the method name and the four `test(...)` descriptions.

## 3. Remove dead code

- [x] 3.1 In [src/services/cookie-storage-service.ts](src/services/cookie-storage-service.ts), remove the `COOKIE_EXPIRY_THRESHOLD_MS` constant (line 5) and the `checkCookieFreshness` method (lines 58-66).
- [x] 3.2 In [tests/services/cookie-storage-service.test.ts](tests/services/cookie-storage-service.test.ts), remove the `describe("checkCookieFreshness", ...)` block (lines 174-213) and the orphaned `makeStaleCookies` helper (lines 59-79).

## 4. Test updates

- [x] 4.1 `tests/infrastructure/storage.test.ts` — `hasValidCookies returns false for expired cookies` → `hasRequiredCookies returns true when required cookies are present (trusts cookies, ignores expires)`. Assertion flipped to `true`.
- [x] 4.2 `tests/infrastructure/storage.test.ts` — `loadCookiesForApi throws for expired cookies` → `loadCookiesForApi returns values for expired cookies (no freshness gate; 401 is the only recovery trigger)`. Asserts cookie values are returned.
- [x] 4.3 `tests/infrastructure/storage.test.ts` — new test `hasRequiredCookies returns false when required cookies are missing` covering the PSID-only edge case.
- [x] 4.4 `tests/infrastructure/storage.test.ts` — new test `loadCookiesForApi throws when PSID is missing` covering the PSID-only-no-PSIDTS edge case.
- [x] 4.5 `tests/services/profile-auth-manager.test.ts` — `ensureAuthenticated > throws AuthenticationError with expired cookies` → `returns cookies when expires is in the past (trusts cookies; 401 is the only recovery trigger)`. Asserts cookie values are returned.
- [x] 4.6 `tests/services/profile-auth-manager.test.ts` — `getActiveProfiles > returns profiles with valid cookies` → `returns profiles with the required cookies present (trusts cookies, ignores expires)`. Expired profile is now expected in the result.
- [x] 4.7 `tests/services/profile-auth-manager.test.ts` — `getActiveProfiles > returns empty array when no profiles have valid cookies` → `returns empty array when no profiles have the required cookies`. Renamed and (per the test name) inverted; in this codebase, expired cookies count as having the required cookies.
- [x] 4.8 `tests/services/profile-auth-manager.test.ts` — `findProfileForConversation > does not probe profiles whose cookies are expired` → `probes all profiles whose required cookies are present (trusts cookies; expired cookies are still probed)`. Both profiles now expected in the probed set.

## 5. OpenSpec change folder

- [x] 5.1 Create [openspec/changes/prevent-auth-complexities/proposal.md](openspec/changes/prevent-auth-complexities/proposal.md).
- [x] 5.2 Create [openspec/changes/prevent-auth-complexities/design.md](openspec/changes/prevent-auth-complexities/design.md).
- [x] 5.3 Create [openspec/changes/prevent-auth-complexities/tasks.md](openspec/changes/prevent-auth-complexities/tasks.md) (this file).
- [ ] 5.4 *(Future work)* Create [openspec/changes/prevent-auth-complexities/specs/auth/spec.md](openspec/changes/prevent-auth-complexities/specs/) and [openspec/changes/prevent-auth-complexities/specs/storage/spec.md](openspec/changes/prevent-auth-complexities/specs/) with the deltas.
- [ ] 5.5 *(Future work)* Run `openspec-sync-specs` to fold the deltas into the main specs.

## 6. Follow-up work (out of scope, tracked for visibility)

- [ ] 6.1 Implement 401-triggered recovery. The new posture requires it to be useful; current behavior surfaces `AuthenticationError` instead. Suggested location: a new `silentRefresh` method on `AuthService` invoked by the `AuthError` translation in [src/services/gemini-client-wrapper.ts:178-184](src/services/gemini-client-wrapper.ts#L178-L184).
- [ ] 6.2 Relax `hasRequiredCookies` to only require `__Secure-1PSID` (PSIDTS optional). The current inconsistency: `hasRequiredCookies` requires both, but `loadCookiesForApi` treats PSIDTS as nullable.
- [ ] 6.3 Bump `persistRefreshedCookies` saved-`expires` horizon from 7 days to 1 year ([src/services/gemini-client-wrapper.ts:132-144](src/services/gemini-client-wrapper.ts#L132-L144)). Currently informational; the gate is gone.
- [ ] 6.4 Remove the hard past-expiry filter from `getStatus.isActive` ([src/infrastructure/storage.ts:147-157](src/infrastructure/storage.ts#L147-L157)) for display consistency with the new "trust cookies" posture.
- [ ] 6.5 Fix the missing `cookie-rotation.ts` module on this branch. [src/services/cookie-monitor.ts:4](src/services/cookie-monitor.ts#L4) imports a module that does not exist; causes 4 smoke-test failures and 4 unhandled errors. Pre-existing on `2076e52`.
