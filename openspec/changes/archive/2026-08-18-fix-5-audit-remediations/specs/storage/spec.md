# Delta: storage (fix-5-audit-remediations)

Scopes the local freshness rules as display/reporting metadata and names the session-validity oracle. The rules' mechanics (7-day threshold, cookie-name presence) are unchanged; their contract meaning is clarified. Evidence: `docs/cookie-ablation-findings.md` - locally-fresh-looking jars can be server-side superseded (phantom/dead) with no client-side signal.

## MODIFIED Requirements

### Requirement: Freshness and Validity

A profile's cookies are considered locally fresh when ALL of the following are true: (a) the cookie set includes both `__Secure-1PSID` and `__Secure-1PSIDTS`, (b) the `__Secure-1PSIDTS` cookie has an `expires` value greater than 0, and (c) the resulting expiry timestamp (cookie `expires` in milliseconds) is later than `now + 7 days` (the freshness threshold). The system MUST use these rules consistently in `hasValidCookies`, `getStatus`, and `loadCookiesForApi`. These rules are LOCAL, DISPLAY-ONLY metadata: they populate the status table's ACTIVE and EXPIRES columns and gate legacy load paths. They MUST NOT be treated as a session-validity oracle - the cookie `expires` attribute carries no information about server-side `__Secure-1PSIDTS` supersession, so a locally-fresh profile can still be phantom or dead. The validity oracle is the auth capability's read-only `CookieSession.probe` classification.

#### Scenario: Freshness window uses 7-day threshold
- **WHEN** a profile's `__Secure-1PSIDTS` cookie expires more than 7 days from now
- **THEN** `hasValidCookies` and `getStatus` both report the profile as active

#### Scenario: Cookies inside the 7-day window are not fresh
- **WHEN** a profile's `__Secure-1PSIDTS` cookie expires within 7 days from now (or has already passed)
- **THEN** `hasValidCookies` returns `false` and `getStatus` reports `isActive: false`

#### Scenario: Locally-fresh is not server-side-valid
- **WHEN** a profile's stored jar satisfies every local freshness rule but the session has been server-side superseded
- **THEN** `hasValidCookies` still returns `true` (display metadata is unchanged) while `CookieSession.probe` classifies the profile as `phantom` or `dead` - only the probe's verdict may drive recovery or re-auth decisions

### Requirement: ProfileManager.getStatus

The `ProfileManager` class MUST expose an async `getStatus(name)` method returning `Promise<ProfileStatus>`. The method MUST resolve `exists: false` and `isActive: false` (with `expiresAt: null`) when the profile's storage file does not exist. When the file exists, the method MUST attempt to load the cookies and compute `isActive` from cookie validity and freshness (see Requirement: Freshness and Validity). If loading rejects, the method MUST resolve `exists: true`, `isActive: false`, and `expiresAt: null`. The `isDefault` field MUST reflect whether `name` equals the current default profile name. The resolved `isActive` and `expiresAt` are local display metadata for the status table; the server-side session state is reported separately by the auth capability's probe (`status --verbose` PROBE column).

#### Scenario: Status for a valid active profile
- **WHEN** a profile has fresh `__Secure-1PSID` and `__Secure-1PSIDTS` cookies
- **THEN** `await getStatus(name)` resolves `exists: true`, `isActive: true`, a non-null `expiresAt`, and the correct `isDefault`

#### Scenario: Status for an expired profile
- **WHEN** a profile's cookies are expired
- **THEN** `await getStatus(name)` resolves `exists: true`, `isActive: false`

#### Scenario: Status for a missing profile
- **WHEN** no storage file exists for the profile
- **THEN** `await getStatus(name)` resolves `exists: false`, `isActive: false`, `expiresAt: null`

#### Scenario: Status reports isDefault
- **WHEN** the profile is the current default
- **THEN** `(await getStatus(name)).isDefault` is `true`

#### Scenario: Status is display metadata, not a validity verdict
- **WHEN** `getStatus` reports `isActive: true` for a profile whose session is server-side dead
- **THEN** no recovery, re-auth, or error path may be triggered from `isActive` alone; those decisions belong to the probe classification