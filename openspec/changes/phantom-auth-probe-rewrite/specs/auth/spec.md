## MODIFIED Requirements

### Requirement: ProfileAuthManager.ensureAuthenticated probes server before returning cookies

The `ProfileAuthManager.ensureAuthenticated(profileName?)` method MUST resolve the profile name (provided value, or the configured default), validate it, and check that the profile has valid cookies. If `profileManager.hasValidCookies(name)` returns `false`, the method MUST first attempt `autoExtendSession(name)`. If auto-extend succeeds (returns `true`), the method MUST log an info-level `"Session auto-refreshed for profile '<name>'"` message and return the result of `cookieStorageService.loadCookiesForProfile(name)`. If auto-extend fails (returns `false`), the method MUST throw an `AuthenticationError` whose message contains `No valid session for profile '<name>'` and the substring `gemiterm login`. When `profileManager.hasValidCookies(name)` returns `true`, the method MUST consult a server-side validity probe (calling `geminiClient.models()`) before returning the loaded cookies. The probe result semantics are defined in the `phantom-auth-detection` capability spec. The probe is memoized with a process-level cache (default TTL 150_000 ms, overridable via `GEMITERM_PROBE_TTL_MS`).

#### Scenario: Returns cookies for a profile with valid session (MODIFIED — models() probe)

- **WHEN** `ensureAuthenticated("default")` is called and the default profile has locally-valid cookies AND the server-side `models()` probe succeeds
- **THEN** it returns a `LoadedCookies` object whose `secure_1psid` and `secure_1psidts` match the stored values

#### Scenario: Auto-extends session before throwing AuthenticationError

- **WHEN** `ensureAuthenticated("default")` is called and the profile's cookies are within the 1-hour grace window, but auto-extend succeeds
- **THEN** the method logs `"Session auto-refreshed for profile 'default'"` and returns the `LoadedCookies`
- **AND** `AuthenticationError` is NOT thrown

#### Scenario: Throws AuthenticationError when auto-extend fails on expired cookies

- **WHEN** `ensureAuthenticated("default")` is called and the profile's cookies are expired (or near-expiry) and auto-extend returns `false`
- **THEN** it throws an `AuthenticationError` whose message contains `No valid session`

#### Scenario: Throws AuthenticationError when no cookies exist and auto-extend fails

- **WHEN** `ensureAuthenticated("default")` is called and the profile has no cookies
- **THEN** it throws an `AuthenticationError` whose message contains `No valid session` and references `gemiterm login`
