## 1. Ledger

- [ ] 1.1 Update `docs/phantom-bug-synthesis.md` with RotateCookies 401 session-kill entry

## 2. Core Implementation

- [ ] 2.1 Remove `sessionInvalid` throw in `ProfileAuthManager.ensureAuthenticated` (`src/services/profile-auth-manager.ts:121-129`)
- [ ] 2.2 Merge `sessionInvalid` into the `rotation.attempted` branch for phantom-detection fallthrough

## 3. Tests

- [ ] 3.1 Update existing `sessionInvalid` → `AuthenticationError` throw tests in `tests/services/profile-auth-manager.test.ts` to reflect new behavior (fallthrough to phantom detection)
- [ ] 3.2 Add test: RotateCookies 401 → phantom not detected → returns LoadedCookies (no throw)
- [ ] 3.3 Add test: RotateCookies 401 → phantom detected → targeted L2 succeeds → returns refreshed LoadedCookies
- [ ] 3.4 Add test: RotateCookies 401 → phantom detected → targeted L2 fails → throws AuthenticationError

## 4. Verification

- [ ] 4.1 `bun test` — confirm baseline intact (954/1/0 before changes, adjusted for new test count)
- [ ] 4.2 `bun run typecheck` — clean
- [ ] 4.3 `openspec validate --all --strict` — 32/0 (unchanged)
