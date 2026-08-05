## MODIFIED Requirements

### Requirement: CookieStorageService.loadCookiesForProfile resolves cookies by domain, not name alone

The `CookieStorageService.loadCookiesForProfile(profileName)` method SHALL resolve `__Secure-1PSID` and `__Secure-1PSIDTS` from stored cookies by preferring `.google.com` domain entries. When multiple cookies share the same name across different domains, the method SHALL select the `.google.com` entry. If no `.google.com` entry exists for a required name, the method SHALL fall back to the first matching cookie by name.

#### Scenario: Prefers .google.com domain PSIDTS when both .youtube.com and .google.com exist

- **WHEN** `loadCookiesForProfile("default")` is called
- **AND** the stored cookies include `__Secure-1PSIDTS` on `.youtube.com` with value `"yt-psidts"` and `__Secure-1PSIDTS` on `.google.com` with value `"g-psidts"`
- **THEN** the returned `LoadedCookies.secure_1psidts` is `"g-psidts"`

#### Scenario: Falls back to first match when no .google.com entry exists

- **WHEN** `loadCookiesForProfile("default")` is called
- **AND** the stored cookies include `__Secure-1PSIDTS` only on `.youtube.com` (no `.google.com` entry)
- **THEN** the returned `LoadedCookies.secure_1psidts` is the `.youtube.com` value

#### Scenario: Prefers .google.com domain PSID when both .youtube.com and .google.com exist

- **WHEN** `loadCookiesForProfile("default")` is called
- **AND** the stored cookies include `__Secure-1PSID` on `.youtube.com` with value `"yt-psid"` and `__Secure-1PSID` on `.google.com` with value `"g-psid"`
- **THEN** the returned `LoadedCookies.secure_1psid` is `"g-psid"`

### Requirement: AuthService.silentRefresh merges polled cookies by upsert, not wholesale overwrite

The `AuthService.silentRefresh(profileName)` method SHALL persist polled cookies via an upsert merge by `(name, domain, path)` key rather than wholesale overwrite. After a successful L1 rotation or L2 monitor result, the method SHALL load the existing jar via `cookieStorageService.loadAllCookiesForProfile(name)`, upsert each polled cookie by matching `(name, domain, path)` tuple, and save the merged list via `cookieStorageService.saveCookiesForProfile(name, merged)`. A polled entry with the same `(name, domain, path)` SHALL overwrite the existing entry; an entry present only in the existing jar SHALL be preserved.

#### Scenario: Polled 3-cookie set does not evict .google.com PSIDTS

- **WHEN** `silentRefresh("default")` is called
- **AND** the existing jar contains 4 cookies (PSID + PSIDTS on `.youtube.com`, PSID + PSIDTS on `.google.com`)
- **AND** the polled set after L2 contains 3 cookies (PSID + PSIDTS on `.youtube.com`, PSID on `.google.com` — `.google.com` PSIDTS absent)
- **THEN** the persisted jar contains all 4 cookies (existing `.google.com` PSIDTS preserved)
- **AND** the polled entries overwrite their matching `(name, domain, path)` counterparts in the existing jar

#### Scenario: Polled cookie with same key replaces existing entry

- **WHEN** `silentRefresh("default")` is called
- **AND** the existing jar contains `__Secure-1PSID` on `.google.com` with value `"old-value"`
- **AND** the polled set contains `__Secure-1PSID` on `.google.com` with value `"new-value"`
- **THEN** the persisted jar contains `__Secure-1PSID` on `.google.com` with value `"new-value"`
