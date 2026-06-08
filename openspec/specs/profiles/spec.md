## Purpose

The profile CRUD business logic. It owns the `ProfileService` class that wraps the storage layer for higher-level operations used by the CLI and command handlers: authenticating against an existing profile, listing profile statuses, deleting, renaming, and setting the default profile. It also owns the `IProfileService` and `IProfileQueryService` interfaces that the command/query handlers depend on.

## Requirements

### Requirement: ProfileService.authenticate returns an AuthResult for a valid profile
The `ProfileService.authenticate(profileName?)` method MUST resolve the profile name (provided value, or the configured default), validate it via `validateProfileName`, and ensure the config directory exists. If the named profile does not exist in the `ProfileManager`, the method MUST call `profileManager.create(name)` first. The method MUST then verify that the profile has valid cookies via `profileManager.hasValidCookies(name)`; if not, it MUST throw an `AuthenticationError` whose message contains `No valid session for profile '<name>'` and the substring `gemiterm login`. On success, the method MUST return an `AuthResult` with `cookies: Cookie[]` (rebuilt from the stored `secure1psid` and `secure1psidts` values) and `expiresAt: Date | null` (derived from the profile's `expiresAt` ISO string, or `null` when no expiry is known).

#### Scenario: Authenticating a profile with valid cookies returns an AuthResult
- **WHEN** `authenticate()` is called and the default profile has fresh cookies
- **THEN** the method resolves with an `AuthResult` whose `cookies` array has length 2 (entries for `__Secure-1PSID` and `__Secure-1PSIDTS`), and whose `expiresAt` is a `Date` instance

#### Scenario: Throws AuthenticationError when no valid cookies exist
- **WHEN** `authenticate("default")` is called and the profile has no cookies
- **THEN** the method rejects with an `AuthenticationError` whose message contains `No valid session`

#### Scenario: Creates profile if it does not exist and authenticates
- **WHEN** `authenticate("default")` is called and no profile by that name exists, but valid cookies are present in the storage
- **THEN** the method calls `profileManager.create("default")` and resolves with the `AuthResult` for those cookies

#### Scenario: Throws on invalid profile name
- **WHEN** `authenticate("bad name!")` is called
- **THEN** the method rejects with an error whose message contains `invalid characters`

### Requirement: ProfileService.getProfileStatuses returns all profile statuses
The `ProfileService.getProfileStatuses()` method MUST ensure the config directory exists and MUST return the result of `profileManager.getAllStatuses()`. The returned array MUST be a `ProfileStatus[]` (the same type defined in the domain model), and MUST be empty when no profiles are configured.

#### Scenario: Returns statuses for all existing profiles
- **WHEN** profiles have been created and have cookies saved
- **THEN** `getProfileStatuses()` returns an array containing a `ProfileStatus` for each configured profile, with `isActive` reflecting the cookie validity

#### Scenario: Returns empty array when no profiles exist
- **WHEN** no profiles have been created
- **THEN** `getProfileStatuses()` returns `[]`

### Requirement: ProfileService.getAuthStatus reports default profile authentication
The `ProfileService.getAuthStatus()` method MUST return an object with two fields: `authenticated: boolean` and `profileName: string | null`. The method MUST check whether the configured default profile exists and has valid cookies; if so, it MUST return `{ authenticated: true, profileName: <default> }`. If the default profile name is unset, the method MUST return `{ authenticated: false, profileName: null }`. If the default profile exists but does not have valid cookies, the method MUST also return `{ authenticated: false, profileName: null }`.

#### Scenario: Returns authenticated when default profile has valid cookies
- **WHEN** `getAuthStatus()` is called and the default profile has fresh cookies
- **THEN** it returns `{ authenticated: true, profileName: "default" }`

#### Scenario: Returns not authenticated when default has no cookies
- **WHEN** `getAuthStatus()` is called and the default profile has no valid cookies
- **THEN** it returns `{ authenticated: false, profileName: null }`

### Requirement: ProfileService.deleteProfile removes a profile
The `ProfileService.deleteProfile(name)` method MUST validate the name, throw a `GemitermError` whose message contains `does not exist` when the profile is not in `profileManager.list()`, and otherwise call `profileManager.delete(name)`.

#### Scenario: Deletes an existing profile
- **WHEN** `deleteProfile("to-delete")` is called and the profile exists
- **THEN** `profileManager.list()` no longer contains the deleted profile name

#### Scenario: Throws on non-existent profile
- **WHEN** `deleteProfile("ghost")` is called and the profile does not exist
- **THEN** the method rejects with a `GemitermError` whose message contains `does not exist`

#### Scenario: Throws on invalid profile name
- **WHEN** `deleteProfile("bad name!")` is called
- **THEN** the method rejects with an error whose message contains `invalid characters`

### Requirement: ProfileService.renameProfile renames a profile directory
The `ProfileService.renameProfile(oldName, newName)` method MUST validate both names and call `profileManager.rename(oldName, newName)`. The underlying rename MUST move the profile directory on disk and MUST update the default profile marker when the renamed profile was the default.

#### Scenario: Renaming an existing profile moves the directory
- **WHEN** `renameProfile("old-name", "new-name")` is called and the old profile exists
- **THEN** `profileManager.list()` contains `"new-name"` and no longer contains `"old-name"`

#### Scenario: Throws when either name is invalid
- **WHEN** `renameProfile("old", "new!")` is called
- **THEN** the method rejects with an error whose message contains `invalid characters`

### Requirement: ProfileService.setDefaultProfile writes the default marker
The `ProfileService.setDefaultProfile(name)` method MUST validate the name and call `profileManager.setDefault(name)`. The underlying call MUST write the default marker file (or update it) so that subsequent `profileManager.getDefault()` reads return the new name.

#### Scenario: Setting default updates the marker
- **WHEN** `setDefaultProfile("p2")` is called and profiles `p1` and `p2` exist
- **THEN** `profileManager.getDefault()` returns `"p2"`

#### Scenario: Throws on invalid profile name
- **WHEN** `setDefaultProfile("bad!")` is called
- **THEN** the method rejects with an error whose message contains `invalid characters`

### Requirement: ProfileService is exposed via the IProfileService and IProfileQueryService interfaces
The `ProfileService` class MUST satisfy the contract of the `IProfileService` interface defined in the command handlers module, which requires `authenticate(profileName?): Promise<AuthResult>`, `deleteProfile(name): Promise<void>`, `renameProfile(oldName, newName): Promise<void>`, and `setDefaultProfile(name): Promise<void>`. It MUST additionally satisfy the `IProfileQueryService` interface defined in the query handlers module, which requires `getProfileStatuses(): Promise<ProfileStatus[]>` and `getAuthStatus(): Promise<{ authenticated: boolean; profileName: string | null }>`. The class MUST be the canonical implementation wired into both the command-handler and query-handler layers.

#### Scenario: IProfileService methods are all callable
- **WHEN** an `IProfileService` reference is used to call `authenticate`, `deleteProfile`, `renameProfile`, and `setDefaultProfile`
- **THEN** each call dispatches to the corresponding `ProfileService` method

#### Scenario: IProfileQueryService methods are all callable
- **WHEN** an `IProfileQueryService` reference is used to call `getProfileStatuses` and `getAuthStatus`
- **THEN** each call dispatches to the corresponding `ProfileService` method
