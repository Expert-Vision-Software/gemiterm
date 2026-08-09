# Tasks — `prevent-auth-complexities`

## 1. Foundation: drop the freshness gate

- [x] 1.1 In [src/infrastructure/storage.ts](src/infrastructure/storage.ts), remove the `COOKIE_EXPIRY_THRESHOLD_MS` constant and the `checkCookieFreshness` function.
- [x] 1.2 In the same file, simplify `ProfileManager.hasRequiredCookies` to `return validateCookies(cookies);` — no `&& checkCookieFreshness(cookies)`.
- [x] 1.3 In the same file, simplify `ProfileManager.loadCookiesForApi` to remove the `checkCookieFreshness` throw; keep only the PSID-presence check.
- [x] 1.4 Remove the past-expiry filter from `getStatus.isActive` (was: `hasRequired && (expiresMs === null || expiresMs > Date.now())`). Now: `const isActive = hasRequired;`. Display becomes consistent with the new "trust cookies" posture.

## 2. Rename for clarity

- [x] 2.1 Rename `ProfileManager.hasValidCookies` → `hasRequiredCookies` in [src/infrastructure/storage.ts](src/infrastructure/storage.ts).
- [x] 2.2 Update the local variable in `getStatus` from `hasValidCookies` to `hasRequired`.
- [x] 2.3 Update call sites:
  - [src/cli/index.ts](src/cli/index.ts)
  - [src/services/profile-auth-manager.ts](src/services/profile-auth-manager.ts)
  - [src/services/profile-service.ts](src/services/profile-service.ts)
- [x] 2.4 Update test references in [tests/infrastructure/storage.test.ts](tests/infrastructure/storage.test.ts) — both the method name and the test descriptions.

## 3. Remove dead code

- [x] 3.1 In [src/services/cookie-storage-service.ts](src/services/cookie-storage-service.ts), remove the `COOKIE_EXPIRY_THRESHOLD_MS` constant and the `checkCookieFreshness` method.
- [x] 3.2 In [tests/services/cookie-storage-service.test.ts](tests/services/cookie-storage-service.test.ts), remove the `describe("checkCookieFreshness", ...)` block and the orphaned `makeStaleCookies` helper.
- [x] 3.3 In [src/services/cookie-monitor.ts](src/services/cookie-monitor.ts), remove the dead `requireRotation` parameter and the `isGoogleDomainCookie` import from `./cookie-rotation.ts` (file does not exist on this branch; the parameter has no callers). This unblocks 4 pre-existing test failures (3 smoke + 1 continue-command).

## 4. Test updates

- [x] 4.1 [tests/infrastructure/storage.test.ts](tests/infrastructure/storage.test.ts) — `getStatus returns inactive for expired cookies` → `getStatus returns active for expired cookies (trusts cookies, ignores expires)`. Assertion flipped to `true`.
- [x] 4.2 [tests/infrastructure/storage.test.ts](tests/infrastructure/storage.test.ts) — `getAllStatuses returns all profile statuses` — expired profile now expected to be `isActive: true`.
- [x] 4.3 [tests/infrastructure/storage.test.ts](tests/infrastructure/storage.test.ts) — `hasRequiredCookies returns false when required cookies are missing` (the previous PSID-only-no-PSIDTS edge case) → `hasRequiredCookies returns true when only PSID is present (PSID is the only required cookie)`. New edge case `hasRequiredCookies returns false when PSID is missing` added.
- [x] 4.4 [tests/services/cookie-storage-service.test.ts](tests/services/cookie-storage-service.test.ts) — `validateCookies > returns false when __Secure-1PSIDTS is missing` → `returns true when only PSID is present (PSID is the only required cookie)`. New `returns false when PSID is missing` added.
- [x] 4.5 [tests/services/gemini-client-wrapper.test.ts](tests/services/gemini-client-wrapper.test.ts) — `AuthError -> AuthenticationError` test updated to assert the new profile-name + `gemiterm auth <profile>` message; the service is now constructed with a `profileName="work"` so the message is deterministic.
- [x] 4.6 [tests/services/profile-auth-manager.test.ts](tests/services/profile-auth-manager.test.ts) — 4 tests updated for the trust-the-cookies semantics (already in `1499d31`).
- [x] 4.7 [tests/services/cookie-storage-service.test.ts](tests/services/cookie-storage-service.test.ts) — `checkCookieFreshness` describe block and `makeStaleCookies` helper removed (already in `1499d31`).

