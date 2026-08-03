## 1. Profile-level has-chats marker

- [x] 1.1 Add `getProfileHasChatsPath(profileName: string): string` to `src/infrastructure/path-utils.ts` that returns `joinPath(getProfileDir(profileName), "profile-has-chats")`.
- [x] 1.2 Add `writeProfileHasChats(profileName: string)` and `readProfileHasChats(profileName: string): boolean` helpers to `src/infrastructure/io.ts` (write empty file / check existence via `existsFile`).
- [x] 1.3 Wire `writeProfileHasChats` into `ProfileAuthManager` after a successful server-side probe returns non-empty.
- [x] 1.4 Wire `readProfileHasChats` into `ProfileAuthManager.probeServerSession` as the source of the "ever had chats" boolean.

## 2. Server-side probe in ProfileAuthManager

- [x] 2.1 Add `PROBE_CACHE_TTL_MS` constant (default 150_000; read from `GEMITERM_PROBE_TTL_MS` env var with fallback; invalid values fall back to default).
- [x] 2.2 Add private `probeCache: Map<string, { ts: number; result: "valid" | "stale" | "ambiguous" }>` field to `ProfileAuthManager`.
- [x] 2.3 Implement `private async probeServerSession(name: string): Promise<"valid" | "stale" | "ambiguous">`:
  - Check `probeCache` for non-expired entry; return cached result if found.
  - Call `this.geminiClient.listChats({ limit: 1 })` on a client scoped to `name` (use `forProfile`).
  - If non-empty: write has-chats marker, cache "valid", return "valid".
  - If empty + has-chats flag exists: cache "stale", return "stale".
  - If empty + has-chats flag absent: cache "stale" (per the regression-contract tests; the marker read is retained for future use).
  - Catch errors -> log debug, return "ambiguous" (fall through to local freshness).
