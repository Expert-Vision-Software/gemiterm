## 1. Domain-scoped cookie loading

- [ ] 1.1 In `src/services/cookie-storage-service.ts`, add a `resolveCookie(cookies: Cookie[], name: string): string | undefined` helper that prefers `.google.com` domain entries, falling back to first match by name.
- [ ] 1.2 Update `loadCookiesForProfile` to use `resolveCookie` for `__Secure-1PSID` and `__Secure-1PSIDTS` instead of the name-keyed `Map`.
- [ ] 1.3 Run `bun test tests/services/cookie-storage-service.test.ts` and confirm all pass.
- [ ] 1.4 Run `bun run typecheck` and confirm clean.

## 2. silentRefresh merge-by-name-domain-path upsert

- [ ] 2.1 In `src/services/auth-service.ts`, add a `mergeCookies(existing: Cookie[], polled: Cookie[]): Cookie[]` helper that upserts polled cookies into existing by `(name, domain, path)` key.
- [ ] 2.2 Replace the `await this.extractCookies(name, cookies)` call at line 269 with a merge: `cookieStorageService.loadAllCookiesForProfile(name)` → `mergeCookies(existing, polled)` → `cookieStorageService.saveCookiesForProfile(name, merged)`.
- [ ] 2.3 Add a unit test for `mergeCookies` in `tests/services/auth-service.test.ts` covering: preserves existing entry when polled set lacks it, overwrites when key matches, handles empty existing jar.
- [ ] 2.4 Run `bun test tests/services/auth-service.test.ts` and confirm merge tests pass.
- [ ] 2.5 Run `bun run typecheck` and confirm clean.

## 3. Cookie-monitor requireRotation prefers .google.com domain

- [ ] 3.1 In `src/services/cookie-monitor.ts`, update the `requireRotation` check at lines 164-165 to prefer `isGoogleDomainCookie` match when finding PSID and PSIDTS, matching the snapshot comparison in `auth-service.ts:261-264`.
- [ ] 3.2 Run `bun test tests/services/cookie-monitor.test.ts` and confirm all pass.
- [ ] 3.3 Run `bun run typecheck` and confirm clean.

## 4. Smoke tests flip green

- [ ] 4.1 Run `bun test tests/services/phantom-auth.test.ts` and confirm both smoke tests (B1+B2 false-positive, B3 4→3 corruption) pass.
- [ ] 4.2 Run `bun test tests/services/profile-auth-manager.test.ts` and confirm profile-auth-manager tests pass (domain-scoped loading may affect setup).
- [ ] 4.3 Run `bun test` (full suite) and confirm no regressions.

## 5. Spec sync and validation

- [ ] 5.1 Run `openspec validate --strict --change phantom-auth-data-integrity` and confirm clean.
- [ ] 5.2 Commit all changes.
