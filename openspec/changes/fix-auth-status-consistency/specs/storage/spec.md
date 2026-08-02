## MODIFIED Requirements

### Requirement: ProfileManager.getStatus
The `ProfileManager` class MUST expose a `getStatus(name)` method returning a `ProfileStatus` object. The method MUST report `exists: false` and `isActive: false` (with `expiresAt: null`) when the profile's storage file does not exist. When the file exists, the method MUST attempt to load the cookies and compute `isActive` from cookie validity and freshness (see Requirement: Freshness and Validity) — specifically, `isActive` MUST be `false` when `checkCookieFreshness()` returns `false`, even if the cookies have not yet reached their absolute expiry timestamps. If loading throws, the method MUST return `exists: true`, `isActive: false`, and `expiresAt: null`. The `isDefault` field MUST reflect whether `name` equals the current default profile name.

#### Scenario: Status for a valid active profile
- **WHEN** a profile has fresh `__Secure-1PSID` and `__Secure-1PSIDTS` cookies (both present, `__Secure-1PSIDTS` expiry > now + 7 days)
- **THEN** `getStatus(name)` returns `exists: true`, `isActive: true`, a non-null `expiresAt`, and the correct `isDefault`

#### Scenario: Status for a profile whose cookies are within the 7-day freshness window
- **WHEN** a profile has both `__Secure-1PSID` and `__Secure-1PSIDTS` cookies, neither has reached its absolute expiry, but `__Secure-1PSIDTS` expires within 7 days from now
- **THEN** `getStatus(name)` returns `exists: true`, `isActive: false`

#### Scenario: Status for an expired profile
- **WHEN** a profile's cookies are expired
- **THEN** `getStatus(name)` returns `exists: true`, `isActive: false`

#### Scenario: Status for a missing profile
- **WHEN** no storage file exists for the profile
- **THEN** `getStatus(name)` returns `exists: false`, `isActive: false`, `expiresAt: null`

#### Scenario: Status reports isDefault
- **WHEN** the profile is the current default
- **THEN** `getStatus(name).isDefault` is `true`
