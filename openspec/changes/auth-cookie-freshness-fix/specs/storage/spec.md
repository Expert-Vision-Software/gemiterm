## MODIFIED Requirements

### Requirement: Freshness and Validity
A profile's cookies are considered valid and fresh when ALL of the following are true: (a) the cookie set includes both `__Secure-1PSID` and `__Secure-1PSIDTS`, (b) the `__Secure-1PSIDTS` cookie has an `expires` value greater than 0, and (c) the resulting expiry timestamp (cookie `expires` in milliseconds) is later than `now + 1 hour` (the freshness threshold). The system MUST use these rules consistently in `hasValidCookies`, `getStatus`, and `loadCookiesForApi`.

#### Scenario: Freshness window uses 1-hour threshold
- **WHEN** a profile's `__Secure-1PSIDTS` cookie expires more than 1 hour from now
- **THEN** `hasValidCookies` and `getStatus` both report the profile as active

#### Scenario: Cookies inside the 1-hour window are not fresh
- **WHEN** a profile's `__Secure-1PSIDTS` cookie expires within 1 hour from now (or has already passed)
- **THEN** `hasValidCookies` returns `false` and `getStatus` reports `isActive: false`

### Requirement: ProfileManager.getStatus
The `ProfileManager` class MUST expose a `getStatus(name)` method returning a `ProfileStatus` object. The method MUST report `exists: false` and `isActive: false` (with `expiresAt: null`) when the profile's storage file does not exist. When the file exists, the method MUST attempt to load the cookies and compute `isActive` from cookie validity AND freshness (via `checkCookieFreshness`). If loading throws, the method MUST return `exists: true`, `isActive: false`, and `expiresAt: null`. The `isDefault` field MUST reflect whether `name` equals the current default profile name.

#### Scenario: Status for a valid active profile
- **WHEN** a profile has fresh `__Secure-1PSID` and `__Secure-1PSIDTS` cookies (expiring more than 1 hour from now)
- **THEN** `getStatus(name)` returns `exists: true`, `isActive: true`, a non-null `expiresAt`, and the correct `isDefault`

#### Scenario: Status for an expired profile
- **WHEN** a profile's cookies are expired
- **THEN** `getStatus(name)` returns `exists: true`, `isActive: false`

#### Scenario: Status for near-expiry cookies (within 1-hour freshness window)
- **WHEN** a profile's `__Secure-1PSIDTS` cookie expires within 1 hour from now (but has not yet passed its absolute expiry)
- **THEN** `getStatus(name)` returns `exists: true`, `isActive: false`

#### Scenario: Status for a missing profile
- **WHEN** no storage file exists for the profile
- **THEN** `getStatus(name)` returns `exists: false`, `isActive: false`, `expiresAt: null`

#### Scenario: Status reports isDefault
- **WHEN** the profile is the current default
- **THEN** `getStatus(name).isDefault` is `true`

### Requirement: GeminiClientService persistRefreshedCookies preserves original expiry
After every successful API call, the `GeminiClientService` wrapper MUST persist any updated `__Secure-1PSID` and `__Secure-1PSIDTS` cookie values from the SDK's cookie jar. When updating a stored cookie, the wrapper MUST preserve the cookie's original `expires` timestamp (as set by Google's auth system). The wrapper MUST NOT overwrite or fabricate an `expires` value.

#### Scenario: Cookie value updated, expiry preserved
- **WHEN** the SDK's cookie jar has a changed `__Secure-1PSID` value and the stored cookie has an original `expires` timestamp of 1800000000
- **THEN** after `persistRefreshedCookies()`, the stored cookie's `value` is the new SDK value AND its `expires` field remains 1800000000

#### Scenario: No refresh when values unchanged
- **WHEN** the SDK's cookie jar values match the stored cookies
- **THEN** no save operation occurs
