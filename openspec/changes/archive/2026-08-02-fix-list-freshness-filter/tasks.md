## 1. Storage — `hasStoredCookies` + refactor

- [x] 1.1 Add `hasStoredCookies(profileName: string): boolean` to `ProfileManager` in `src/infrastructure/storage.ts` — returns `true` iff the cookie file exists and contains both `__Secure-1PSID` and `__Secure-1PSIDTS`
- [x] 1.2 Extract private `hasValidStoredCookies(name)` and `hasFreshCookies(name)` helpers in `src/infrastructure/storage.ts` — both wrap `cookieStorage.load(name)` in a try/catch returning `false` on failure
- [x] 1.3 Refactor `hasValidCookies` to compose the two helpers: `hasValidStoredCookies(name) && hasFreshCookies(name)` — semantics unchanged from before
- [x] 1.4 Add 4 tests in `tests/infrastructure/storage.test.ts`:
  - `hasStoredCookies returns true for fresh cookies`
  - `hasStoredCookies returns true for near-expiry cookies (no freshness gate)`
  - `hasStoredCookies returns false for expired cookies missing required cookie names`
  - `hasStoredCookies returns false for missing profile`

> **Commit point**: `feat(storage): add hasStoredCookies and refactor validity helpers`

## 2. Query handler — `ListChatsQueryHandler` filter swap

- [x] 2.1 Change `ProfileManagerForQuery` interface in `src/core/query-handlers.ts`: `hasValidCookies(name): boolean` → `hasStoredCookies(name): boolean`
- [x] 2.2 Change `ListChatsQueryHandler.handle()` to call `this.profileManager.hasStoredCookies(name)` instead of `this.profileManager.hasValidCookies(name)` in the `allProfiles` filter (line 102)
- [x] 2.3 Update mock in `tests/core/query-handlers.test.ts` from `hasValidCookies` to `hasStoredCookies` (5 sites: beforeEach + 4 inline re-mocks + the `expect().not.toHaveBeenCalled` assertion)
- [x] 2.4 Add 1 test in `tests/core/query-handlers.test.ts`:
  - `allProfiles includes profiles with near-expiry cookies (no freshness gate for listing)`

> **Commit point**: `fix(query-handlers): use hasStoredCookies in ListChatsQueryHandler filter`

## 3. Spec — sync delta to main specs

- [x] 3.1 Update `openspec/specs/multi-profile-conversations/spec.md`:
  - Modify the "list --all-profiles skips unauthenticated profiles and surfaces warnings" requirement to clarify "valid cookies" means structurally valid (cookie file exists and contains the required cookie names), not freshness-checked
  - Rename scenarios to use "stored cookies" wording instead of "authenticated"
  - Add new scenario: "A profile's cookies are within the 1-hour freshness grace window" — the profile IS queried (not skipped); any needed silent refresh happens transparently in `ProfileAuthManager.ensureAuthenticated` for the **default profile** before the API client is built; non-default profiles with near-expiry cookies may still surface API errors which are caught by `Promise.allSettled` and logged as warnings

> **Commit point**: `chore(specs): sync fix-list-freshness-filter delta specs to main specs`

## 4. Baseline

- [x] 4.1 Bump `docs/testing-baseline.xml` `<Passed>` from 863 → 868 (5 new tests: 4 in `storage.test.ts` + 1 in `query-handlers.test.ts`)
- [x] 4.2 Bump `<Total>` from 865 → 870
- [x] 4.3 Bump `<ExpectCalls>` from 1758 → 1764

> **Commit point**: `chore: bump test baseline to 868 pass (fix-list-freshness-filter)`

## 5. Final verification

- [x] 5.1 `bun run typecheck` — zero errors
- [x] 5.2 `bun test` — confirm all tests pass (baseline: 868 pass, 0 fail; this change added 5 tests on top of BL-004 baseline of 863)
- [x] 5.3 `bun run test:unit` — 106 pass, 0 fail
- [x] 5.4 `bun run test:integration` — 176 pass, 0 fail
- [x] 5.5 `bun run test:smoke` — 21 pass, 0 fail
- [x] 5.6 Run `code-review` skill and address findings (open follow-up if needed)
- [x] 5.7 `bash scripts/lint-path-mediation.sh` (or equivalent) — confirm no new mediation violations

> **Commit point**: `chore: final verification — typecheck, tests, lint, code review`
