## ADDED Requirements

### Requirement: AuthService.silentRefresh attempts headless session refresh
The `AuthService.silentRefresh(profileName)` method MUST launch a headless Chromium browser via `PlaywrightCliDriver.openHeadless` targeting `https://gemini.google.com/app`, load existing cookies from disk via `stateLoad` using `getProfilePath(profileName)`, and use `CookieMonitor` with a 30-second timeout to detect fresh auth cookies. The method MUST return `true` if the monitor detects both required cookies within the timeout, and `false` otherwise. The method MUST ALWAYS close the browser session in a `finally` block. The method MUST NOT produce console output (silent operation). The method MUST NOT throw on any error (driver failure, timeout, missing profile) — all failures return `false`.

#### Scenario: Silent refresh succeeds and captures fresh cookies
- **WHEN** `silentRefresh("test-profile")` is called and Google recognizes the existing cookies as valid
- **THEN** `openHeadless` is called with the Gemini URL and `"test-profile"` profile, `stateLoad` is called with the profile's storage path, `CookieMonitor.start` is called with a 30s timeout, the monitor callback fires with auth cookies, and the method returns `true`
- **AND** `closeSession` is called in the `finally` block

#### Scenario: Silent refresh returns false on timeout
- **WHEN** `silentRefresh("test-profile")` is called and the `CookieMonitor` does not detect auth cookies within 30s
- **THEN** the monitor times out, `closeSession` is called, and the method returns `false`

#### Scenario: Silent refresh returns false on driver failure
- **WHEN** `silentRefresh("test-profile")` is called and `openHeadless` throws
- **THEN** the method catches the error, attempts `closeSession` in `finally`, and returns `false`

#### Scenario: Silent refresh returns false when profile has no saved cookies
- **WHEN** `silentRefresh("new-profile")` is called and no `storage_state.json` exists for that profile
- **THEN** the `stateLoad` call fails (or is skipped), `closeSession` is called, and the method returns `false`

### Requirement: PlaywrightCliDriver.openHeadless launches a headless browser
The `PlaywrightCliDriver` class MUST expose an `openHeadless(url, profile, session?)` method. The method MUST build the same argument array as `buildOpenHeadedArgs` but without the `--headed` flag and without the `--persistent` flag. The method MUST resolve when the browser launches successfully and MUST throw `PlaywrightCliError` on failure.

#### Scenario: openHeadless builds args without --headed and without --persistent
- **WHEN** `openHeadless("https://gemini.google.com/app", "p1", "s1")` is called
- **THEN** the runner is invoked with args containing `-s=s1`, `open`, `https://gemini.google.com/app`, `--browser=chromium`, and `--profile=<dir>/p1`
- **AND** the args do NOT contain `--headed`
- **AND** the args do NOT contain `--persistent`

#### Scenario: openHeadless without session works
- **WHEN** `openHeadless("https://example.com", "p1")` is called with no session argument
- **THEN** the args do NOT contain `-s=` and the method resolves successfully
