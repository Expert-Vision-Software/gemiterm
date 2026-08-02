## ADDED Requirements

### Requirement: ProfileAuthManager.autoExtendSession attempts silent refresh
The `ProfileAuthManager.autoExtendSession(profileName)` method MUST attempt to silently extend a near-expiry session. The method MUST:
1. Load the profile's cookies from `cookieStorageService.load(profileName)` (or equivalent storage access)
2. Call `checkCookieFreshness(cookies)` from `src/infrastructure/storage.ts` to determine if cookies are within the 1-hour grace window
3. If cookies are fresh (outside the window), return `true` immediately (no action needed)
4. If cookies are within the window (not fresh), call a provided `silentRefresh` function (injected as a dependency) with the profile name
5. Return the boolean result of `silentRefresh`

If loading the cookies fails (no profile, no storage file), the method MUST return `false` without throwing.

#### Scenario: autoExtendSession returns true when cookies are already fresh
- **WHEN** `autoExtendSession("default")` is called and the profile's cookies are fresh (outside the 1-hour grace window)
- **THEN** the method returns `true` without calling `silentRefresh`
- **AND** no browser is launched

#### Scenario: autoExtendSession returns true when silent refresh succeeds
- **WHEN** `autoExtendSession("default")` is called and cookies are within the 1-hour grace window, and the injected `silentRefresh` returns `true`
- **THEN** the method returns `true`

#### Scenario: autoExtendSession returns false when silent refresh fails
- **WHEN** `autoExtendSession("default")` is called and cookies are within the 1-hour grace window, and the injected `silentRefresh` returns `false`
- **THEN** the method returns `false`

#### Scenario: autoExtendSession returns false when profile has no cookies
- **WHEN** `autoExtendSession("ghost")` is called and no storage file exists for the profile
- **THEN** the method returns `false` without throwing

### Requirement: ProfileAuthManager.ensureAuthenticated triggers auto-extend before throwing
The `ProfileAuthManager.ensureAuthenticated(profileName?)` method MUST attempt auto-extend when cookies are not valid, before throwing `AuthenticationError`. The updated flow MUST be:
1. Resolve and validate the profile name (unchanged)
2. Check `profileManager.hasValidCookies(name)` (unchanged)
3. If cookies are NOT valid, call `autoExtendSession(name)`
4. If `autoExtendSession` returns `true`, proceed to load and return cookies (step 5)
5. If `autoExtendSession` returns `false`, throw `AuthenticationError`
6. If cookies ARE valid (step 2 passed), return `cookieStorageService.loadCookiesForProfile(name)` (unchanged)

The method MUST log a brief `"Session auto-refreshed for profile '<name>'"` message at info level when auto-extend succeeds, before returning cookies.

#### Scenario: ensureAuthenticated auto-extends and succeeds
- **WHEN** `ensureAuthenticated("default")` is called, `hasValidCookies` returns `false`, and `autoExtendSession` returns `true`
- **THEN** the method logs `"Session auto-refreshed for profile 'default'"` and returns the `LoadedCookies` for the profile
- **AND** `AuthenticationError` is NOT thrown

#### Scenario: ensureAuthenticated auto-extends and fails, throws error
- **WHEN** `ensureAuthenticated("default")` is called, `hasValidCookies` returns `false`, and `autoExtendSession` returns `false`
- **THEN** the method throws `AuthenticationError` with the message containing `"No valid session for profile 'default'"`
- **AND** the logged message does NOT include `"Session auto-refreshed"`

#### Scenario: ensureAuthenticated skips auto-extend when cookies are valid
- **WHEN** `ensureAuthenticated("default")` is called and `hasValidCookies` returns `true`
- **THEN** `autoExtendSession` is NOT called and the method returns `LoadedCookies` directly

## MODIFIED Requirements

### Requirement: ProfileAuthManager.ensureAuthenticated returns cookies or throws
The `ProfileAuthManager.ensureAuthenticated(profileName?)` method MUST resolve the profile name (provided value, or the configured default), validate it, and check that the profile has valid cookies. If `profileManager.hasValidCookies(name)` returns `false`, the method MUST first attempt `autoExtendSession(name)`. If auto-extend succeeds (returns `true`), the method MUST log an info-level `"Session auto-refreshed for profile '<name>'"` message and return the result of `cookieStorageService.loadCookiesForProfile(name)`. If auto-extend fails (returns `false`), the method MUST throw an `AuthenticationError` whose message contains `No valid session for profile '<name>'` and the substring `gemiterm login`. If the cookies are valid on initial check, the method MUST return the result of `cookieStorageService.loadCookiesForProfile(name)` without attempting auto-extend.

#### Scenario: Returns cookies for a profile with valid session
- **WHEN** `ensureAuthenticated("default")` is called and the default profile has fresh cookies
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
- **THEN** it throws an `AuthenticationError` whose message contains `No valid session`

#### Scenario: Uses default profile when none specified
- **WHEN** `ensureAuthenticated()` is called with no argument and the configured default profile has valid cookies
- **THEN** it returns the loaded cookies for the default profile

#### Scenario: Throws on invalid profile name
- **WHEN** `ensureAuthenticated("bad name!")` is called
- **THEN** it throws an error whose message contains `invalid characters`
