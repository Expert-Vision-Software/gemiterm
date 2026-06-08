## Purpose

The cookie and profile persistence layer. It reads and writes the per-profile `storage_state.json` cookie file, manages the lifecycle of profile directories (create, delete, rename, set-default), and computes profile freshness from cookie expiry. Two classes are exposed: `CookieStorage` (raw cookie I/O) and `ProfileManager` (high-level profile lifecycle and status).

## Requirements

### Requirement: CookieStorage.save
The `CookieStorage` class MUST expose a `save(profileName, cookies)` method that writes the given cookie array into the profile's `storage_state.json` file as a JSON object with shape `{ cookies: Cookie[] }`. The method MUST create the profile directory (and any parents) before writing.

#### Scenario: Save then load round-trips cookies
- **WHEN** `save("test-profile", cookies)` is called and then `load("test-profile")` is called
- **THEN** the loaded cookie array has the same names and values as the saved array

#### Scenario: Save creates the profile directory
- **WHEN** `save("new-profile", cookies)` is called and the profile directory does not exist
- **THEN** the directory `<configDir>/profiles/new-profile` is created and contains `storage_state.json`

#### Scenario: Save overwrites prior cookies
- **WHEN** `save("profile", cookiesA)` is called followed by `save("profile", cookiesB)`
- **THEN** `load("profile")` returns cookiesB (cookiesA is replaced)

### Requirement: CookieStorage.load
The `CookieStorage` class MUST expose a `load(profileName)` method that reads the `storage_state.json` file for the profile and returns the `cookies` array. If the file does not exist, the method MUST throw an `Error` whose message includes the substring `No storage state found` and mentions `gemiterm auth`.

#### Scenario: Load existing cookies
- **WHEN** the profile has a previously-saved `storage_state.json`
- **THEN** `load(name)` returns the cookie array

#### Scenario: Load missing profile throws
- **WHEN** no `storage_state.json` exists for the profile
- **THEN** `load(name)` throws an error whose message contains `No storage state found`

### Requirement: CookieStorage.delete
The `CookieStorage` class MUST expose a `delete(profileName)` method that removes the profile's directory recursively. If the directory does not exist, the method MUST be a no-op (no throw).

#### Scenario: Delete removes the directory
- **WHEN** a profile directory exists
- **THEN** `delete(name)` removes the directory and any files within it

#### Scenario: Delete on missing profile is a no-op
- **WHEN** the profile directory does not exist
- **THEN** `delete(name)` does not throw

### Requirement: CookieStorage.list
The `CookieStorage` class MUST expose a `list()` method that returns the names of all stored profile directories. The return type is `string[]` and the order matches the underlying `listProfiles()` (sorted alphabetically).

#### Scenario: Empty when no profiles
- **WHEN** no profile directories exist
- **THEN** `list()` returns `[]`

#### Scenario: Lists saved profile names
- **WHEN** profiles `alpha` and `beta` have been saved
- **THEN** `list()` returns a list that includes both `"alpha"` and `"beta"`

### Requirement: ProfileManager.create
The `ProfileManager` class MUST expose a `create(profileName)` method that creates the profile directory. If the profile directory already exists, the method MUST throw an `Error` whose message mentions `already exists`. If the profile is the first one (no other profiles exist), the method MUST additionally call `setDefaultProfileName(profileName)`. Otherwise, the default profile is unchanged.

#### Scenario: Create a new profile
- **WHEN** `create("new-profile")` is called
- **THEN** the directory `<configDir>/profiles/new-profile` exists

#### Scenario: First created profile is default
- **WHEN** no profiles exist and `create("first")` is called
- **THEN** `getDefault()` returns `"first"`

#### Scenario: Subsequent create does not change default
- **WHEN** profile `"first"` already exists and is default, and `create("second")` is called
- **THEN** `getDefault()` still returns `"first"`

#### Scenario: Duplicate create throws
- **WHEN** profile `"dup"` already exists
- **THEN** `create("dup")` throws an error whose message contains `already exists`

### Requirement: ProfileManager.delete
The `ProfileManager` class MUST expose a `delete(name)` method that removes the profile's cookies (via `CookieStorage.delete`) and, if the deleted profile was the default, reassigns the default to the first remaining profile. If no profiles remain, the default marker file is removed.

#### Scenario: Delete removes the profile
- **WHEN** profile `"p1"` exists
- **THEN** `delete("p1")` removes it and `list()` no longer contains `"p1"`

#### Scenario: Deleting the default resets to remaining profile
- **WHEN** profiles `"p1"` and `"p2"` exist with `"p1"` as default
- **THEN** `delete("p1")` reassigns the default to `"p2"`

#### Scenario: Deleting the only profile clears the default marker
- **WHEN** a single profile `"solo"` exists and is the default
- **THEN** `delete("solo")` removes the profile and the default marker file is gone (so `getDefault()` returns the literal string `"default"`)

### Requirement: ProfileManager.rename
The `ProfileManager` class MUST expose a `rename(oldName, newName)` method that renames the profile directory on disk. If the source profile does not exist, the method MUST throw an `Error` whose message contains `does not exist`. If the destination profile already exists, the method MUST throw an `Error` whose message contains `already exists`. If the renamed profile was the default, the default MUST be updated to the new name.

#### Scenario: Rename moves the directory
- **WHEN** profile `"old-name"` exists
- **THEN** `rename("old-name", "new-name")` moves the directory and `list()` reflects the new name

#### Scenario: Renaming the default updates the marker
- **WHEN** profile `"default-profile"` is the default
- **THEN** `rename("default-profile", "renamed")` updates the marker so `getDefault()` returns `"renamed"`

