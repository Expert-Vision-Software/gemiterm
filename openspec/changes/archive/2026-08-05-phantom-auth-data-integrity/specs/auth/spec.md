## MODIFIED Requirements

### Requirement: CookieStorageService loads and validates per-profile cookies

The `CookieStorageService.loadCookiesForProfile(profileName)` method MUST return a `LoadedCookies` object with two fields: `secure_1psid: string` and `secure_1psidts: string | null`. The method MUST read cookies from the underlying `CookieStorage.load(profileName)`. The method MUST resolve `__Secure-1PSID` and `__Secure-1PSIDTS` from stored cookies by preferring `.google.com` domain entries. When multiple cookies share the same name across different domains, the method MUST select the `.google.com` entry. If no `.google.com` entry exists for a required name, the method MUST fall back to the first matching cookie by name. If `__Secure-1PSID` is missing, the method MUST throw an `Error` whose message contains `Missing required cookie __Secure-1PSID` and mentions the profile name and `gemiterm auth`. The `secure_1psidts` field MUST be `null` when the cookie is absent.

#### Scenario: Load returns both cookie values

- **WHEN** the profile's storage contains both `__Secure-1PSID` and `__Secure-1PSIDTS`
- **THEN** `loadCookiesForProfile("default")` returns `{ secure_1psid: "<psid value>", secure_1psidts: "<psidts value>" }`

#### Scenario: Load returns null for missing 1PSIDTS

- **WHEN** the profile's storage contains only `__Secure-1PSID`
- **THEN** `loadCookiesForProfile("default")` returns `{ secure_1psid: "<psid value>", secure_1psidts: null }`

#### Scenario: Load throws when __Secure-1PSID is missing

- **WHEN** the profile's storage contains only `__Secure-1PSIDTS`
- **THEN** `loadCookiesForProfile("default")` throws an error whose message contains `Missing required cookie`

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

### Requirement: AuthService.silentRefresh is a multi-layer recovery ladder

The `AuthService.silentRefresh(profileName)` method MUST attempt session recovery in a ladder, escalating from the cheapest mechanism to the heaviest:

1. **L1 -- RotateCookies POST:** Call `rotateCookies(profileName)`. If `true`, return `true` immediately. No browser launch. No polling.
2. **L2 -- Headless browser (fallback):** Only reached when L1 returns `false`. Launch headless Chromium via `openHeadless`, load cookies via `stateLoad`, start `CookieMonitor` with `requireRotation` baseline. Return `true` only when the monitor returns values that differ from the snapshot. The method MUST persist polled cookies via an upsert merge by `(name, domain, path)` key rather than wholesale overwrite: load the existing jar via `cookieStorageService.loadAllCookiesForProfile(name)`, upsert each polled cookie by matching `(name, domain, path)` tuple, and save the merged list via `cookieStorageService.saveCookiesForProfile(name, merged)`. A polled entry with the same `(name, domain, path)` SHALL overwrite the existing entry; an entry present only in the existing jar SHALL be preserved. Close browser in `finally`.
3. Return `false` when both L1 and L2 fail.

The method MUST NOT produce console output (silent operation). The method MUST NOT throw on any error (driver failure, timeout, missing profile) — all failures return `false`.

#### Scenario: L1 RotateCookies succeeds, returns true immediately

- **WHEN** `silentRefresh("test-profile")` is called
- **AND** `rotateCookies("test-profile")` returns `true` (fresh PSIDTS)
- **THEN** the method returns `true` without launching a browser

#### Scenario: L1 fails, L2 headless browser succeeds with rotated cookies

- **WHEN** `silentRefresh("test-profile")` is called
- **AND** `rotateCookies` returns `false`
- **AND** the headless browser flow detects rotated cookies within 30s
- **THEN** the method returns `true` and the browser is closed

#### Scenario: Both L1 and L2 fail, returns false

- **WHEN** `silentRefresh("test-profile")` is called
- **AND** `rotateCookies` returns `false`
- **AND** the headless browser times out without rotation
- **THEN** the method returns `false`

#### Scenario: Silent refresh returns false on timeout

- **WHEN** `silentRefresh("test-profile")` is called and the `CookieMonitor` does not detect auth cookies within 30s
- **THEN** the monitor times out, `closeSession` is called, and the method returns `false`

#### Scenario: Silent refresh returns false on driver failure

- **WHEN** `silentRefresh("test-profile")` is called and `openHeadless` throws
- **THEN** the method catches the error, attempts `closeSession` in `finally`, and returns `false`

#### Scenario: Silent refresh does not print to stdout

- **WHEN** `silentRefresh("test-profile")` is called and succeeds
- **THEN** no console output is produced (no `console.log` or `console.error` calls from the method itself)

#### Scenario: Silent refresh uses 30-second timeout

- **WHEN** `silentRefresh("test-profile")` is called
- **THEN** `CookieMonitor.start` is invoked with `timeoutMs` of `30_000` (30 seconds)

#### Scenario: Polled 3-cookie set does not evict .google.com PSIDTS

- **WHEN** `silentRefresh("default")` is called
- **AND** the existing jar contains 4 cookies (PSID + PSIDTS on `.youtube.com`, PSID + PSIDTS on `.google.com`)
- **AND** the polled set after L2 contains 3 cookies (PSID + PSIDTS on `.youtube.com`, PSID on `.google.com` — `.google.com` PSIDTS absent)
- **THEN** the persisted jar contains all 4 cookies (existing `.google.com` PSIDTS preserved via merge)
- **AND** the polled entries overwrite their matching `(name, domain, path)` counterparts in the existing jar

#### Scenario: Polled cookie with same key replaces existing entry

- **WHEN** `silentRefresh("default")` is called
- **AND** the existing jar contains `__Secure-1PSID` on `.google.com` with value `"old-value"`
- **AND** the polled set contains `__Secure-1PSID` on `.google.com` with value `"new-value"`
- **THEN** the persisted jar contains `__Secure-1PSID` on `.google.com` with value `"new-value"`
