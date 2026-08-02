## 1. Implementation

- [ ] 1.1 Add `checkCookieFreshness(cookies)` to the `isActive` expression in `ProfileManager.getStatus()` at `src/infrastructure/storage.ts:161`

## 2. Tests

- [ ] 2.1 Add `makeNearExpiryCookies()` helper that creates cookies with `__Secure-1PSIDTS` expiring in 3 days (within the 7-day freshness window)
- [ ] 2.2 Add test: `getStatus` reports `isActive: false` for near-expiry cookies (freshness check parity with `hasValidCookies`)
- [ ] 2.3 Add test: `getAllStatuses` correctly reports near-expiry profile as inactive
- [ ] 2.4 Verify existing tests still pass — session cookies (`expires: -1`) must remain `isActive: true`

## 3. Validation

- [ ] 3.1 Run `bun test` and confirm the full suite passes (baseline: 657 pass)
- [ ] 3.2 Run `bun run typecheck` and confirm no new errors
- [ ] 3.3 Run `bash scripts/lint-path-mediation.sh` and confirm no violations
