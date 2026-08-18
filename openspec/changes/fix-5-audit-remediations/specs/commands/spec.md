# Delta: commands (fix-5-audit-remediations)

Truth-syncs four requirements to the post-fix-4 architecture (CookieSession context, direct dispatch, `login` alias, async `listProfiles`) and removes one never-implemented requirement. Observable CLI behavior is unchanged; menu/prompt/error text pins are preserved.

## MODIFIED Requirements

### Requirement: ContinueCommand
The system MUST provide a `continue` command implemented by `ContinueCommand` in `src/cli/commands/continue-command.ts`. The command MUST accept an optional positional `<conversation_id>` and an optional positional `<message>`, plus `--help/-h` and `--profile`. When `<conversation_id>` is missing, the command MUST invoke the `list` command via the shared command-invoker helper and return. When `<conversation_id>` is present, the command MUST resolve the owning profile through the shared `resolveProfile` helper (`src/cli/utils/profile-resolution.ts`), which consults `context.cookieSession.activeProfiles()` and - when more than one profile is active - `context.cookieSession.findProfileForConversation(conversationId)`, throwing `AuthenticationError` with the shared remediation message when no owner is found; in a single-profile setup the helper MUST return `null` and the default profile is used without a lookup. When both `<conversation_id>` and `<message>` are present, the command MUST send the message as a one-shot continuation through the shared chat-session dispatch with the resolved profile. When `<conversation_id>` is present and `<message>` is absent, the command MUST start an interactive chat session via the shared chat-session helper and MUST create exactly one session keepalive (through `context.cookieSession.createKeepalive`) for the resolved-or-default profile; the REPL MUST exit on `/exit` or `/quit` and MUST ignore empty lines. When no profile owns the conversation, the command MUST throw `AuthenticationError` with a remediation message and exit non-zero.

#### Scenario: Continue with id and message sends a one-shot continuation
- **WHEN** `gemiterm continue <cid> hello` runs and `resolveProfile` resolves profile `work`
- **THEN** the message is dispatched through the shared chat-session path against `work`'s client, and no interactive session or keepalive is created

#### Scenario: Continue without a message opens the REPL with a keepalive
- **WHEN** `gemiterm continue <cid>` runs
- **THEN** an interactive session starts via the shared chat-session helper and exactly one keepalive is created for the resolved profile

#### Scenario: Multi-profile ownership lookup routes through the auth facade
- **WHEN** more than one profile is active and `context.cookieSession.findProfileForConversation(<cid>)` returns `work`
- **THEN** the continuation is routed to `work`'s `GeminiClientService` and no legacy `ProfileAuthManager` is referenced

#### Scenario: No owning profile fails with remediation
- **WHEN** no active profile owns `<cid>` and no `--profile` is given
- **THEN** the command exits non-zero with an `AuthenticationError` whose message names the conversation and suggests `gemiterm list --all-profiles` or `--profile <name>`

### Requirement: DeleteCommand
The system MUST provide a `delete` command implemented by `DeleteCommand` in `src/cli/commands/delete-command.ts`. The command MUST accept a single positional `<conversation_id>` argument and MUST support `--force/-f`, `--profile`, and `--help/-h`. When `<conversation_id>` is missing, the command MUST print `Error: conversation ID is required.` and exit with code 1. When `<conversation_id>` is present, the command MUST validate the id via `validateConversationId`. The command MUST resolve the owning profile through the shared `resolveProfile` helper (`context.cookieSession.activeProfiles()` / `findProfileForConversation`), throwing `AuthenticationError` with the shared remediation message when no owner is found; in a single-profile setup the default profile is used without a lookup. When `--force` is not set, the command MUST prompt for confirmation and MUST treat a `y`-prefix (case-insensitive) answer as consent; declining MUST print `Cancelled.` and stop. On confirmation (or `--force`), the command MUST delete the conversation through the resolved profile's `GeminiClientService` obtained from the context client factory. The command MUST print `Conversation '<id>' deleted.` on success and MUST exit with code 1 on a failed result or error. When an explicit `--profile` names a profile without a valid session, the command MUST throw `AuthenticationError` suggesting `gemiterm auth --renew <name>`.

#### Scenario: Delete with --force skips the prompt
- **WHEN** `gemiterm delete <cid> -f` runs and the profile is resolved
- **THEN** no confirmation prompt is shown and the delete routes to the resolved profile's client

#### Scenario: Declining confirmation cancels
- **WHEN** the confirmation prompt is answered with `n`
- **THEN** `Cancelled.` is printed, nothing is deleted, and the conversation remains

#### Scenario: Missing id errors with code 1
- **WHEN** `gemiterm delete` runs with no argument
- **THEN** `Error: conversation ID is required.` is printed and the exit code is 1

