## MODIFIED Requirements

### Requirement: GeminiClientService.persistRefreshedCookies merges by (name, baselineValue)

The existing requirement "CookieStorageService persists refreshed session
cookies" is MODIFIED. `GeminiClientService.persistRefreshedCookies` MUST
match stored cookies by both `name` AND `value === this.baselineSecure1psid`
(or `value === this.baselineSecure1psidts`) when deciding which entries to
overwrite with the SDK's in-memory value. This replaces the previous behavior
of matching by `name` only, which silently overwrote cross-domain duplicates.

The `baselineSecure1psid` and `baselineSecure1psidts` values are captured at
construction time from the `GeminiClientConfig` and represent the specific
cookie value that the SDK jar was initialized with.

#### Scenario: SDK rotation overwrites only the matching baseline entry

- **WHEN** the profile's storage contains two `__Secure-1PSID` cookies -- one
  with value `"yt-psid"` and one with value `"g-psid"` (the baseline)
- **AND** the SDK jar holds a new `__Secure-1PSID` value `"NEW-g-psid"`
- **AND** `persistRefreshedCookies` is called
- **THEN** the stored entry whose value matches `this.baselineSecure1psid`
  (`"g-psid"`) MUST be updated to `"NEW-g-psid"`
- **AND** the stored entry whose value is `"yt-psid"` (does not match
  baseline) MUST remain unchanged
- **AND** the file's other cookies MUST be preserved (domain, path, httpOnly,
  secure, sameSite, expires metadata intact)

#### Scenario: No write when nothing changed (unchanged)

- **WHEN** the client jar's tracked cookie values equal the baseline values
  the service instance was constructed with
- **THEN** no storage save is invoked after the operation completes
