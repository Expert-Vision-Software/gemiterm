## Purpose

The `ProfileLifecycle` module (`src/services/profile-lifecycle.ts`) — the single home for profile CRUD (list / create / delete / rename / set-default), the auth login flow delegation, status reporting, and the all-profiles warn-and-continue iteration contract. It exposes a single action-dispatch interface `manageProfiles(action, params)` and is context-injected through `CliCommandContext.profileLifecycle`, ending the service-locator pattern in the `auth` and `status` commands. It also owns the byte-equivalence contract that keeps `gemiterm auth` and `gemiterm status` output identical to the pre-change baseline.
## Requirements
### Requirement: ProfileLifecycle Module Action-Dispatch Interface

The system MUST provide a `ProfileLifecycle` module in `src/services/profile-lifecycle.ts` exposing a single action-dispatch method `manageProfiles(action, params)`, where `action` is one of `'list' | 'create' | 'delete' | 'rename' | 'set-default' | 'status' | 'auth'`. The module MUST own all profile I/O (delegating to `ProfileManager`), the login browser flow (delegating to the injected `CookieSession`'s `captureLogin`), default-profile marker management, and status reporting (including the read-only session probe via `CookieSession.probeDetailed`). The module MUST receive `ProfileManager`, `CookieSession`, and its logger through its deps-object; it MUST NOT construct browser drivers, cookie monitors, or legacy auth services (none exist in the codebase).

#### Scenario: Every action is reachable through the dispatch method

- **WHEN** `manageProfiles` is called with each of `'list'`, `'create'`, `'delete'`, `'rename'`, `'set-default'`, `'status'`, and `'auth'` (with valid params)
- **THEN** each call dispatches to the corresponding lifecycle implementation and returns that action's result

#### Scenario: Unknown action is rejected

- **WHEN** `manageProfiles("bogus" as ProfileAction, {})` is called
- **THEN** the module throws a `GemitermError` naming the invalid action and listing the valid actions

#### Scenario: Login flows route through the auth facade

- **WHEN** the `create` or `auth` action triggers browser-driven authentication
- **THEN** the login is delegated to `cookieSession.captureLogin` and the module never references an `AuthService` or `CookieMonitor`

### Requirement: ProfileLifecycle `list` Action Renders the Shared Profile Table

The `list` action MUST map every configured profile name to a `ProfileStatus` decorated with `isDefault` (comparing against the configured default profile name), print the `Profiles` header, render the statuses via `formatProfileTable`, and log the active-profile count. When no profiles exist, the action MUST print the existing empty-profiles guidance message. This idiom MUST live in exactly one place — the module — with no copy remaining in any command file.

#### Scenario: list renders the table with the default marker

- **WHEN** `manageProfiles("list", {})` is called and profiles `work` (default) and `personal` exist
- **THEN** the output contains a `Profiles` header and a `formatProfileTable` table whose rows carry `isDefault` for `work` and not for `personal`

#### Scenario: list with no profiles prints guidance

- **WHEN** `manageProfiles("list", {})` is called and no profiles exist
- **THEN** the output contains the existing empty-profiles guidance message

### Requirement: ProfileLifecycle CRUD Actions Delegate With Validation

The `create` action MUST validate the profile name via `validateProfileName`, create the profile via `ProfileManager.create` when absent, and delegate the login flow to `CookieSession.captureLogin`. The `auth` action MUST support renewal of an existing profile via `captureLogin(profile, { mode: "renew" })`, throwing `Profile '<name>' does not exist.` when the named profile is absent. The `delete` action MUST require a `[y/N]` confirmation before calling `ProfileManager.delete`. The `rename` action MUST validate both names and call `ProfileManager.rename(old, new)`. The `set-default` action MUST call both `ProfileManager.setDefault` and `setDefaultProfileName`. All user-visible prompts, confirmations, and error messages MUST be byte-equivalent to the pre-change `auth`-menu and `status` behaviors.

#### Scenario: create validates the name before creating

- **WHEN** `manageProfiles("create", { name: "bad name!" })` is called
- **THEN** the action fails with the `validateProfileName` error message and no profile is created

#### Scenario: Create validates then logs in through the facade

- **WHEN** `manageProfiles("create", { name: "work" })` runs and "work" does not exist
- **THEN** `ProfileManager.create("work")` is called and `cookieSession.captureLogin("work")` completes the login

#### Scenario: delete requires confirmation

- **WHEN** `manageProfiles("delete", { name: "work" })` is called and the confirmation is declined
- **THEN** `ProfileManager.delete` is not called and the output contains `Cancelled.`

#### Scenario: set-default updates both marker surfaces

- **WHEN** `manageProfiles("set-default", { name: "p2" })` is called
- **THEN** `ProfileManager.setDefault("p2")` is called and `setDefaultProfileName("p2")` records the new default

#### Scenario: Renew rejects an unknown profile

- **WHEN** `manageProfiles("auth", { renewProfile: "ghost" })` runs and "ghost" is not stored
- **THEN** a `GemitermError` with message `Profile 'ghost' does not exist.` is thrown and no browser opens

### Requirement: ProfileLifecycle `status` Action Reports Configuration and Profiles

The `status` action MUST ensure the config directory exists, print the `Configuration` section containing `Directory: <configDir>` (from `getConfigDir()`), and print the `Profiles` section via the shared table idiom. When no profiles exist it MUST produce the existing `No profiles found. Run 'gemiterm login' to create one.` message and the command MUST exit with code 2. When profiles exist it MUST log the active-profile count.

#### Scenario: status prints configuration and profile sections

- **WHEN** `manageProfiles("status", {})` is called and at least one profile exists
- **THEN** the output contains `Configuration`, `Directory: <configDir>`, `Profiles`, and the profile table

#### Scenario: status with no profiles signals exit code 2

- **WHEN** `manageProfiles("status", {})` is called and no profiles exist
- **THEN** the output contains `No profiles found.` and the surfaced result instructs the command to exit with code 2

### Requirement: ProfileLifecycle Iterates All Profiles With Warn-and-Continue

For the `list` and `status` actions, the module MUST iterate every configured profile. If reading one profile's status fails (unreadable storage, corrupted cookie file), the module MUST log a warning naming the profile and continue with the remaining profiles; the batch MUST NOT abort on a single profile failure.

#### Scenario: One unreadable profile does not abort the table

- **WHEN** `manageProfiles("list", {})` is called and profile `broken` throws on status read while `work` and `personal` succeed
- **THEN** a warning naming `broken` is logged and the table still renders rows for `work` and `personal`

#### Scenario: All profiles failing still completes gracefully

- **WHEN** every configured profile fails its status read
- **THEN** each failure is logged as a warning and the action completes without throwing an unhandled error

### Requirement: ProfileLifecycle Is Context-Injected, Not Service-Located

The `ProfileLifecycle` instance MUST be constructed once in `src/cli/index.ts` (the composition root, alongside `createCookieSession`) and carried on `CliCommandContext` as `profileLifecycle`. The `auth` and `status` commands MUST obtain the module exclusively from `context.profileLifecycle` and MUST NOT construct `ProfileManager`, `CookieSession`, or any browser/auth collaborator themselves.

#### Scenario: auth-command contains no service construction

- **WHEN** `src/cli/commands/auth-command.ts` is inspected after the change
- **THEN** it contains no `new CookieStorage`, `new ProfileManager`, `new PlaywrightCliDriver`, `new CookieMonitor`, or `new AuthService` expression

#### Scenario: status-command contains no service construction

- **WHEN** `src/cli/commands/status-command.ts` is inspected after the change
- **THEN** it contains no `new CookieStorage` or `new ProfileManager` expression

#### Scenario: Commands contain no service-locator expressions

- **WHEN** `src/cli/commands/auth-command.ts` and `src/cli/commands/status-command.ts` are inspected
- **THEN** they contain no `new ProfileManager`, `new CookieStorage`, `createCookieSession(`, or driver-construction expression; every dependency arrives via `context`

### Requirement: ProfileLifecycle Output Byte-Equivalence

The user-visible output of `gemiterm auth` (zero/one/multi-profile flows, every menu option, every prompt and error message) and `gemiterm status` (sections, table, exit codes) MUST remain byte-equivalent to the pre-change baseline. Existing command-level tests assert this equivalence and MUST pass without modification to their output expectations.

#### Scenario: Auth menu flows are unchanged

- **WHEN** the existing `tests/cli/commands/auth-command.test.ts` scenarios (zero profiles, one profile, menu options A/D/S/R/X, invalid names, `--help`) run against the refactored commands
- **THEN** every assertion passes without editing its expected output

#### Scenario: Status output is unchanged

- **WHEN** the existing `tests/cli/commands/status-command.test.ts` scenarios (sections, empty-profiles exit code 2, `--help`) run against the refactored commands
- **THEN** every assertion passes without editing its expected output

