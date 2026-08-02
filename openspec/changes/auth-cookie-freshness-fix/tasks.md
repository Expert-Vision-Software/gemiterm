## Implementation Notes

**Commit points**: Each top-level section is a commit boundary. Commit after completing each section (1, 2, 3, 4). Use conventional-commit messages referencing the change: `fix(auth): <message>`.

**Task tracking**: Check off `- [x]` as you complete each task. Keep this file in sync with work progress.

**Post-implementation**: Run the `code-review` skill and address findings before considering the change done.

---

## 1. Cleanup: Delete superseded change

- [x] 1.1 Delete the `openspec/changes/fix-auth-status-consistency/` directory entirely (this change fully supersedes it)

## 2. Core Implementation

- [x] 2.1 `src/services/gemini-client-wrapper.ts`: Remove `expires: expirySec` from the merge objects in `persistRefreshedCookies()` (lines 137 and 141). Remove the now-dead `expirySec` variable on line 132 and the `COOKIE_EXPIRY_THRESHOLD_MS` import/constant on line 71.
- [x] 2.2 `src/infrastructure/storage.ts`: Change `COOKIE_EXPIRY_THRESHOLD_MS` from `7 * 24 * 60 * 60 * 1000` to `60 * 60 * 1000` (1 hour) on line 14.
- [x] 2.3 `src/infrastructure/storage.ts`: Add `checkCookieFreshness(cookies)` to the `isActive` expression in `ProfileManager.getStatus()` at line 161.
- [x] 2.4 `src/services/cookie-storage-service.ts`: Change `COOKIE_EXPIRY_THRESHOLD_MS` from `7 * 24 * 60 * 60 * 1000` to `60 * 60 * 1000` (1 hour) on line 5.

## 3. Test Updates

- [x] 3.1 `tests/infrastructure/storage.test.ts`: Add a `makeNearExpiryCookies()` helper that creates cookies with `__Secure-1PSIDTS.expires` set to 30 minutes from now (within the new 1-hour freshness window). Validate: these cookies are NOT past their absolute expiry — they're still valid in the absolute sense, but should fail the freshness check.
- [x] 3.2 `tests/infrastructure/storage.test.ts`: Add test: `getStatus` reports `isActive: false` for near-expiry cookies (freshness check parity with `hasValidCookies`).
- [x] 3.3 `tests/infrastructure/storage.test.ts`: Add test: `getAllStatuses` correctly reports near-expiry profile as inactive.
- [x] 3.4 `tests/infrastructure/storage.test.ts`: Verify existing `makeValidCookies()` helper still works (uses `now + 365 days`, well outside the 1-hour window).
- [x] 3.5 `tests/infrastructure/storage.test.ts`: Verify session cookies test (`expires: -1`) still passes — session cookies remain `isActive: true` since `checkCookieFreshness` returns true when `expires <= 0`.
- [x] 3.6 `tests/services/gemini-client-wrapper.test.ts`: Update any `persistRefreshedCookies` tests to verify that `expires` is preserved (not overwritten) after a cookie value refresh.

## 4. Validation

- [x] 4.1 Run `bun test` and confirm the full suite passes (baseline: 818 pass, 2 skip, 0 fail).
- [x] 4.2 Run `bun run typecheck` and confirm no new errors.
- [x] 4.3 Run `bash scripts/lint-path-mediation.sh` and confirm no violations.

## 5. Post-Implementation

- [ ] 5.1 Run the `code-review` skill and address all findings.
- [ ] 5.2 Mark all tasks complete in this file.