### Requirement: AuthCommand
The system MUST provide an `auth` command implemented by `AuthCommand` in `src/cli/commands/auth-command.ts`. The command MUST be registered under the name `auth` with `login` as a registered alias, and MUST accept an optional positional `<profile_name>` that authenticates an existing profile directly (equivalent to the `auth` action's `profileName` param). The command MUST be a thin adapter: it MUST delegate all profile-lifecycle work to `context.profileLifecycle.manageProfiles(action, params)`, which forwards the actual browser-driven authentication to `context.cookieSession.captureLogin` (the `create` action after `ProfileManager.create`, and the `auth` action's renewal via `captureLogin(profile, { mode: "renew" })` for `--renew`). The command MUST accept the subaction flags `--add <name>`, `--delete <name>`, `--rename <old> <new>` (or paired values), `--default <name>`, and `--renew <name>`, mapping them to the corresponding lifecycle actions; with no flags it MUST run the interactive flow. The command MUST NOT construct any profile, storage, browser, or auth collaborator itself - everything arrives via `CliCommandContext`. When zero profiles exist, the command MUST create the default profile and authenticate against it. When exactly one profile exists, the command MUST authenticate against that profile directly. When more than one profile exists, the command MUST display a profile management menu using `formatProfileTable` and the options `[A] Add new profile`, `[D] Delete profile`, `[S] Set default`, `[R] Rename profile`, `[E] Renew session (extend/refresh cookies)`, `[X] Exit and continue with current default`. The `A` and `R` options MUST trigger authentication against the resulting profile; the `E` option MUST renew the named profile's session via `captureLogin(name, { mode: "renew" })`; `D`, `S`, and `X` MUST NOT trigger authentication. The `D` option MUST require a `[y/N]` confirmation before deletion. Profile names MUST be validated via `validateProfileName`. All menu text, prompts, and error messages MUST be byte-equivalent to the pre-change baseline.

#### Scenario: Auth with no profiles creates and authenticates the default profile
- **WHEN** the user runs `gemiterm auth` and no profiles exist
- **THEN** the default profile is created and `CookieSession.captureLogin` is invoked against it

#### Scenario: Auth with one profile authenticates that profile directly
- **WHEN** the user runs `gemiterm auth` and exactly one profile exists
- **THEN** `CookieSession.captureLogin` is invoked against that profile and no menu is shown

#### Scenario: Auth menu option A creates and authenticates
- **WHEN** the user selects `A` and enters a valid new profile name
- **THEN** the profile is created and `CookieSession.captureLogin` is invoked against the new name

#### Scenario: Auth menu option R renames and authenticates
- **WHEN** the user selects `R` and enters an existing name and a new valid name
- **THEN** `ProfileManager.rename(old, new)` is called and `CookieSession.captureLogin` is invoked against the new name

#### Scenario: Auth menu option X exits without authenticating
- **WHEN** the user selects `X` (or any other unhandled option) in the menu
- **THEN** no `captureLogin` is invoked and the output contains `Continuing with current default profile.`

#### Scenario: login alias resolves to the same command
- **WHEN** `gemiterm login --renew <name>` runs
- **THEN** the registered `login` alias dispatches to `AuthCommand` and the renewal delegates to `captureLogin(name, { mode: "renew" })`

### Requirement: CommandRegistry
The system MUST provide a `CommandRegistry` class in `src/cli/command-registry.ts` that stores `CliCommand` instances keyed by command name. The `register(name, handler)` method MUST throw `Command already registered: <name>` when the same name is registered twice. The `getHandler(name)` method MUST return the handler for the name or `undefined` if not present. The `has(name)` method MUST return a boolean. The `getRegisteredNames()` method MUST return an array of all registered names. The `registerAllCommands()` method MUST register all commands by name, with `login` registered as an alias of the `auth` command. The `CliCommandContext` interface MUST carry `{ verbose: boolean, cookieSession: CookieSession, profileLifecycle: ProfileLifecycle, exportStrategies: { single: ExportStrategy; batch: ExportStrategy }, getGeminiClient: (profileName?: string) => Promise<GeminiClientService>, listProfiles: () => Promise<string[]> }` (no `mediator` field). The `CliCommand` interface MUST require `name: string`, `description: string`, and `execute(args, context): Promise<void>`.

#### Scenario: Registering the same name twice throws
- **WHEN** `register("list", handler)` is called twice
- **THEN** the second call throws an error whose message contains `Command already registered: list`

#### Scenario: Context carries services, not a mediator
- **WHEN** a `CliCommandContext` is constructed for a command
- **THEN** it exposes `verbose`, `cookieSession`, `profileLifecycle`, `exportStrategies`, `getGeminiClient`, and `listProfiles` (async), and does NOT expose a `mediator` or `profileAuthManager` field

#### Scenario: login alias dispatches to the auth command
- **WHEN** `registerAllCommands()` runs and `getHandler("login")` is called
- **THEN** the returned handler is the same instance registered under `auth`

## REMOVED Requirements

### Requirement: ProfileCommand
**Reason**: The requirement specifies a `profile` subcommand dispatcher (`src/cli/commands/profile-command.ts`) that was never implemented in the current CLI: the file does not exist and `registerAllCommands()` registers no `profile` command. The requirement contradicts the shipped `CommandRegistry` surface and describes deleted-era collaborators (`AuthService.authenticate` after `ProfileManager.create`).
**Migration**: Profile management is owned by the `auth` command (interactive menu and `--add`/`--delete`/`--rename`/`--default`/`--renew` flags) via the `profile-lifecycle` capability's `manageProfiles` actions; authentication inside those flows is `CookieSession.captureLogin` (see the modified `AuthCommand` requirement). No user-facing capability is lost - no shipped command is removed.
