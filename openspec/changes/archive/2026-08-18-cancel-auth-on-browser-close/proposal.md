# Proposal: cancel-auth-on-browser-close

Sequence: cancel-auth-on-browser-close. Source: 2026-08-18 field report — closing the headed browser during `gemiterm auth --add <profile>` produced ~150 `Gate poll failed` debug lines over five minutes before timing out, masking the actual user action (cancel).

## Why

`CookieSession.waitForGate` classifies every `cookieList` failure as transient and retries until `LoginTimeoutError` after `DEFAULT_LOGIN_TIMEOUT_MS` (5 minutes). When the user closes the headed browser, `@playwright/cli` exits non-zero with `Browser '<session>' is not open` and the loop keeps polling anyway. The user-facing symptom is a five-minute loop of irrelevant log lines, not a fast, well-formed cancellation. The teardown path (`closeSession`) already swallows the related `not found` error, so the gate poll just needs the same classifier.

## What Changes

- **Typed cancellation error**: new `LoginCancelledError` in `src/core/errors.ts` (extends `GemitermError`), distinct from `LoginTimeoutError`.
- **Browser-closed classifier**: `isBrowserClosedError` exported from `src/services/playwright-cli-driver.ts` matches both `is not open` and `not found` markers on `PlaywrightCliError.message` (case-insensitive). `closeSession` reuses it without behavior change.
- **Gate short-circuit**: `CookieSession.waitForGate` (`src/auth/cookie-session.ts`) rethrows as `LoginCancelledError` on the first classified error, emits one info-level log, and skips the timeout. The capture `finally` still closes the browser; `cookieListFromState` and `saveFullJar` are unreachable.
- **CLI exit semantics**: `src/cli/index.ts` detects `LoginCancelledError`, logs the typed message at info level, and exits with code 0 (no error stack to the user; explicit cancellation is not a command failure).

## Capabilities

### New Capabilities

_(none — this change is fully contained in the existing auth capability.)_

### Modified Capabilities

- `auth`: `CookieSession.captureLogin` rejects with `LoginCancelledError` (new typed error) when the headed browser is closed mid-flight; the close teardown remains idempotent and no jar write occurs; the CLI handler renders the cancellation as a friendly info message and exits 0.

## Impact

- **Code**:
  - `src/core/errors.ts` — add `LoginCancelledError`.
  - `src/services/playwright-cli-driver.ts` — export `isBrowserClosedError`, drop the local `BROWSER_CLOSED_MESSAGE` constant, point `closeSession` at the new helper.
  - `src/auth/cookie-session.ts` — short-circuit `waitForGate` on classified closed-browser errors; import the new error + helper.
  - `src/cli/index.ts` — special-case the new typed error.
- **Tests**:
  - `tests/auth/cookie-session.test.ts` — new cancellation + transient-still-times-out cases.
  - `tests/services/playwright-cli-driver.test.ts` — new classifier + `closeSession` is-not-open swallow case.
  - `tests/integration/commands/auth.test.ts` — propagation of `LoginCancelledError` from `AuthCommand`.
  - `tests/auth-regression/invariant-capture-integrity.test.ts` — new `capture cancellation on browser close` invariant (on-disk jar byte-unchanged + no `cookieListFromState` + exactly one cancellation log + `closeSession` ran).
- **Docs**: `docs/auth-cookie-lifecycle.md` changelog entry appended.
- **Not changed**: cookie-name filtering rules, storage format, capture semantics on success, other command exit codes.

## Verification

- `bun test tests/auth/cookie-session.test.ts tests/services/playwright-cli-driver.test.ts tests/integration/commands/auth.test.ts tests/auth-regression/invariant-capture-integrity.test.ts` — focused suite.
- `bun run typecheck`, `bun test --isolate`, `bun run lint:mediation` (bash form on Windows).
- `bun run check:auth-gate` — must be green; this change touches every auth-sensitive path and updates `tests/auth-regression/` plus `docs/auth-cookie-lifecycle.md` in the same commit.
- `openspec validate --all --strict`.
- Live verification: `gemiterm auth --add test-close`, close the headed browser, observe one info-level cancellation line and a sub-second exit instead of the five-minute loop.