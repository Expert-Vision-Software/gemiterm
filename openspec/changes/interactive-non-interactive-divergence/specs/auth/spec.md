## MODIFIED Requirements

### Requirement: AuthCommand shows the multi-profile management menu when 2+ profiles exist

When `AuthCommand.execute` is called and `listProfiles()` returns 2 or more profile names, the command MUST render a `Profile Management` section that includes:
- A profile table rendered by `formatProfileTable` containing the statuses of the existing profiles.
- A list of options, each formatted as `  [X] <label>`, with keys and labels: `[A] Add new profile`, `[D] Delete profile`, `[S] Set default`, `[R] Rename profile`, `[E] Renew session`, `[X] Exit and continue with current default`.

The command MUST prompt the user with the text `Select an option` and route the response (case-insensitive, trimmed) to the matching handler. Any unrecognized key (or `X`) MUST be treated as `Exit` and the command MUST print the substring `Continuing with current default profile.` and return without invoking the auth flow. Each menu option MUST dispatch a corresponding command (`AUTHENTICATE`, `DELETE_PROFILE`, `RENAME_PROFILE`, `SET_DEFAULT_PROFILE`, `RENEW_PROFILE`) through the mediator instead of composing `AuthService.authenticate/renew`, `ProfileManager.delete/rename/setDefault`, or `setDefaultProfileName` directly. The same dispatch contract applies to the argv parser (`--add`, `--delete`, `--renew`, `--rename`, `--default`).

#### Scenario: Multi-profile run opens the menu

- **WHEN** `auth` is invoked and multiple profiles exist
- **THEN** `showProfileMenu` is called with the list of profile names and a `ProfileManager` instance

#### Scenario: Menu renders all six options

- **WHEN** the menu is rendered for any 2+ profile setup
- **THEN** the combined output contains the substrings `[A] Add new profile`, `[D] Delete profile`, `[S] Set default`, `[R] Rename profile`, `[E] Renew session`, and `[X] Exit`

#### Scenario: Unknown option exits to default

- **WHEN** the user enters `Z` (or any non-matching key) at the menu prompt
- **THEN** the command prints `Continuing with current default profile.` and returns without dispatching any command

#### Scenario: X option exits to default

- **WHEN** the user enters `X` at the menu prompt
- **THEN** the command prints `Continuing with current default profile.` and returns without dispatching any command

#### Scenario: A option dispatches AUTHENTICATE with create

- **WHEN** the user selects `A` and enters a fresh profile name
- **THEN** the command dispatches an `AUTHENTICATE` command with `payload: { profileName: <new>, create: true }` through the mediator
- **AND** does NOT call `authService.authenticate` directly

#### Scenario: D option dispatches DELETE_PROFILE

- **WHEN** the user selects `D` and confirms the delete
- **THEN** the command dispatches a `DELETE_PROFILE` command with `payload: { profileName: <name> }` through the mediator
- **AND** does NOT call `profileManager.delete` directly

#### Scenario: E option dispatches AUTHENTICATE with renew

- **WHEN** the user selects `E` and enters an existing profile name
- **THEN** the command dispatches an `AUTHENTICATE` command with `payload: { profileName: <name>, renew: true }` through the mediator
- **AND** does NOT call `authService.renew` directly