- [x] 2.4 Modify `ensureAuthenticated`:
  - After `hasValidCookies` passes:
    - Call `probeServerSession(name)`.
    - If "valid": return cookies as before.
    - If "ambiguous": log debug-level message, return cookies.
    - If "stale": log warning, call `silentRefresh(name)` directly (bypasses autoExtendSession's local-freshness short-circuit).
      - If `silentRefresh` returns `true`: re-probe (fresh call, skip cache) to update state, return cookies.
      - If `silentRefresh` returns `false`: throw `AuthenticationError`.
  - [x] 2.5 Commit changes in git.
  - [x] 2.6 Run `bun test:unit` and confirm all tests pass.
  - [ ] 2.7 load and run skill `code-review` and apply any suggested improvements to the code.

## 3. RotateCookies L1 silent refresh (new)

- [x] 3.1 Create `src/services/cookie-rotation.ts` with `rotateCookies(profileName: string): Promise<boolean>`:
  - Load full cookie jar via `cookieStorageService.loadAllCookiesForProfile`.
  - Build `Cookie` header string from loaded cookies (filter to `.google.com` domains).
  - POST `[0,"-0000000000000000000"]` to `https://accounts.google.com/RotateCookies` with headers:
    - `Content-Type: application/json`
    - `Origin: https://accounts.google.com`
    - `Cookie: <serialized cookies>`
  - On 200: parse `set-cookie` headers for new `__Secure-1PSIDTS`, `__Secure-3PSIDTS`, `SIDCC`.
  - Compare new PSIDTS against stored value: if different, merge into stored cookies, save via `saveCookiesForProfile`, return `true`. If same, return `false`.
  - On non-200 or error: return `false`.
- [x] 3.2 Implement rate-limiting:
  - **Disk-mtime guard:** skip rotation if `storage_state.json` was modified within the last 600s (uses `getFileMtime` from `io.ts`).
  - **In-process throttle:** module-level `Map<string, Promise<boolean>>` deduplicates concurrent rotate calls for the same profile.
- [x] 3.3 Add `GEMITERM_SKIP_ROTATE_COOKIES` env var check (if set, skip L1 and go directly to L2). Document in `README.md`.
- [x] 3.4 Wire `rotateCookies` into `AuthService.silentRefresh` as the first step (L1). Only proceed to headless browser (L2) if L1 returns `false`.
- [x] 3.5 Commit changes in git.
- [x] 3.6 Run `bun test:unit` and confirm all tests pass.
- [ ] 3.7 load and run skill `code-review` and apply any suggested improvements to the code.

## 4. Headless browser L2 silent refresh hardening

- [x] 4.1 Add `requireRotation` parameter to `CookieMonitor.start`:
  - Type: `{ activePsid: string; activePsidts: string | null } | undefined`.
  - In `poll()`: after `cookieListFromState`, compare returned PSID/PSIDTS against `requireRotation` values. If identical, return without firing `onCookiesFound`. If different, fire.
  - When `requireRotation` is `undefined`: existing behavior (fire on first poll with both cookies).
- [x] 4.2 Modify `AuthService.silentRefresh`:
  - L1: call `rotateCookies(name)`. If `true`, return `true`.
  - L2 (fallback): snap active cookie values, launch headless browser, `waitForSilentLogin` with `requireRotation`, compare returned values against snapshot. Return `true` only if values differ.
- [x] 4.3 Commit changes in git.
- [x] 4.4 Run `bun test:unit` and confirm all tests pass.
- [ ] 4.5 load and run skill `code-review` and apply any suggested improvements to the code.

## 5. `persistRefreshedCookies` merge fix

- [x] 5.1 In `GeminiClientService.persistRefreshedCookies` (`src/services/gemini-client-wrapper.ts:119-151`), change merge condition from `c.name === "__Secure-1PSID"` to `c.name === "__Secure-1PSID" && c.value === this.baselineSecure1psid`. Same for `__Secure-1PSIDTS`.
- [x] 5.2 Commit changes in git.
- [x] 5.3 Run `bun test:unit` and confirm all tests pass.
- [ ] 5.4 load and run skill `code-review` and apply any suggested improvements to the code.

## 6. Existing test updates

- [x] 6.1 Update `tests/services/profile-auth-manager.test.ts`: add tests for probe valid/stale paths, caching, has-chats marker.
- [x] 6.2 Update `tests/services/auth-service.test.ts`: add tests for L1 rotation success/failure, L2 fallback, cookie value comparison.
- [x] 6.3 Update `tests/services/cookie-monitor.test.ts`: add `requireRotation` tests (no fire on identical, fire on different, existing behavior preserved).
- [x] 6.4 Create `tests/services/cookie-rotation.test.ts`: test RotateCookies POST with mocked HTTP (return fresh PSIDTS, return 401, return same value, network error).
- [x] 6.5 Update `tests/services/gemini-client-wrapper.test.ts`: add multi-domain merge test, update existing tests for `(name, baselineValue)` matching.

## 7. Phantom-auth regression tests go green

- [x] 7.1 Run `bun test tests/services/phantom-auth.test.ts` and confirm all 5 scenarios pass.
- [x] 7.2 Adjust mock assertions if implementation details differ from the test's expected call patterns.
- [x] 7.3 Complete section 5 in `openspec/changes/phatom-auth-repro-with-tests/tasks.md`

## 8. Baseline, typecheck, and documentation

- [x] 8.1 Execute `test-baselining eval` and Confirm 5 phantom-auth tests pass along with all else, no regressions.
- [x] 8.2 Update `docs/testing-baseline.xml`: new counts and `<LastUpdated>` timestamp.
- [x] 8.3 Run `bun run typecheck` and confirm clean.
- [x] 8.4 Add env var docs to `README.md`: `GEMITERM_PROBE_TTL_MS`, `GEMITERM_SKIP_ROTATE_COOKIES`.
- [x] 8.5 Add entry to `CHANGELOG.md` under "Unreleased" describing the fix.

