## 1. Profile-level has-chats marker

- [ ] 1.1 Add `getProfileHasChatsPath(profileName: string): string` to `src/infrastructure/path-utils.ts` that returns `joinPath(getProfileDir(profileName), "profile-has-chats")`.
- [ ] 1.2 Add `writeProfileHasChats(profileName: string)` and `readProfileHasChats(profileName: string): boolean` helpers to `src/infrastructure/io.ts` (write empty file / check existence via `existsFile`).
- [ ] 1.3 Wire `writeProfileHasChats` into `ProfileAuthManager` after a successful server-side probe returns non-empty.
- [ ] 1.4 Wire `readProfileHasChats` into `ProfileAuthManager.probeServerSession` as the source of the "ever had chats" boolean.

## 2. Server-side probe in ProfileAuthManager

- [ ] 2.1 Add `PROBE_CACHE_TTL_MS` constant (default 150_000; read from `GEMITERM_PROBE_TTL_MS` env var with fallback; invalid values fall back to default).
- [ ] 2.2 Add private `probeCache: Map<string, { ts: number; result: "valid" | "stale" | "ambiguous" }>` field to `ProfileAuthManager`.
- [ ] 2.3 Implement `private async probeServerSession(name: string): Promise<"valid" | "stale" | "ambiguous">`:
  - Check `probeCache` for non-expired entry; return cached result if found.
  - Call `this.geminiClient.listChats({ limit: 1 })` on a client scoped to `name` (use `forProfile`).
  - If non-empty: write has-chats marker, cache "valid", return "valid".
  - If empty + has-chats flag exists: cache "stale", return "stale".
  - If empty + no has-chats flag: cache "ambiguous", return "ambiguous".
  - Catch errors -> log debug, return "ambiguous" (fall through to local freshness).
- [ ] 2.4 Modify `ensureAuthenticated`:
  - After `hasValidCookies` passes:
    - Call `probeServerSession(name)`.
    - If "valid": return cookies as before.
    - If "ambiguous": log debug-level message, return cookies.
    - If "stale": log warning, call `autoExtendSession(name)`.
      - If auto-extend returns `true`: re-probe (fresh call, skip cache) to update state, return cookies.
      - If auto-extend returns `false`: throw `AuthenticationError`.

## 3. RotateCookies L1 silent refresh (new)

- [ ] 3.1 Create `src/services/cookie-rotation.ts` with `rotateCookies(profileName: string): Promise<boolean>`:
  - Load full cookie jar via `cookieStorageService.loadAllCookiesForProfile`.
  - Build `Cookie` header string from loaded cookies (filter to `.google.com` domains).
  - POST `[000,"-0000000000000000000"]` to `https://accounts.google.com/RotateCookies` with headers:
    - `Content-Type: application/json`
    - `Origin: https://accounts.google.com`
    - `Cookie: <serialized cookies>`
  - On 200: parse `set-cookie` headers for new `__Secure-1PSIDTS`, `__Secure-3PSIDTS`, `SIDCC`.
  - Compare new PSIDTS against stored value: if different, merge into stored cookies, save via `saveCookiesForProfile`, return `true`. If same, return `false`.
  - On non-200 or error: return `false`.
- [ ] 3.2 Implement rate-limiting:
  - **Disk-mtime guard:** skip rotation if `storage_state.json` was modified within the last 600s (use `existsFile` + stat equivalent via `io.ts`). Add `getFileModifiedTime(path: string): number | null` to `io.ts` if needed. Skip guard on first call in a process.
  - **In-process throttle:** use a module-level `Map<string, Promise<boolean>>` to deduplicate concurrent rotate calls for the same profile.
- [ ] 3.3 Add `GEMITERM_SKIP_ROTATE_COOKIES` env var check (if set, skip L1 and go directly to L2). Document in `README.md`.
- [ ] 3.4 Wire `rotateCookies` into `AuthService.silentRefresh` as the first step (L1). Only proceed to headless browser (L2) if L1 returns `false`.

## 4. Headless browser L2 silent refresh hardening

- [ ] 4.1 Add `requireRotation` parameter to `CookieMonitor.start`:
  - Type: `{ activePsid: string; activePsidts: string | null } | undefined`.
  - In `poll()`: after `cookieListFromState`, compare returned PSID/PSIDTS against `requireRotation` values. If identical, return without firing `onCookiesFound`. If different, fire.
  - When `requireRotation` is `undefined`: existing behavior (fire on first poll with both cookies).
- [ ] 4.2 Modify `AuthService.silentRefresh`:
  - L1: call `rotateCookies(name)`. If `true`, return `true`.
  - L2 (fallback): snap active cookie values, launch headless browser, `waitForSilentLogin` with `requireRotation`, compare returned values against snapshot. Return `true` only if values differ.

## 5. `persistRefreshedCookies` merge fix

- [ ] 5.1 In `GeminiClientService.persistRefreshedCookies` (`src/services/gemini-client-wrapper.ts:119-151`), change merge condition from `c.name === "__Secure-1PSID"` to `c.name === "__Secure-1PSID" && c.value === this.baselineSecure1psid`. Same for `__Secure-1PSIDTS`.

## 6. Existing test updates

- [ ] 6.1 Update `tests/services/profile-auth-manager.test.ts`: add tests for probe valid/stale/ambiguous paths, caching, has-chats marker.
- [ ] 6.2 Update `tests/services/auth-service.test.ts`: add tests for L1 rotation success/failure, L2 fallback, cookie value comparison.
- [ ] 6.3 Update `tests/services/cookie-monitor.test.ts`: add `requireRotation` tests (no fire on identical, fire on different, existing behavior preserved).
- [ ] 6.4 Create `tests/services/cookie-rotation.test.ts`: test RotateCookies POST with mocked HTTP (return fresh PSIDTS, return 401, return same value, network error).
- [ ] 6.5 Update `tests/services/gemini-client-wrapper.test.ts`: add multi-domain merge test, update existing tests for `(name, baselineValue)` matching.

## 7. Phantom-auth regression tests go green

- [ ] 7.1 Run `bun test tests/services/phantom-auth.test.ts` and confirm all 5 scenarios pass.
- [ ] 7.2 Adjust mock assertions if implementation details differ from the test's expected call patterns.

## 8. Baseline, typecheck, and documentation

- [ ] 8.1 Run full `bun test` suite. Confirm 5 phantom-auth tests pass, no regressions.
- [ ] 8.2 Update `docs/testing-baseline.xml`: new counts and `<LastUpdated>` timestamp.
- [ ] 8.3 Run `bun run typecheck` and confirm clean.
- [ ] 8.4 Add env var docs to `README.md`: `GEMITERM_PROBE_TTL_MS`, `GEMITERM_SKIP_ROTATE_COOKIES`.
- [ ] 8.5 Add entry to `CHANGELOG.md` under "Unreleased" describing the fix.

## 9. OpenSpec delta specs

- [ ] 9.1 Write `specs/phantom-auth-detection/spec.md` (ADDED: server-side probe, has-chats flag, probe cache, env var).
- [ ] 9.2 Write `specs/silent-refresh-tightening/spec.md` (ADDED: RotateCookies L1, headless L2, `requireRotation`, rotation rate-limiting).
- [ ] 9.3 Write `specs/auth/spec.md` (MODIFIED: `ensureAuthenticated` probe path, `silentRefresh` ladder).
- [ ] 9.4 Write `specs/gemini-client/spec.md` (MODIFIED: `persistRefreshedCookies` merge key).
- [ ] 9.5 Run `npx openspec validate --strict phantom-auth-ultimate-fix` and confirm pass.
