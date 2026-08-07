## MODIFIED Requirements

### Requirement: CookieMonitor polls every 2 seconds using a sign-out-link JS probe
The `CookieMonitor.start(session, onCookiesFound, timeoutMs?)` method MUST begin polling the browser session identified by `session` for the presence of the auth cookies. The poll cadence MUST be a 2-second interval (`POLL_INTERVAL_MS = 2000`). On each tick the monitor MUST run a JavaScript probe that detects a logged-in state by checking for the presence of `a[href^="https://accounts.google.com/SignOutOptions"]`; the probe expression MUST be exactly `document.querySelector('a[href^="https://accounts.google.com/SignOutOptions"]') !== null`. Only when the probe returns `true` (matched as a trimmed string `"true"`) MUST the monitor then read the cookie list and require BOTH `__Secure-1PSID` and `__Secure-1PSIDTS` to be present — this is the login GATE. Once the gate is satisfied, the monitor MUST invoke `onCookiesFound` with the FULL cookie list returned by `driver.cookieListFromState(session)`, not a subset filtered to the required names; the full auth cookie set the browser holds (e.g. `SID`, `HSID`, `SSID`, `APISID`, `SAPISID`, `__Secure-3PSID`, etc.) MUST be passed through so the downstream persistence path stores the complete jar. The monitor MUST also accept a `timeoutMs` parameter (default 300000 ms / 5 minutes) and MUST apply `.unref()` to the timeout handle so it does not block CLI process exit.

#### Scenario: Monitor fires callback on first tick where probe and cookies are both ready
- **WHEN** `start("sess1", cb, 10000)` is called and every 2-second tick returns `true` from the probe and returns both required cookies from `cookieList`
- **THEN** `cb` is invoked exactly once with the FULL cookie list that `driver.cookieListFromState` returned for that tick (which MUST include both `__Secure-1PSID` and `__Secure-1PSIDTS` plus any other cookies the browser holds), `isRunning` is `false`, and the interval has been cleared

#### Scenario: Monitor does not call driver immediately on start
- **WHEN** `start("sess1", cb, 10000)` is called
- **THEN** `driver.evalJs` is NOT called synchronously — the first eval call is scheduled by the interval and only happens after the 2-second delay

#### Scenario: Monitor does not call callback when probe returns false
- **WHEN** `start("sess1", cb, 10000)` is called and every tick returns `false` from the probe
- **THEN** `cb` is never invoked and `isRunning` is `false` after `stop()`

#### Scenario: Monitor swallows repeated eval throws
- **WHEN** `start("sess1", cb, 10000)` is called and every tick's `evalJs` rejects
- **THEN** `start` resolves successfully, `cb` is never invoked, and the monitor continues running (does not reject)

#### Scenario: Timeout handle is unref'd so CLI can exit
- **WHEN** `start("sess1", cb, 10000)` is called
- **THEN** the `setTimeout` handle used for the hard timeout has `unref()` called on it (the monitor must not keep the event loop alive past the timeout)

#### Scenario: Monitor does not fire when required cookies are absent even if companions are present
- **WHEN** `start("sess1", cb, 10000)` is called and a tick returns `true` from the probe and a cookie list that contains companion cookies (`SID`, `HSID`, …) but is missing at least one of `__Secure-1PSID` / `__Secure-1PSIDTS`
- **THEN** `cb` is NOT invoked on that tick (the login gate is the presence of both required cookies, regardless of companions)

### Requirement: CookieMonitor exposes checkLoggedIn and checkCookies helpers
The `CookieMonitor.checkLoggedIn(session)` method MUST return `true` when the sign-out-link probe evaluates to the string `"true"` (with surrounding whitespace allowed) and MUST return `false` for any other return value, including probe errors. The `CookieMonitor.checkCookies(session)` method MUST call `driver.cookieListFromState(session)`, and MUST use the presence of BOTH `__Secure-1PSID` and `__Secure-1PSIDTS` as a gate: when both are present in the returned list, the method MUST return the FULL list (all cookies the browser holds, not a subset filtered to the required names); when either required cookie is absent, the method MUST return an empty array. Both helpers MUST swallow driver errors and return `false` / `[]` respectively.

#### Scenario: checkLoggedIn returns true on probe success
- **WHEN** `driver.evalJs` returns the string `"true"`
- **THEN** `checkLoggedIn("sess1")` resolves with `true`

#### Scenario: checkLoggedIn returns false on whitespace-padded true
- **WHEN** `driver.evalJs` returns the string `"  true  \n"`
- **THEN** `checkLoggedIn("sess1")` resolves with `true` (whitespace is trimmed)

#### Scenario: checkLoggedIn returns false on probe throw
- **WHEN** `driver.evalJs` rejects
- **THEN** `checkLoggedIn("sess1")` resolves with `false` (does not throw)

#### Scenario: checkCookies returns required cookies when both present
- **WHEN** `driver.cookieListFromState` returns an array containing both `__Secure-1PSID` and `__Secure-1PSIDTS` alongside companion cookies (e.g. `SID`, `HSID`, `SSID`)
- **THEN** `checkCookies("sess1")` resolves with the FULL list (same length and entries as the browser state), which includes both required cookie names and the companions — not a length-2 filtered subset

#### Scenario: checkCookies returns empty when only one required cookie present
- **WHEN** `driver.cookieListFromState` returns only `__Secure-1PSID` (even if companion cookies are also present)
- **THEN** `checkCookies("sess1")` resolves with `[]`
