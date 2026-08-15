## MODIFIED Requirements

### Requirement: AuthService.authenticate orchestrates the full login flow
The `AuthService.authenticate(profileName?)` method MUST be the single entry point for the login flow. When called, it MUST resolve the profile name (using the provided name, or the configured default), validate it, log an info-level "Starting authentication" message, and then in order: print a one-shot headed-browser notification, launch the browser via `PlaywrightCliDriver.openHeaded("https://gemini.google.com/app", profileName, profileName)`, wait up to 300000 ms (5 minutes) for the cookie monitor to report auth cookies, persist the captured cookies via `CookieSession.commit` (validated at write time), compute the session expiry with the single expiry computation, and print a confirmation message containing the cookie count and the expiration date (when known). The browser session MUST always be closed in a `finally` block, even if the wait or persist step throws.

#### Scenario: Successful authentication returns cookies and expiry
- **WHEN** `authenticate("test-profile")` is called and the cookie monitor reports both `__Secure-1PSID` and `__Secure-1PSIDTS` before the timeout
- **THEN** the method resolves with an `AuthResult` whose `cookies` array contains the captured cookies (both tracked names plus any companion cookies Google returned), whose `expiresAt` comes from the single expiry computation (max positive `expires` across `__Secure-1PSID`/`__Secure-1PSIDTS`), the driver `openHeaded` is called exactly once with the Gemini app URL, the cookie monitor `start` is called exactly once, the session `commit` is called exactly once for the profile, and the driver `closeSession` is called exactly once with the profile name

#### Scenario: Captured cookies are validated at write time
- **WHEN** the cookie monitor reports a set whose merge fails tier 1 validation (no usable `__Secure-1PSID`)
- **THEN** `CookieSession.commit` does not overwrite the profile's persisted cookies and the failure surfaces from `authenticate`

#### Scenario: Driver is opened with the Gemini app URL and the profile as session
- **WHEN** `launchBrowser("my-profile")` is called via the public flow
- **THEN** the driver `openHeaded` is invoked with `"https://gemini.google.com/app"` as the URL, `"my-profile"` as the profile, and `"my-profile"` as the session identifier

#### Scenario: Browser is closed in a finally block on error
- **WHEN** `authenticate("test-profile")` is called and `waitForLogin` throws (e.g. timeout)
- **THEN** the driver `closeSession` is still invoked with the profile name (verified by `expect(driver.closeSession).toHaveBeenCalledWith("test-profile")`)

#### Scenario: Invalid profile name is rejected
- **WHEN** `authenticate("bad name!")` is called
- **THEN** the method rejects with an error whose message contains `invalid characters`

#### Scenario: Authentication timeout is surfaced as AuthServiceTimeoutError
- **WHEN** `waitForLogin` is called and the cookie monitor never invokes its callback before the timeout fires
- **THEN** the method rejects with an `AuthServiceTimeoutError` whose message contains the configured timeout in milliseconds and the substring `No auth cookies detected`, and the cookie monitor `stop` has been called

### Requirement: ProfileAuthManager.ensureAuthenticated returns cookies or throws
The `ProfileAuthManager.ensureAuthenticated(profileName?)` method MUST resolve the profile name (provided value, or the configured default), validate it, and delegate session readiness to `CookieSession.ensureSession(name)`. If the session cannot be made ready, the method MUST throw an `AuthenticationError` whose message contains `No valid session for profile '<name>'` and the substring `gemiterm login`. On success, the method MUST return the loaded cookie pair (the `LoadedCookies` shape: `secure_1psid: string`, `secure_1psidts: string | null`) sourced from the session. The method MUST NOT perform its own validation or freshness checks.

#### Scenario: Returns cookies for a profile with valid session
- **WHEN** `ensureAuthenticated("default")` is called and the default profile has fresh cookies
- **THEN** it returns a `LoadedCookies` object whose `secure_1psid` and `secure_1psidts` match the stored values

#### Scenario: Throws AuthenticationError when no valid cookies
- **WHEN** `ensureAuthenticated("default")` is called and the profile has no cookies
- **THEN** it throws an `AuthenticationError` whose message contains `No valid session`

#### Scenario: Throws AuthenticationError with expired cookies after recovery fails
- **WHEN** `ensureAuthenticated("default")` is called, the profile's cookies are expired, and the recovery ladder cannot recover the session
- **THEN** it throws an `AuthenticationError` whose message contains `No valid session`

#### Scenario: Uses default profile when none specified
- **WHEN** `ensureAuthenticated()` is called with no argument and the configured default profile has valid cookies
- **THEN** it returns the loaded cookies for the default profile

#### Scenario: Throws on invalid profile name
- **WHEN** `ensureAuthenticated("bad name!")` is called
- **THEN** it throws an error whose message contains `invalid characters`

## REMOVED Requirements

### Requirement: CookieStorageService loads and validates per-profile cookies
**Reason**: The `CookieStorageService` class is deleted; its responsibilities (load, extract, validate) are absorbed by `CookieSession.ensureSession` in the `cookie-session` capability.
**Migration**: Callers consume `CookieSession.ensureSession(profile)` which returns the same `secure_1psid`/`secure_1psidts` pair with the same missing-`__Secure-1PSID` error semantics.

### Requirement: CookieStorageService validates and computes cookie freshness
**Reason**: Boolean single-tier validation is replaced by the two-tier model (primary `__Secure-1PSID` binding; recoverable secondary `__Secure-1PSIDTS` binding) owned by the `cookie-session` capability.
**Migration**: Validation and freshness behavior is specified by the `cookie-session` requirements "Two-Tier Cookie Validation" (the single "not expired" rule — Google's `expires` is authoritative).

### Requirement: CookieStorageService computes cookie expiry
**Reason**: One of three divergent expiry computations; unified into the single `cookie-session` requirement "Single Expiry Computation".
**Migration**: Consume `CookieSession`'s expiry computation (max positive `expires` across `__Secure-1PSID`/`__Secure-1PSIDTS`).

### Requirement: CookieStorageService persists refreshed session cookies
**Reason**: The scattered persistence surface (service save + wrapper merge + auth bypass) is replaced by the single transactional `CookieSession.commit` boundary.
**Migration**: Wrapper-side persistence behavior is re-specified in the `gemini-client` capability requirement "GeminiClientService persists refreshed cookies through CookieSession"; the commit contract itself is the `cookie-session` requirement "commit Is the Only Persistence Path".
