# storage spec delta — `prevent-auth-complexities`

**Status:** Post-change (v2.4.3)
**Date:** 2026-08-09

## Modified Requirements

### Requirement: ProfileManager.hasRequiredCookies returns true when __Secure-1PSID is present (no freshness gate, no PSIDTS requirement)

The `ProfileManager.hasRequiredCookies(profileName)` method MUST return `true` exactly when the profile's `storage_state.json` cookie list contains a cookie with `name === "__Secure-1PSID"`, regardless of the cookie's local `expires` timestamp and regardless of the presence of `__Secure-1PSIDTS`. The method MUST NOT consult any local freshness threshold or expiry comparison. The previous 7-day `__Secure-1PSIDTS.expires` gate (via `checkCookieFreshness`) is removed.

#### Scenario: Expired cookies report as having required cookies

- **WHEN** `hasRequiredCookies("dormant")` is called and the profile's cookie list contains `__Secure-1PSID` and `__Secure-1PSIDTS`, both with `expires` timestamps in the past
- **THEN** the method returns `true`

#### Scenario: PSID-only profile reports as having required cookies

- **WHEN** `hasRequiredCookies("psid-only")` is called and the profile's cookie list contains `__Secure-1PSID` (no `__Secure-1PSIDTS`)
- **THEN** the method returns `true`

#### Scenario: PSIDTS-only profile reports as not having required cookies

- **WHEN** `hasRequiredCookies("psidts-only")` is called and the profile's cookie list contains only `__Secure-1PSIDTS` (no `__Secure-1PSID`)
- **THEN** the method returns `false`

#### Scenario: Missing profile reports as not having required cookies

- **WHEN** `hasRequiredCookies("ghost")` is called and no `storage_state.json` exists for the profile
- **THEN** the method returns `false`

### Requirement: ProfileManager.loadCookiesForApi trusts the on-disk cookies (no freshness gate)

The `ProfileManager.loadCookiesForApi(profileName)` method MUST return `{ secure1psid, secure1psidts: null }` for the named profile. The method MUST throw an `Error` whose message contains `Missing required cookie __Secure-1PSID` when the profile's cookie list does not contain `__Secure-1PSID`. The method MUST NOT consult a freshness threshold. When `__Secure-1PSIDTS` is present, its value is returned in `secure1psidts`; when absent, `secure1psidts` is `null`.

#### Scenario: Returns PSID and PSIDTS for fresh profile

- **WHEN** `loadCookiesForApi("default")` is called and the profile's cookie list contains both `__Secure-1PSID` and `__Secure-1PSIDTS`
- **THEN** the method returns `{ secure1psid: <psid>, secure1psidts: <psidts> }`

#### Scenario: Returns PSID with null PSIDTS for PSID-only profile

- **WHEN** `loadCookiesForApi("psid-only")` is called and the profile's cookie list contains only `__Secure-1PSID`
- **THEN** the method returns `{ secure1psid: <psid>, secure1psidts: null }`

#### Scenario: Returns values for expired cookies

- **WHEN** `loadCookiesForApi("dormant")` is called and the profile's cookie list contains `__Secure-1PSID` and `__Secure-1PSIDTS` with `expires` timestamps in the past
- **THEN** the method returns the cookie values (not a throw); the freshness gate no longer applies

#### Scenario: Throws when PSID is missing

- **WHEN** `loadCookiesForApi("psidts-only")` is called and the profile's cookie list contains only `__Secure-1PSIDTS` (no `__Secure-1PSID`)
- **THEN** the method throws an `Error` whose message contains `Missing required cookie __Secure-1PSID` and the profile name

### Requirement: ProfileManager.getStatus.isActive reflects required-cookie presence, not expiry

The `ProfileManager.getStatus(name)` method MUST return `isActive = hasRequired` (the same as the `hasRequiredCookies` check: `__Secure-1PSID` is present in the cookie list). The method MUST NOT apply a hard past-expiry filter to `isActive`. The `expiresAt` field MUST continue to be populated from the cookie list's `__Secure-1PSID` / `__Secure-1PSIDTS` `expires` timestamps (whichever is later, in ISO 8601 form) for user reference, but it MUST NOT be used to flip `isActive` to `false`.

#### Scenario: Expired cookies report as active in getStatus

- **WHEN** `getStatus("dormant")` is called and the profile's cookie list contains `__Secure-1PSID` and `__Secure-1PSIDTS` with `expires` timestamps in the past
- **THEN** the returned `ProfileStatus` has `exists: true`, `isActive: true`, and `expiresAt` populated with the on-disk expiry timestamp

