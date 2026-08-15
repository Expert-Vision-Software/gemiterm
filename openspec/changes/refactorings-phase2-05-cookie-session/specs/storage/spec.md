## MODIFIED Requirements

### Requirement: ProfileManager.getStatus
The `ProfileManager` class MUST expose a `getStatus(name)` method returning a `ProfileStatus` object. The method MUST report `exists: false` and `isActive: false` (with `expiresAt: null`) when the profile's storage file does not exist. When the file exists, the method MUST attempt to load the cookies and compute `isActive` and `expiresAt` using the `cookie-session` capability's two-tier validation and single expiry computation (via `CookieSession.sessionStatus`). If loading throws, the method MUST return `exists: true`, `isActive: false`, and `expiresAt: null`. The `isDefault` field MUST reflect whether `name` equals the current default profile name.

#### Scenario: Status for a valid active profile
- **WHEN** a profile has fresh `__Secure-1PSID` and `__Secure-1PSIDTS` cookies
- **THEN** `getStatus(name)` returns `exists: true`, `isActive: true`, a non-null `expiresAt`, and the correct `isDefault`

#### Scenario: Status for an expired profile
- **WHEN** a profile's cookies are expired
- **THEN** `getStatus(name)` returns `exists: true`, `isActive: false`

#### Scenario: Status for a missing profile
- **WHEN** no storage file exists for the profile
- **THEN** `getStatus(name)` returns `exists: false`, `isActive: false`, `expiresAt: null`

#### Scenario: Status reports isDefault
- **WHEN** the profile is the current default
- **THEN** `getStatus(name).isDefault` is `true`

### Requirement: ProfileManager.hasValidCookies
The `ProfileManager` class MUST expose a `hasValidCookies(profileName)` method that returns `true` iff the profile passes the `cookie-session` capability's two-tier validation (non-empty `__Secure-1PSID` AND an `__Secure-1PSIDTS` whose expiry is later than `now + 7 days` per the single freshness threshold), evaluated via `CookieSession.sessionStatus`. If the storage file is missing or unreadable, the method MUST return `false` (no throw).

#### Scenario: Fresh cookies
- **WHEN** a profile has fresh cookies
- **THEN** `hasValidCookies(name)` returns `true`

#### Scenario: Expired cookies
- **WHEN** a profile's cookies have expired
- **THEN** `hasValidCookies(name)` returns `false`

#### Scenario: Missing profile
- **WHEN** no storage file exists for the profile
- **THEN** `hasValidCookies(name)` returns `false` (does not throw)

### Requirement: ProfileManager.loadCookiesForApi
The `ProfileManager` class MUST expose a `loadCookiesForApi(profileName)` method that returns `{ secure1psid: string; secure1psidts: string | null }`. The method MUST throw an error mentioning `expired` if the cookie set fails the `cookie-session` two-tier freshness rule. The method MUST throw an error mentioning `__Secure-1PSID` (or `No storage state found` if the file is missing) if the required `__Secure-1PSID` cookie is absent. When successful, the returned `secure1psidts` is the cookie value, or `null` if the cookie is absent.

#### Scenario: Returns cookie values
- **WHEN** a profile has both required cookies and they are fresh
- **THEN** `loadCookiesForApi(name)` returns `{ secure1psid: "<psid>", secure1psidts: "<psidts>" }`

#### Scenario: Throws on expired cookies
- **WHEN** a profile's cookies are not fresh
- **THEN** `loadCookiesForApi(name)` throws an error whose message contains `expired`

#### Scenario: Throws on missing profile
- **WHEN** no storage file exists for the profile
- **THEN** `loadCookiesForApi(name)` throws an error whose message contains `No storage state found`

## REMOVED Requirements

### Requirement: Freshness and Validity
**Reason**: The freshness and validity rules are relocated to the `cookie-session` capability ("Two-Tier Cookie Validation" and "Single Expiry Computation") so they live beside their single implementation instead of in the raw-persistence layer.
**Migration**: The observable rules are unchanged — same cookie names, same 7-day threshold, same boolean outcomes — and are now normatively specified by the `cookie-session` capability; `ProfileManager` methods consume them via `CookieSession.sessionStatus`.