## 5. OpenSpec change folder

- [x] 5.1 Create [openspec/changes/prevent-auth-complexities/proposal.md](openspec/changes/prevent-auth-complexities/proposal.md).
- [x] 5.2 Create [openspec/changes/prevent-auth-complexities/design.md](openspec/changes/prevent-auth-complexities/design.md).
- [x] 5.3 Create [openspec/changes/prevent-auth-complexities/tasks.md](openspec/changes/prevent-auth-complexities/tasks.md) (this file).
- [x] 5.4 Create [openspec/changes/prevent-auth-complexities/specs/auth/spec.md](openspec/changes/prevent-auth-complexities/specs/auth/spec.md) and [openspec/changes/prevent-auth-complexities/specs/storage/spec.md](openspec/changes/prevent-auth-complexities/specs/storage/spec.md) with the deltas.
- [x] 5.5 The spec deltas describe the post-change `v2.4.3` state. They are not folded into the committed main specs ([openspec/specs/auth/spec.md](../../specs/auth/spec.md), [openspec/specs/storage/spec.md](../../specs/storage/spec.md)) in this change; that is a `openspec-sync-specs` task that the user runs when ready to release (it touches the committed main specs and the v2.4.2 → v2.4.3 transition).

## 6. Ship-ready improvements (all completed in this change)

- [x] 6.1 Make the 401-triggered `AuthError` message actionable. The `translateError` method in [src/services/gemini-client-wrapper.ts](src/services/gemini-client-wrapper.ts) now constructs `AuthenticationError` with the profile name and the correct auth command: ``Session for profile '<name>' is no longer valid (Gemini returned 401). Run 'gemiterm auth <name>' to re-authenticate.``. Automatic silent-recovery (headless re-auth on 401) remains a separate change; the actionable message is the ship-ready minimum so the user knows exactly what to do.
- [x] 6.2 Relax `hasRequiredCookies` to only require `__Secure-1PSID` (PSIDTS optional). `validateCookies` in [src/infrastructure/storage.ts](src/infrastructure/storage.ts) and [src/services/cookie-storage-service.ts](src/services/cookie-storage-service.ts) now checks PSID presence only. `loadCookiesForApi` already treated PSIDTS as nullable; this removes the inconsistency where PSIDTS-missing profiles were reported as not-having-required-cookies but still produced a working API client.
- [x] 6.3 Bump `persistRefreshedCookies` saved-`expires` horizon from 7 days to 1 year. The `COOKIE_EXPIRY_THRESHOLD_MS` constant in [src/services/gemini-client-wrapper.ts](src/services/gemini-client-wrapper.ts) is now `365 * 24 * 60 * 60 * 1000`. Since the freshness gate is gone, this is now purely an on-disk display field; matching the 1-year server-issued horizon is the consistent choice.
- [x] 6.4 Remove the hard past-expiry filter from `getStatus.isActive` (display consistency). `getStatus` in [src/infrastructure/storage.ts](src/infrastructure/storage.ts) now returns `isActive = hasRequired`. The `expiresAt` field still shows the on-disk expiry timestamp for user reference; it is no longer used to flip `isActive` to `false`.
- [x] 6.5 Fix the missing `cookie-rotation.ts` module on this branch. The `isGoogleDomainCookie` import and the `requireRotation` parameter in [src/services/cookie-monitor.ts](src/services/cookie-monitor.ts) were dead code (no callers) that referenced a module that never landed on this branch. Both removed. Smoke tests, ContinueCommand tests, and the full `bun test` suite are now green (818 pass / 2 skip / 0 fail / 0 errors).

## 7. Post-merge follow-up (separate change)

- Automatic silent-recovery on 401. The current `AuthError` → `AuthenticationError` translation surfaces the new actionable message. A headless re-auth path (spawn `playwright-cli` → re-capture cookies → persist → retry) would let dormant users re-auth without a manual `gemiterm auth` invocation. This requires the L2 stack from `phase0-v2/regression-net`; tracked as a separate change.
- The committed main specs in [openspec/specs/auth/spec.md](../../specs/auth/spec.md) and [openspec/specs/storage/spec.md](../../specs/storage/spec.md) still describe the 7-day freshness requirement. They should be updated via `openspec-sync-specs` when this change is ready to be released as v2.4.3.