#### Scenario: Session cookies (expires: -1) report as active

- **WHEN** `getStatus("session")` is called and the profile's cookie list contains cookies with `expires: -1` (browser session cookies, not persisted)
- **THEN** the returned `ProfileStatus` has `exists: true`, `isActive: true`, and `expiresAt: null`

#### Scenario: Missing PSID reports as inactive in getStatus

- **WHEN** `getStatus("psidts-only")` is called and the profile's cookie list contains only `__Secure-1PSIDTS` (no `__Secure-1PSID`)
- **THEN** the returned `ProfileStatus` has `exists: true`, `isActive: false`, and `expiresAt: null`

#### Scenario: Missing profile reports as not-exists

- **WHEN** `getStatus("ghost")` is called and no profile directory exists for the profile
- **THEN** the returned `ProfileStatus` has `exists: false`, `isActive: false`, `expiresAt: null`, and `lastUsedAt: null`

### Requirement: CookieStorageService.validateCookies returns true when __Secure-1PSID is present

The `CookieStorageService.validateCookies(cookies)` method MUST return `true` exactly when the supplied cookie list contains a cookie with `name === "__Secure-1PSID"`, regardless of the presence of `__Secure-1PSIDTS` and regardless of any cookie's `expires` value. The previous "both PSID and PSIDTS required" rule is removed.

#### Scenario: validateCookies returns true with PSID and PSIDTS

- **WHEN** `validateCookies(freshCookies)` is called and the list contains both `__Secure-1PSID` and `__Secure-1PSIDTS`
- **THEN** the method returns `true`

#### Scenario: validateCookies returns true with PSID only

- **WHEN** `validateCookies(psidOnlyCookies)` is called and the list contains only `__Secure-1PSID` (no `__Secure-1PSIDTS`)
- **THEN** the method returns `true`

#### Scenario: validateCookies returns false without PSID

- **WHEN** `validateCookies(psidtsOnlyCookies)` is called and the list contains only `__Secure-1PSIDTS` (no `__Secure-1PSID`)
- **THEN** the method returns `false`

#### Scenario: validateCookies returns false for empty list

- **WHEN** `validateCookies([])` is called
- **THEN** the method returns `false`

### Requirement: CookieStorageService no longer exposes checkCookieFreshness

The `CookieStorageService` class MUST NOT expose a `checkCookieFreshness` method. The `COOKIE_EXPIRY_THRESHOLD_MS` constant MUST be removed from the module. Callers that previously needed to know whether a cookie list was "fresh enough" MUST NOT exist; any such gate was removed in this change.

#### Scenario: Module no longer exports the freshness-gate surface

- **WHEN** the test suite imports the `cookie-storage-service` module
- **THEN** the module surface does not include `checkCookieFreshness` or `COOKIE_EXPIRY_THRESHOLD_MS`

### Requirement: GeminiClientService.persistRefreshedCookies writes a 1-year expires horizon

The `GeminiClientService.persistRefreshedCookies` method MUST write `expires = Math.floor((Date.now() + 365 * 24 * 60 * 60 * 1000) / 1000)` (one year) for the SDK-rotated `__Secure-1PSID` and `__Secure-1PSIDTS` values it persists back to disk. The previous 7-day horizon is removed.

#### Scenario: Persisted expires is one year in the future

- **WHEN** `persistRefreshedCookies` runs and the SDK has rotated `__Secure-1PSID` (or PSIDTS) to a new value
- **THEN** the saved `storage_state.json` has the rotated cookie's `expires` field set to `Math.floor((Date.now() + 365 * 24 * 60 * 60 * 1000) / 1000)` seconds (rounded to the nearest second)

#### Scenario: Persisted expires is the actual SDK-rotated value when no rotation occurred

- **WHEN** `persistRefreshedCookies` runs and the SDK has not rotated the cookies (values match the baselines)
- **THEN** no write occurs and the saved `storage_state.json` is unchanged

## What is NOT modified

- The `CookieStorage` class surface (`save`, `load`, `delete`, `list`) is unchanged.
- The `ProfileManager` lifecycle methods (`create`, `delete`, `rename`, `setDefault`, `getDefault`, `list`, `getAllStatuses`) are unchanged.
- The on-disk file format (`storage_state.json` with shape `{ cookies: Cookie[] }`) is unchanged.
- The path resolution (`getConfigDir`, `getProfileDir`, `getProfilePath`) is unchanged.
- The `getAllStatuses` method iterates `listProfiles()` and calls `getStatus`; its signature and return shape are unchanged.
