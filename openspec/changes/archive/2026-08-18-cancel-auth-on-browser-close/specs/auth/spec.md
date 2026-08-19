# Delta for auth

## ADDED Requirements

### Requirement: CookieSession.captureLogin rejects with LoginCancelledError on browser close

`CookieSession.captureLogin(profile)` MUST classify any `PlaywrightCliError` whose stderr contains the markers `is not open` or `not found` (case-insensitive) as a browser-closed condition. On the first such error from `driver.cookieList`, the gate loop MUST throw `LoginCancelledError` (a new typed error in `src/core/errors.ts`) instead of retrying until the login timeout. The gate loop MUST emit exactly one info-level log line containing `Gate poll cancelled` per cancellation. The existing `LoginTimeoutError` timeout path MUST remain in effect for all other errors.

The capture `finally` MUST still invoke `driver.closeSession` (which already swallows the `not found` teardown error). `driver.cookieListFromState` and `cookieStore.saveFullJar` MUST NOT be invoked after a `LoginCancelledError`.

The CLI top-level handler (`src/cli/index.ts`) MUST log the `LoginCancelledError` message at info level and exit with code 0. All other errors MUST continue to follow the existing `Command '<name>' failed: <message>` + exit 1 path.

#### Scenario: Headed browser closed mid-poll cancels capture with a typed error

- **WHEN** `captureLogin("p")` is running and the headed browser is closed before the gate cookies appear
- **THEN** the call rejects with `LoginCancelledError` (NOT `LoginTimeoutError`); `driver.closeSession("p")` is invoked; `driver.cookieListFromState("p")` and `cookieStore.saveFullJar("p", ...)` are NOT invoked; exactly one info-level log line containing `Gate poll cancelled` is emitted; no debug-level `Gate poll failed` lines are emitted for the closed-browser error.

#### Scenario: Transient cookieList errors still poll until timeout

- **WHEN** `driver.cookieList` rejects with a `PlaywrightCliError` whose stderr contains neither marker
- **THEN** the gate loop continues polling and eventually rejects with `LoginTimeoutError` (no behavior change).

#### Scenario: isBrowserClosedError matches both known markers

- **WHEN** the classifier is given a `PlaywrightCliError` with stderr `Browser foo is not open` or `session not found`
- **THEN** it returns `true`; for any other stderr text or a non-`PlaywrightCliError` value it returns `false`.

#### Scenario: CLI exit semantics for cancellation

- **WHEN** `AuthCommand.execute` rejects with `LoginCancelledError`
- **THEN** the CLI logs the message at info level and exits with code 0; the generic `Command 'auth' failed` error path is not used.