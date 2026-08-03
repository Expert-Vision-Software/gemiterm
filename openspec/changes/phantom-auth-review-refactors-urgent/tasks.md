## 1. Fix single-header Set-Cookie parsing in cookie-rotation.ts

- [ ] 1.1 In `src/services/cookie-rotation.ts`, replace `response.headers.get("set-cookie")` (line ~125) with `response.headers.getSetCookie()`. Update the `parseSetCookieHeader` function (or its call site) to accept a `string[]` instead of a single `string | undefined`, parsing each element.
- [ ] 1.2 Update `parseSetCookieHeader` to iterate the array and merge all parsed cookies into the result map. If the function signature changes, update all call sites.
- [ ] 1.3 Run `bun run typecheck` and confirm clean.

## 2. Add CookieStorageService dependency to rotateCookies

- [ ] 2.1 In `src/services/cookie-rotation.ts`, add `cookieStorageService: CookieStorageService` to the `RotateCookiesOptions` interface (or the internal handle type). Import `CookieStorageService` from `src/services/cookie-storage-service.ts`.
- [ ] 2.2 Replace `cookieStorage.save(profileName, merged)` (line ~142) with `cookieStorageService.saveCookiesForProfile(profileName, merged)`. Verify the merged array shape matches what `saveCookiesForProfile` expects.
- [ ] 2.3 Update `src/services/auth-service.ts` to pass the `cookieStorageService` instance when constructing the `RotateCookiesOptions` for `rotateCookies`.
- [ ] 2.4 Run `bun run typecheck` and confirm clean.

## 3. Unify domain matching between cookie-rotation.ts and auth-service.ts

- [ ] 3.1 Export `isGoogleDomainCookie` from `src/services/cookie-rotation.ts` (add `export` keyword). NOTE: if `phantom-auth-review-refactors` has landed and moved it to `src/core/cookie-constants.ts`, import from there instead.
- [ ] 3.2 In `src/services/auth-service.ts`, import `isGoogleDomainCookie` and replace the `(c.domain ?? "").endsWith("google.com")` calls at lines ~219, ~222, ~256, ~257 with `isGoogleDomainCookie(c)`. Keep the existing fallback logic (non-domain-filtered lookup) intact.
- [ ] 3.3 Run `bun run typecheck` and confirm clean.

## 4. Fix spec typo in silent-refresh-tightening

- [ ] 4.1 In `openspec/specs/silent-refresh-tightening/spec.md`, fix the POST body literal from `[000,"-0000000000000000000"]` to `[0,"-0000000000000000000"]`. (The code already uses `[0,...]` correctly; only the spec document has the typo.)

## 5. Test coverage for multi-header Set-Cookie parsing

- [ ] 5.1 In `tests/services/cookie-rotation.test.ts`, add a test: mock fetcher returns a Response with two `Set-Cookie` headers — one with `__Secure-1PSIDTS=NEW` and another with `__Secure-3PSIDTS=NEW3P`. Assert both are parsed and merged into the stored cookies.
- [ ] 5.2 Add a test: mock fetcher returns a Response with a `Set-Cookie` header for `SIDCC=NEWSIDCC`. Assert `SIDCC` is merged (verifying non-PSIDTS cookies are captured too).

## 6. Test coverage for domain matching unification

- [ ] 6.1 In `tests/services/cookie-rotation.test.ts`, add a test: profile has `__Secure-1PSIDTS` with domain `somethinggoogle.com`. Assert it is NOT included in the RotateCookies request cookies (domain does not match `.google.com`).
- [ ] 6.2 In `tests/services/auth-service.test.ts`, add a test: L2 silentRefresh with a cookie having domain `evilgoogle.com`. Assert the snapshot does NOT include it (strict `.google.com` check).

## 7. Test coverage for CookieStorageService.saveCookiesForProfile

- [ ] 7.1 In `tests/services/cookie-rotation.test.ts`, add a test: verify `saveCookiesForProfile` is called (not `CookieStorage.save`) after successful rotation. Use a spy on the service method.

## 8. Final verification

- [ ] 8.1 Run `bun run typecheck` and confirm clean.
- [ ] 8.2 Run `bun test` and confirm 899 pass, 0 fail, 2 skip, 901 total — no regressions.
- [ ] 8.3 Run `openspec validate --all --strict` and confirm all specs pass.
- [ ] 8.4 Commit changes in git.
