## Purpose

The cookie and profile persistence layer. It reads and writes the per-profile `storage_state.json` cookie file, manages the lifecycle of profile directories (create, delete, rename, set-default), and computes profile freshness from cookie expiry. Two classes are exposed: `CookieStorage` (raw cookie I/O) and `ProfileManager` (high-level profile lifecycle and status).

## Requirements

### Requirement: CookieStorage.save
The `CookieStorage` class MUST expose an async `save(profileName, cookies)` method returning `Promise<void>` that writes the given cookie array into the profile's `storage_state.json` file as a JSON object with shape `{ cookies: Cookie[] }`. The method MUST create the profile directory (and any parents) before writing.

#### Scenario: Save then load round-trips cookies
- **WHEN** `await save("test-profile", cookies)` is called and then `await load("test-profile")` is called
- **THEN** the loaded cookie array has the same names and values as the saved array

#### Scenario: Save creates the profile directory
- **WHEN** `await save("new-profile", cookies)` is called and the profile directory does not exist
- **THEN** the directory `<configDir>/profiles/new-profile` is created and contains `storage_state.json`

#### Scenario: Save overwrites prior cookies
- **WHEN** `await save("profile", cookiesA)` is called followed by `await save("profile", cookiesB)`
- **THEN** `await load("profile")` resolves cookiesB (cookiesA is replaced)

### Requirement: CookieStorage.load
The `CookieStorage` class MUST expose an async `load(profileName)` method returning `Promise<Cookie[]>` that reads the profile's `storage_state.json` file and resolves the `cookies` array. If the file does not exist, the method MUST reject with an `Error` whose message includes the substring `No storage state found` and mentions `gemiterm auth`.

#### Scenario: Load existing cookies
- **WHEN** the profile has a previously-saved `storage_state.json`
- **THEN** `await load(name)` resolves the cookie array

#### Scenario: Load missing profile throws
- **WHEN** no `storage_state.json` exists for the profile
- **THEN** `await load(name)` rejects with an error whose message contains `No storage state found`

### Requirement: CookieStorage.delete
The `CookieStorage` class MUST expose an async `delete(profileName)` method returning `Promise<void>` that removes the profile's directory recursively. If the directory does not exist, the method MUST be a no-op (no rejection).

#### Scenario: Delete removes the directory
- **WHEN** a profile directory exists
- **THEN** `await delete(name)` removes the directory and any files within it

#### Scenario: Delete on missing profile is a no-op
- **WHEN** the profile directory does not exist
- **THEN** `await delete(name)` does not reject

### Requirement: CookieStorage.list
The `CookieStorage` class MUST expose an async `list()` method returning `Promise<string[]>` that resolves the names of all stored profile directories. The resolved array's order matches the underlying `await listProfiles()` (sorted alphabetically).

#### Scenario: Empty when no profiles
- **WHEN** no profile directories exist
- **THEN** `await list()` resolves `[]`

#### Scenario: Lists saved profile names
- **WHEN** profiles `alpha` and `beta` have been saved
- **THEN** `await list()` resolves a list that includes both `"alpha"` and `"beta"`

### Requirement: ProfileManager.create
The `ProfileManager` class MUST expose an async `create(profileName)` method returning `Promise<void>` that creates the profile directory. If the profile directory already exists, the method MUST reject with an `Error` whose message mentions `already exists`. If the profile is the first one (no other profiles exist), the method MUST additionally call `setDefaultProfileName(profileName)`. Otherwise, the default profile is unchanged.

#### Scenario: Create a new profile
- **WHEN** `await create("new-profile")` is called
- **THEN** the directory `<configDir>/profiles/new-profile` exists

#### Scenario: First created profile is default
- **WHEN** no profiles exist and `await create("first")` is called
- **THEN** `await getDefault()` resolves `"first"`

#### Scenario: Subsequent create does not change default
- **WHEN** profile `"first"` already exists and is default, and `await create("second")` is called
- **THEN** `await getDefault()` still resolves `"first"`

#### Scenario: Duplicate create throws
- **WHEN** profile `"dup"` already exists
- **THEN** `await create("dup")` rejects with an error whose message contains `already exists`

### Requirement: ProfileManager.delete
The `ProfileManager` class MUST expose an async `delete(name)` method returning `Promise<void>` that removes the profile's cookies (via `CookieStorage.delete`) and, if the deleted profile was the default, reassigns the default to the first remaining profile. If no profiles remain, the default marker file is removed.

#### Scenario: Delete removes the profile
- **WHEN** profile `"p1"` exists
- **THEN** `await delete("p1")` removes it and `await list()` no longer contains `"p1"`

#### Scenario: Deleting the default resets to remaining profile
- **WHEN** profiles `"p1"` and `"p2"` exist with `"p1"` as default
- **THEN** `await delete("p1")` reassigns the default to `"p2"`

#### Scenario: Deleting the only profile clears the default marker
- **WHEN** a single profile `"solo"` exists and is the default
- **THEN** `await delete("solo")` removes the profile and the default marker file is gone (so `await getDefault()` resolves the literal string `"default"`)

### Requirement: ProfileManager.rename
The `ProfileManager` class MUST expose an async `rename(oldName, newName)` method returning `Promise<void>` that renames the profile directory on disk. If the source profile does not exist, the method MUST reject with an `Error` whose message contains `does not exist`. If the destination profile already exists, the method MUST reject with an `Error` whose message contains `already exists`. If the renamed profile was the default, the default MUST be updated to the new name.

