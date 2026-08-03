## 1. Cookie constants module

- [ ] 1.1 Create `src/core/cookie-constants.ts` exporting: `SECURE_1PSID = "__Secure-1PSID"`, `SECURE_1PSIDTS = "__Secure-1PSIDTS"`, `REQUIRED_COOKIE_NAMES` (Set built from the two constants), `CookieBaseline` interface (`{ activePsid: string; activePsidts: string | null }`), and `cookiesRotatedFrom(baseline: CookieBaseline, polled: Cookie[]): boolean` (returns `true` when either PSID or PSIDTS differs from baseline, filtering polled cookies to `.google.com` domain).
- [ ] 1.2 Run `bun run typecheck` and confirm clean.

## 2. Replace inline cookie-name literals in src/

- [ ] 2.1 `src/services/cookie-monitor.ts`: replace `REQUIRED_COOKIES` set and `"__Secure-1PSID"` / `"__Secure-1PSIDTS"` literals with imports from `cookie-constants.ts`. Replace the `RequireRotation` interface with `CookieBaseline` import (re-export as type alias if needed for backward compat).
- [ ] 2.2 `src/services/cookie-storage-service.ts`: replace `REQUIRED_COOKIE_NAMES` set with import from `cookie-constants.ts`. Replace inline literals.
- [ ] 2.3 `src/services/auth-service.ts`: replace inline `"__Secure-1PSID"` / `"__Secure-1PSIDTS"` literals with imports. Replace the anonymous `{ activePsid; activePsidts }` snapshot type with `CookieBaseline`. Replace the snapshot extraction and post-monitor comparison with `cookiesRotatedFrom`.
- [ ] 2.4 `src/services/cookie-rotation.ts`: replace inline `"__Secure-1PSIDTS"` literals with import.
- [ ] 2.5 `src/services/gemini-client-wrapper.ts`: replace inline `"__Secure-1PSID"` / `"__Secure-1PSIDTS"` literals in `persistRefreshedCookies` with imports.
- [ ] 2.6 `src/services/profile-auth-manager.ts`: no inline cookie-name literals to replace (verify; the probe uses `listChats` not cookie names directly). Skip if none found.
- [ ] 2.7 Run `bun run typecheck` and confirm clean.
- [ ] 2.8 Run `bun test` and confirm 899 pass, 0 fail, 2 skip, 901 total.
- [ ] 2.9 Commit changes in git.

## 3. Lift the `gimme` test helper

- [ ] 3.1 Create `tests/services/_helpers.ts` exporting the `gimme(listChatsFn)` factory and the `GimmeClient` interface (lifted verbatim from `phantom-auth.test.ts`).
- [ ] 3.2 Update `tests/services/phantom-auth.test.ts` to import `gimme` from `_helpers.ts` instead of declaring it inline. Remove the local declaration.
- [ ] 3.3 Update `tests/services/profile-auth-manager.test.ts` to import `gimme` from `_helpers.ts` instead of declaring the local copy. Remove the local `gimme` and `ChatInfoT` type alias.
- [ ] 3.4 Run `bun test tests/services/phantom-auth.test.ts tests/services/profile-auth-manager.test.ts` and confirm all pass.
- [ ] 3.5 Commit changes in git.

## 4. Fix io.ts / path-utils.ts single-call-site violation

- [ ] 4.1 In `tests/services/profile-auth-manager.test.ts`, replace `existsSync(markerPath)` assertions with `readProfileHasChats("default")` from `src/infrastructure/io.ts`. Replace `writeFileSync(join(markerDir, "profile-has-chats"), "")` setup with `writeProfileHasChats("default")`.
- [ ] 4.2 Remove the now-unused `existsSync`, `writeFileSync` imports from `node:fs` in `profile-auth-manager.test.ts` if no other call sites remain.
- [ ] 4.3 Run `bun test tests/services/profile-auth-manager.test.ts` and confirm all pass.
- [ ] 4.4 Run `bun test` (full suite) and confirm 899 pass, 0 fail, 2 skip, 901 total.
- [ ] 4.5 Commit changes in git.

## 5. Final verification

- [ ] 5.1 Run `bun run typecheck` and confirm clean.
- [ ] 5.2 Run `bun test` and confirm 899 pass, 0 fail, 2 skip, 901 total — no regressions.
- [ ] 5.3 Verify no `"__Secure-1PSID"` or `"__Secure-1PSIDTS"` string literals remain in `src/services/` (use `grep -r` / `rg`). All should reference the constants from `cookie-constants.ts`.
- [ ] 5.4 Verify `writeProfileHasChats` / `readProfileHasChats` / `getProfileHasChatsPath` each have at least 2 call sites across `src/` + `tests/`.
- [ ] 5.5 Load and run skill `code-review` and confirm the five original findings are resolved.