#### Scenario: Rename with missing source throws
- **WHEN** profile `"nope"` does not exist
- **THEN** `rename("nope", "dest")` throws an error whose message contains `does not exist`

#### Scenario: Rename with existing destination throws
- **WHEN** profiles `"a"` and `"b"` both exist
- **THEN** `rename("a", "b")` throws an error whose message contains `already exists`

### Requirement: ProfileManager.setDefault and getDefault
The `ProfileManager` class MUST expose `setDefault(name)` and `getDefault()` methods. `setDefault` MUST write the supplied name to the default marker and MUST throw an `Error` whose message contains `does not exist` if no profile directory with that name exists. `getDefault` MUST return the current default profile name (as resolved by the marker file, or `"default"` if no marker).

#### Scenario: Set default on existing profile
- **WHEN** profiles `"p1"` and `"p2"` exist
- **THEN** `setDefault("p2")` makes `"p2"` the default and `getDefault()` returns `"p2"`

#### Scenario: Set default on missing profile throws
- **WHEN** profile `"ghost"` does not exist
- **THEN** `setDefault("ghost")` throws an error whose message contains `does not exist`

### Requirement: ProfileManager.list
The `ProfileManager` class MUST expose a `list()` method that returns the sorted list of profile directory names (delegating to `listProfiles`).

#### Scenario: List returns profile names
- **WHEN** multiple profiles have been created
- **THEN** `list()` returns their names

### Requirement: ProfileManager.getStatus
The `ProfileManager` class MUST expose a `getStatus(name)` method returning a `ProfileStatus` object. The method MUST report `exists: false` and `isActive: false` (with `expiresAt: null`) when the profile's storage file does not exist. When the file exists, the method MUST attempt to load the cookies and compute `isActive` from cookie validity and freshness (see Requirement: Freshness and Validity). If loading throws, the method MUST return `exists: true`, `isActive: false`, and `expiresAt: null`. The `isDefault` field MUST reflect whether `name` equals the current default profile name.

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

### Requirement: ProfileManager.getAllStatuses
The `ProfileManager` class MUST expose a `getAllStatuses()` method that returns a `ProfileStatus[]` array covering every known profile. The method MUST call `ensureConfigDir()` first (so the profiles directory exists) and MUST populate `isDefault` on every entry based on the current default profile name.

#### Scenario: Returns one status per profile
- **WHEN** profiles `active` (fresh cookies) and `expired` (stale cookies) exist
- **THEN** `getAllStatuses()` returns a 2-element array, with `active.isActive === true` and `expired.isActive === false`

### Requirement: ProfileManager.hasValidCookies
The `ProfileManager` class MUST expose a `hasValidCookies(profileName)` method that returns `true` iff the profile has both `__Secure-1PSID` and `__Secure-1PSIDTS` cookies AND the cookies are still fresh (see Requirement: Freshness and Validity). If the storage file is missing or unreadable, the method MUST return `false` (no throw).

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
The `ProfileManager` class MUST expose a `loadCookiesForApi(profileName)` method that returns `{ secure1psid: string; secure1psidts: string | null }`. The method MUST throw an error mentioning `expired` if the cookies are not fresh. The method MUST throw an error mentioning `__Secure-1PSID` (or `No storage state found` if the file is missing) if the required `__Secure-1PSID` cookie is absent. When successful, the returned `secure1psidts` is the cookie value, or `null` if the cookie is absent.

#### Scenario: Returns cookie values
- **WHEN** a profile has both required cookies and they are fresh
- **THEN** `loadCookiesForApi(name)` returns `{ secure1psid: "<psid>", secure1psidts: "<psidts>" }`

#### Scenario: Throws on expired cookies
- **WHEN** a profile's cookies are not fresh
- **THEN** `loadCookiesForApi(name)` throws an error whose message contains `expired`

#### Scenario: Throws on missing profile
- **WHEN** no storage file exists for the profile
- **THEN** `loadCookiesForApi(name)` throws an error whose message contains `No storage state found`

### Requirement: Freshness and Validity
A profile's cookies are considered valid and fresh when ALL of the following are true: (a) the cookie set includes both `__Secure-1PSID` and `__Secure-1PSIDTS`, (b) the `__Secure-1PSIDTS` cookie has an `expires` value greater than 0, and (c) the resulting expiry timestamp (cookie `expires` in milliseconds) is later than `now + 7 days` (the freshness threshold). The system MUST use these rules consistently in `hasValidCookies`, `getStatus`, and `loadCookiesForApi`.

#### Scenario: Freshness window uses 7-day threshold
- **WHEN** a profile's `__Secure-1PSIDTS` cookie expires more than 7 days from now
- **THEN** `hasValidCookies` and `getStatus` both report the profile as active

#### Scenario: Cookies inside the 7-day window are not fresh
- **WHEN** a profile's `__Secure-1PSIDTS` cookie expires within 7 days from now (or has already passed)
- **THEN** `hasValidCookies` returns `false` and `getStatus` reports `isActive: false`

### Requirement: Cookie JSON On-Disk Layout
Cookies MUST be persisted to `<profilesDir>/<name>/storage_state.json` as a JSON object of the form `{ "cookies": <Cookie[]> }`. The file MUST be UTF-8 encoded. The `expires` field on each cookie is a Unix-seconds numeric timestamp.

#### Scenario: Storage file is parseable JSON with cookies array
- **WHEN** `CookieStorage.save(name, cookies)` completes
- **THEN** the file at `<profilesDir>/<name>/storage_state.json` is valid JSON whose top-level `cookies` field is the saved array
