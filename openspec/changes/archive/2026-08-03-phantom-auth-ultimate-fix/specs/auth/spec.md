## MODIFIED Requirements

### Requirement: ProfileAuthManager.ensureAuthenticated probes server before returning cookies

The existing requirement "Returns cookies for a profile with valid session"
is MODIFIED. When `ProfileAuthManager.ensureAuthenticated(profileName?)` is
called and `profileManager.hasValidCookies(name)` returns `true`, the method
MUST consult a server-side validity probe (calling
`geminiClient.listChats({ limit: 1 })`) before returning the loaded cookies.
This replaces the previous behavior where local cookie freshness alone was
sufficient to declare the session authenticated.

The probe result semantics are defined in the `phantom-auth-detection`
capability spec. The probe is memoized with a process-level cache (default TTL
150_000 ms, overridable via `GEMITERM_PROBE_TTL_MS`).

#### Scenario: Returns cookies for a profile with valid session (MODIFIED -- includes server probe)

- **WHEN** `ensureAuthenticated("default")` is called and the default profile
  has locally-valid cookies AND the server-side probe returns a non-empty
  chat list
- **THEN** it returns a `LoadedCookies` object whose `secure_1psid` and
  `secure_1psidts` match the stored values
- **AND** the per-profile has-chats marker is written to disk

### Requirement: AuthService.silentRefresh is a multi-layer recovery ladder

The existing requirement "AuthService.silentRefresh attempts headless session
refresh" is MODIFIED. The method MUST now implement a recovery ladder:

1. **L1 -- RotateCookies POST:** Call `rotateCookies(profileName)`. If `true`,
   return `true` immediately. No browser launch. No polling.
2. **L2 -- Headless browser (fallback):** Only reached when L1 returns
   `false`. Launch headless Chromium via `openHeadless`, load cookies via
   `stateLoad`, start `CookieMonitor` with `requireRotation` baseline. Return
   `true` only when the monitor returns values that differ from the snapshot.
   Close browser in `finally`.
3. Return `false` when both L1 and L2 fail.

The existing scenarios "Silent refresh returns false on timeout" and "Silent
refresh returns false on driver failure" remain valid.

#### Scenario: L1 RotateCookies succeeds, returns true immediately

- **WHEN** `silentRefresh("test-profile")` is called
- **AND** `rotateCookies("test-profile")` returns `true` (fresh PSIDTS)
- **THEN** the method returns `true` without launching a browser

#### Scenario: L1 fails, L2 headless browser succeeds with rotated cookies

- **WHEN** `silentRefresh("test-profile")` is called
- **AND** `rotateCookies` returns `false`
- **AND** the headless browser flow detects rotated cookies within 30s
- **THEN** the method returns `true` and the browser is closed

#### Scenario: Both L1 and L2 fail, returns false

- **WHEN** `silentRefresh("test-profile")` is called
- **AND** `rotateCookies` returns `false`
- **AND** the headless browser times out without rotation
- **THEN** the method returns `false`
