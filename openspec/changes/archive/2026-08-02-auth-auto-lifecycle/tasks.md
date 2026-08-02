## 1. Storage layer — export freshness check

- [x] 1.1 Export `checkCookieFreshness` as a public function from `src/infrastructure/storage.ts` (remove `function` keyword's module-private scope, add `export`)
- [x] 1.2 Update `tests/infrastructure/storage.test.ts`: verify `checkCookieFreshness` is importable and returns correct results for fresh, near-expiry, and expired cookies

> **Commit point**: `feat(storage): export checkCookieFreshness for use by auth lifecycle`

## 2. PlaywrightCliDriver — headless browser support

- [x] 2.1 Add `buildOpenHeadlessArgs(url, profile, session?)` method to `PlaywrightCliDriver` in `src/services/playwright-cli-driver.ts` — same as `buildOpenHeadedArgs` but without `--headed` and without `--persistent`
- [x] 2.2 Add `openHeadless(url, profile, session?)` async method delegating to `buildOpenHeadlessArgs` + `runCli`
- [x] 2.3 Update `tests/services/playwright-cli-driver.test.ts`: verify `buildOpenHeadlessArgs` omits `--headed` and `--persistent`, verify `openHeadless` calls `runCli` with expected args

> **Commit point**: `feat(driver): add openHeadless for silent session refresh`

## 3. AuthService — silent refresh

- [x] 3.1 Add `silentRefresh(profileName: string): Promise<boolean>` method to `AuthService` in `src/services/auth-service.ts`
  - Resolve profile name, validate it
  - Launch headless browser via `this.driver.openHeadless(GEMINI_AUTH_URL, name, name)`
  - Load existing cookies via `this.driver.stateLoad(name, getProfilePath(name))` (skip if file doesn't exist)
  - Use `CookieMonitor.start` with a 30s timeout (pass `30_000`)
  - Wrap in try/finally to always call `this.closeBrowser(name)`
  - Return `true` if monitor fires callback, `false` on timeout or any failure
  - No console output
- [x] 3.2 Update `tests/services/auth-service.test.ts`: verify `silentRefresh` launches headless, loads state, uses 30s monitor timeout, returns `true` on success, returns `false` on timeout, returns `false` on driver failure

> **Commit point**: `feat(auth): add silentRefresh for headless session extension`

## 4. ProfileAuthManager — auto-extend integration

- [x] 4.1 Add `SilentRefreshFn` type: `(profileName: string) => Promise<boolean>` — injected dependency
- [x] 4.2 Add `autoExtendSession(profileName: string): Promise<boolean>` method to `ProfileAuthManager` in `src/services/profile-auth-manager.ts`
  - Load cookies from storage, call `checkCookieFreshness`
  - If already fresh: return `true` immediately
  - If not fresh: call injected `silentRefresh`, return its result
  - If load fails (no profile): return `false`
- [x] 4.3 Modify `ensureAuthenticated(profileName?)` — after `hasValidCookies` returns `false`, call `await this.autoExtendSession(name)` before throwing
  - If auto-extend returns `true`: log `"Session auto-refreshed for profile '<name>'"` at info level, return `loadCookiesForProfile(name)`
  - If auto-extend returns `false`: throw `AuthenticationError` (existing behavior)
- [x] 4.4 Update `ProfileAuthManagerDeps` interface to include the `silentRefresh` injection
- [x] 4.5 Update `tests/services/profile-auth-manager.test.ts`:
  - Verify `autoExtendSession` returns `true` when cookies are fresh (no browser call)
  - Verify `autoExtendSession` calls `silentRefresh` when within grace window
  - Verify `ensureAuthenticated` auto-extends before throwing
  - Verify `ensureAuthenticated` logs "Session auto-refreshed" on success
  - Verify `ensureAuthenticated` throws `AuthenticationError` when auto-extend fails

> **Commit point**: `feat(profiles): add autoExtendSession and wire into ensureAuthenticated`

## 5. CLI — reauth prompt and retry

- [x] 5.1 Make `getGeminiClient()` async in `src/cli/index.ts:setupMediator`
  - Wrap `loadCookiesForApi` + client construction in try/catch for `AuthenticationError`
  - On error, import `confirm` from `src/cli/utils/prompts.ts`
  - Show: `"Session for profile 'X' has expired. Would you like to launch browser to re-authenticate? (y/n)"` (default: `true`)
  - On `true`: run auth flow (headed browser, save cookies), retry `loadCookiesForApi` + client construction once
  - On `false` or `CancellationError` or `NonInteractiveError`: re-throw original `AuthenticationError`
- [x] 5.2 The confirm prompt MUST NOT import from `@inquirer/prompts` directly — use the facade
- [x] 5.3 Ensure the `--profile/-p` flag is respected — the profile name in the error message and reauth target matches the explicitly-specified profile
- [x] 5.4 Update all call sites in `setupMediator` that use `getGeminiClient()` to `await getGeminiClient()` (handler factories)
- [x] 5.5 Update `tests/cli/index.test.ts` (if one exists) or create integration-level tests to verify:
  - Reauth prompt shown and auth flow triggered on confirm
  - Error propagated on decline
  - Error propagated in non-TTY mode

> **Commit point**: `feat(cli): add reauth prompt and retry on AuthenticationError`

## 6. Final verification

- [x] 6.1 Run `bun run typecheck` — confirm zero errors
- [x] 6.2 Run `bun test` — confirm all tests pass (baseline: 818+ pass, 0 fail)
- [x] 6.3 Run `bun run test:smoke` — confirm integration-level smoke tests pass
- [x] 6.4 Run `bash scripts/lint-path-mediation.sh` — confirm no new mediation violations
- [x] 6.5 Run the `code-review` skill and address findings

> **Commit point**: `chore: final verification — typecheck, tests, lint, code review`

---

**Keeping tasks.md in sync:** As you implement, check off completed tasks with `[x]`. If the test baseline count changes (new tests added), update the count in the AGENTS.md baseline note.
