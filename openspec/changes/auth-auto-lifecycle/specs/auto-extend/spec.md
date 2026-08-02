## ADDED Requirements

### Requirement: AuthService.silentRefresh attempts headless session refresh
The `AuthService.silentRefresh(profileName)` method MUST launch a headless Chromium browser via `PlaywrightCliDriver.openHeadless`, load existing cookies via `stateLoad` into the session, navigate to `https://gemini.google.com/app`, and monitor for login detection using `CookieMonitor` with a 30-second timeout. The method MUST return `true` if the monitor detects fresh auth cookies within the timeout, and `false` otherwise. The method MUST always close the browser session in a `finally` block, regardless of success or failure. The method MUST NOT print any UI messages (silent operation). The method MUST NOT throw on timeout or browser errors — it returns `false` for any failure case.

#### Scenario: Silent refresh succeeds when Google recognizes existing cookies
- **WHEN** `silentRefresh("test-profile")` is called and the headless browser loads existing cookies that Google still recognizes as valid
- **THEN** the method launches a headless browser via `openHeadless` with the Gemini URL, calls `stateLoad` with `getProfilePath("test-profile")`, calls `CookieMonitor.start` with a 30s timeout, and returns `true` when the monitor detects auth cookies
- **AND** the browser session is closed via `closeSession` in the `finally` block

#### Scenario: Silent refresh returns false when cookies are expired on Google's side
- **WHEN** `silentRefresh("expired-profile")` is called and the loaded cookies are no longer recognized (Google shows login page)
- **THEN** the `CookieMonitor` does not detect auth cookies within 30s, the monitor stops, the browser is closed, and the method returns `false`

#### Scenario: Silent refresh returns false on browser launch failure
- **WHEN** `silentRefresh("test-profile")` is called and `openHeadless` throws (e.g., playwright-cli not available)
- **THEN** the method catches the error and returns `false` without throwing
- **AND** the browser close is still attempted in the `finally` block

#### Scenario: Silent refresh does not print to stdout
- **WHEN** `silentRefresh("test-profile")` is called and succeeds
- **THEN** no console output is produced (no `console.log` or `console.error` calls from the method itself)

#### Scenario: Silent refresh uses 30-second timeout
- **WHEN** `silentRefresh("test-profile")` is called
- **THEN** `CookieMonitor.start` is invoked with `timeoutMs` of `30_000` (30 seconds)

### Requirement: PlaywrightCliDriver.openHeadless launches a headless browser
The `PlaywrightCliDriver` class MUST expose an `openHeadless(url, profile, session?)` method that builds the same argument array as `openHeaded` but omits the `--headed` flag, resulting in a headless Chromium session. The method MUST NOT include the `--persistent` flag (the silent refresh uses an ephemeral session; cookies are loaded via `stateLoad`). The method MUST accept the same parameters as `openHeaded`: `url: string`, `profile: string`, and optional `session: string`.

#### Scenario: openHeadless builds args without --headed
- **WHEN** `openHeadless("https://gemini.google.com/app", "p1", "s1")` is called
- **THEN** the runner is invoked with args containing `-s=s1`, `open`, `https://gemini.google.com/app`, `--browser=chromium`, and `--profile=<dir>/p1`, but does NOT contain `--headed`
- **AND** the args do NOT contain `--persistent`

#### Scenario: openHeadless resolves successfully
- **WHEN** `openHeadless("https://example.com", "p1")` is called without a session identifier
- **THEN** the runner is invoked with args NOT containing `-s=` and the method resolves when the browser launches