#### Scenario: Rename moves the directory
- **WHEN** profile `"old-name"` exists
- **THEN** `await rename("old-name", "new-name")` moves the directory and `await list()` reflects the new name

#### Scenario: Renaming the default updates the marker
- **WHEN** profile `"default-profile"` is the default
- **THEN** `await rename("default-profile", "renamed")` updates the marker so `await getDefault()` resolves `"renamed"`

#### Scenario: Rename with missing source throws
- **WHEN** profile `"nope"` does not exist
- **THEN** `await rename("nope", "dest")` rejects with an error whose message contains `does not exist`

#### Scenario: Rename with existing destination throws
- **WHEN** profiles `"a"` and `"b"` both exist
- **THEN** `await rename("a", "b")` rejects with an error whose message contains `already exists`

### Requirement: ProfileManager.setDefault and getDefault
The `ProfileManager` class MUST expose async `setDefault(name): Promise<void>` and `getDefault(): Promise<string>` methods. `setDefault` MUST write the supplied name to the default marker and MUST reject with an `Error` whose message contains `does not exist` if no profile directory with that name exists. `getDefault` MUST resolve the current default profile name (as resolved by the marker file, or `"default"` if no marker).

#### Scenario: Set default on existing profile
- **WHEN** profiles `"p1"` and `"p2"` exist
- **THEN** `await setDefault("p2")` makes `"p2"` the default and `await getDefault()` resolves `"p2"`

#### Scenario: Set default on missing profile throws
- **WHEN** profile `"ghost"` does not exist
- **THEN** `await setDefault("ghost")` rejects with an error whose message contains `does not exist`

### Requirement: ProfileManager.list
The `ProfileManager` class MUST expose an async `list()` method returning `Promise<string[]>` that resolves the sorted list of profile directory names (delegating to `listProfiles`).

#### Scenario: List returns profile names
- **WHEN** multiple profiles have been created
- **THEN** `await list()` resolves their names

### Requirement: ProfileManager.getStatus
The `ProfileManager` class MUST expose an async `getStatus(name)` method returning `Promise<ProfileStatus>`. The method MUST resolve `exists: false` and `isActive: false` (with `expiresAt: null`) when the profile's storage file does not exist. When the file exists, the method MUST attempt to load the cookies and compute `isActive` from cookie validity and freshness (see Requirement: Freshness and Validity). If loading rejects, the method MUST resolve `exists: true`, `isActive: false`, and `expiresAt: null`. The `isDefault` field MUST reflect whether `name` equals the current default profile name.

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

### Requirement: ProfileManager.getAllStatuses
The `ProfileManager` class MUST expose an async `getAllStatuses()` method returning `Promise<ProfileStatus[]>` that resolves an array covering every known profile. The method MUST call `ensureConfigDir()` first (so the profiles directory exists) and MUST populate `isDefault` on every entry based on the current default profile name.

#### Scenario: Returns one status per profile
- **WHEN** profiles `active` (fresh cookies) and `expired` (stale cookies) exist
- **THEN** `await getAllStatuses()` resolves a 2-element array, with `active.isActive === true` and `expired.isActive === false`

### Requirement: ProfileManager.hasValidCookies
The `ProfileManager` class MUST expose an async `hasValidCookies(profileName)` method returning `Promise<boolean>` that resolves `true` iff the profile has both `__Secure-1PSID` and `__Secure-1PSIDTS` cookies AND the cookies are still fresh (see Requirement: Freshness and Validity). If the storage file is missing or unreadable, the method MUST resolve `false` (no rejection).

#### Scenario: Fresh cookies
- **WHEN** a profile has fresh cookies
- **THEN** `await hasValidCookies(name)` resolves `true`

#### Scenario: Expired cookies
- **WHEN** a profile's cookies have expired
- **THEN** `await hasValidCookies(name)` resolves `false`

#### Scenario: Missing profile
- **WHEN** no storage file exists for the profile
- **THEN** `await hasValidCookies(name)` resolves `false` (does not reject)

### Requirement: ProfileManager.loadCookiesForApi
The `ProfileManager` class MUST expose an async `loadCookiesForApi(profileName)` method returning `Promise<{ secure1psid: string; secure1psidts: string | null }>` that resolves the cookie values. The method MUST reject with an error mentioning `expired` if the cookies are not fresh. The method MUST reject with an error mentioning `__Secure-1PSID` (or `No storage state found` if the file is missing) if the required `__Secure-1PSID` cookie is absent. When successful, the resolved `secure1psidts` is the cookie value, or `null` if the cookie is absent.

#### Scenario: Returns cookie values
- **WHEN** a profile has both required cookies and they are fresh
- **THEN** `await loadCookiesForApi(name)` resolves `{ secure1psid: "<psid>", secure1psidts: "<psidts>" }`

#### Scenario: Throws on expired cookies
- **WHEN** a profile's cookies are not fresh
- **THEN** `await loadCookiesForApi(name)` rejects with an error whose message contains `expired`

#### Scenario: Throws on missing profile
- **WHEN** no storage file exists for the profile
- **THEN** `await loadCookiesForApi(name)` rejects with an error whose message contains `No storage state found`

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
