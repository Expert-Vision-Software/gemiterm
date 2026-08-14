## MODIFIED Requirements

### Requirement: AuthCommand

The system MUST provide an `auth` command implemented by `AuthCommand` in `src/cli/commands/auth-command.ts`. The command MUST be registered under the name `auth` (NOT `login`) and MUST take no positional arguments. The command MUST be a thin adapter: it MUST delegate all profile-lifecycle work to `context.profileLifecycle.manageProfiles(action, params)`, which forwards the actual browser-driven authentication to `AuthService.authenticate(profileName)`. The command MUST NOT construct `CookieStorage`, `ProfileManager`, `PlaywrightCliDriver`, `CookieMonitor`, or `AuthService` itself. When zero profiles exist, the command MUST create the default profile and authenticate against it. When exactly one profile exists, the command MUST authenticate against that profile directly. When more than one profile exists, the command MUST display a profile management menu using `formatProfileTable` and the options `[A] Add new profile`, `[D] Delete profile`, `[S] Set default`, `[R] Rename profile`, `[X] Exit and continue with current default`. The `A` and `R` options MUST trigger authentication against the resulting profile; `D`, `S`, and `X` MUST NOT trigger authentication. The `D` option MUST require a `[y/N]` confirmation before deletion. The `S` option MUST set the default profile through the module (which calls both `ProfileManager.setDefault` and `setDefaultProfileName`). Profile names MUST be validated via `validateProfileName`. All menu text, prompts, and error messages MUST be byte-equivalent to the pre-change baseline.

#### Scenario: Auth with no profiles creates and authenticates the default profile
- **WHEN** the user runs `gemiterm auth` and no profiles exist
- **THEN** the default profile is created and `AuthService.authenticate` is invoked against it

#### Scenario: Auth with one profile authenticates that profile directly
- **WHEN** the user runs `gemiterm auth` and exactly one profile exists
- **THEN** `AuthService.authenticate` is invoked against that profile and no menu is shown

#### Scenario: Auth with multiple profiles shows the menu
- **WHEN** the user runs `gemiterm auth` and more than one profile exists
- **THEN** the profile management menu is printed and the user is prompted with `Select an option:`

#### Scenario: Auth menu option A creates and authenticates
- **WHEN** the user selects `A` and enters a valid new profile name
- **THEN** the profile is created and `AuthService.authenticate` is invoked against the new name

#### Scenario: Auth menu option D requires confirmation
- **WHEN** the user selects `D`, enters an existing profile name, and answers the `Delete profile '<name>'? [y/N]` prompt with `y`
- **THEN** the profile is removed via `ProfileManager.delete`

#### Scenario: Auth menu option S sets the default profile
- **WHEN** the user selects `S` and enters an existing profile name
- **THEN** `ProfileManager.setDefault(name)` and `setDefaultProfileName(name)` are both called

#### Scenario: Auth menu option R renames and authenticates
- **WHEN** the user selects `R` and enters an existing name and a new valid name
- **THEN** `ProfileManager.rename(old, new)` is called and `AuthService.authenticate` is invoked against the new name

#### Scenario: Auth menu option X exits without authenticating
- **WHEN** the user selects `X` (or any other unhandled option) in the menu
- **THEN** no `AuthService.authenticate` is invoked and the output contains `Continuing with current default profile.`

#### Scenario: Auth rejects invalid profile names
- **WHEN** the user enters an invalid profile name in response to an `A` or `R` prompt
- **THEN** `validateProfileName` throws and the command fails with the validator's error message

#### Scenario: Auth --help shows usage
- **WHEN** the user runs `gemiterm auth --help`
- **THEN** the output contains `Usage: gemiterm auth` and documents `-h, --help`

#### Scenario: Auth delegates through the context
- **WHEN** `AuthCommand.execute` runs
- **THEN** every profile-lifecycle operation is dispatched via `context.profileLifecycle.manageProfiles(...)` and the command file contains no inline service construction

### Requirement: StatusCommand

The system MUST provide a `status` command implemented by `StatusCommand` in `src/cli/commands/status-command.ts`. The command MUST take no arguments (other than `--help/-h`) and MUST be a thin adapter that delegates to `context.profileLifecycle.manageProfiles("status", {})`. The command MUST NOT construct `CookieStorage` or `ProfileManager` itself. The module-backed action MUST call `ensureConfigDir()`, MUST print a `Configuration` section containing `Directory: <configDir>` (the value from `getConfigDir()`), and MUST then print a `Profiles` section using `formatProfileTable`. When no profiles exist, the command MUST print `No profiles found. Run 'gemiterm login' to create one.` and MUST exit with code 2. When profiles exist, the command MUST additionally log a status line with the count of active profiles via `Logger.info`.

#### Scenario: Status with profiles shows the directory and the profile table
- **WHEN** the user runs `gemiterm status` and at least one profile exists
- **THEN** the output contains `Configuration`, `Directory: <configDir>`, `Profiles`, and a profile table with columns `NAME`, `ACTIVE`, `EXPIRES`, `DEFAULT`

#### Scenario: Status with no profiles exits with code 2
- **WHEN** the user runs `gemiterm status` and no profiles exist
- **THEN** the output contains `No profiles found.` and the process exits with code 2

#### Scenario: Status --help shows usage
- **WHEN** the user runs `gemiterm status --help`
- **THEN** the output contains `Usage: gemiterm status` and documents `-h, --help`

#### Scenario: Status delegates through the context
- **WHEN** `StatusCommand.execute` runs
- **THEN** the profile-lifecycle work is dispatched via `context.profileLifecycle.manageProfiles("status", {})` and the command file contains no inline service construction

### Requirement: CommandRegistry

The system MUST provide a `CommandRegistry` class in `src/cli/command-registry.ts` that stores `CliCommand` instances keyed by command name. The `register(name, handler)` method MUST throw `Command already registered: <name>` when the same name is registered twice. The `getHandler(name)` method MUST return the handler for the name or `undefined` if not present. The `has(name)` method MUST return a boolean. The `getRegisteredNames()` method MUST return an array of all registered names. The `registerAllCommands()` method MUST register all commands by name. The `CliCommandContext` interface MUST carry `{ verbose: boolean, profileAuthManager: ProfileAuthManager, profileLifecycle: ProfileLifecycle, getGeminiClient: () => GeminiClientService, listProfiles: () => string[] }` (no `mediator` field). The `CliCommand` interface MUST require `name: string`, `description: string`, and `execute(args, context): Promise<void>`.

#### Scenario: Registering the same name twice throws
- **WHEN** `register("dup", handlerA)` is called and then `register("dup", handlerB)`
- **THEN** the second call throws `Command already registered: dup`

#### Scenario: getHandler returns the registered handler
- **WHEN** `register("list", handler)` is called
- **THEN** `getHandler("list")` returns the same handler instance

#### Scenario: getHandler returns undefined for unknown names
- **WHEN** no handler is registered for `nope`
- **THEN** `getHandler("nope")` returns `undefined` and `has("nope")` returns `false`

#### Scenario: registerAllCommands registers all 11 commands
- **WHEN** `registerAllCommands()` is called
- **THEN** `getRegisteredNames()` returns an array that includes `auth`, `login`, `status`, `list`, `fetch`, `continue`, `new`, `delete`, `export`, `export-all`, `install-browser`, `install-skills`, and `models`

#### Scenario: Context carries services, not a mediator
- **WHEN** a `CliCommandContext` is constructed for a command
- **THEN** it exposes `verbose`, `profileAuthManager`, `profileLifecycle`, `getGeminiClient`, and `listProfiles`, and does NOT expose a `mediator` field
