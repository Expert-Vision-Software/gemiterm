# Tasks: cancel-auth-on-browser-close

## 1. Error type
- [x] 1.1 Add `LoginCancelledError` to `src/core/errors.ts`.

## 2. Classifier + driver reuse
- [x] 2.1 Export `isBrowserClosedError` from `src/services/playwright-cli-driver.ts`; match `is not open` and `not found` on `PlaywrightCliError.message` (case-insensitive).
- [x] 2.2 Point `closeSession` at the new helper (no behavior change).

## 3. Gate short-circuit
- [x] 3.1 In `CookieSession.waitForGate`, on a classified error log once at info level and throw `LoginCancelledError`; preserve the existing timeout path for unrelated errors.

## 4. CLI exit semantics
- [x] 4.1 In `src/cli/index.ts`, handle `LoginCancelledError` as info + exit 0; keep generic error path for everything else.

## 5. Tests
- [x] 5.1 `tests/auth/cookie-session.test.ts` — `captureLogin` rejects with `LoginCancelledError` on browser close; `closeSession` ran; `cookieListFromState` and `saveFullJar` not called; one info log, no debug thrash.
- [x] 5.2 `tests/auth/cookie-session.test.ts` — transient errors still time out with `LoginTimeoutError`.
- [x] 5.3 `tests/services/playwright-cli-driver.test.ts` — `is not open` swallow in `closeSession`; full `isBrowserClosedError` matrix.
- [x] 5.4 `tests/integration/commands/auth.test.ts` — `AuthCommand` propagates `LoginCancelledError`.
- [x] 5.5 `tests/auth-regression/invariant-capture-integrity.test.ts` — new invariant: capture cancellation on browser close preserves the pre-existing jar byte-for-byte and persists nothing.

## 6. Docs
- [x] 6.1 Append dated changelog entry to `docs/auth-cookie-lifecycle.md`.
- [x] 6.2 Update `Last Updated` line at top of `docs/auth-cookie-lifecycle.md`.

## 7. Verification
- [x] 7.1 `bun test tests/auth/cookie-session.test.ts tests/services/playwright-cli-driver.test.ts tests/integration/commands/auth.test.ts tests/auth-regression/invariant-capture-integrity.test.ts` — pass (86 tests across 4 files).
- [x] 7.2 `bun run typecheck` — clean.
- [x] 7.3 `bun test --isolate` — clean (960 pass / 2 skip / 0 fail / 2082 expects / 67 files; net +23 tests from this change).
- [x] 7.4 `bun run lint:mediation` (bash form on Windows) — clean.
- [x] 7.5 `bun run check:auth-gate` — green (this commit touches every auth-sensitive path and updates `tests/auth-regression/` + `docs/auth-cookie-lifecycle.md`).
- [x] 7.6 `openspec validate --all --strict` — green (31 passed / 0 failed).
- [ ] 7.7 Live: `gemiterm auth --add test-close`, close browser, observe single info line and fast exit. Pending — worktree has unrelated modifications; canary requires clean state, manual live verification deferred to user.
- [x] 7.8 `bun run build` — `dist/gemiterm` produced (bun-windows-x64).