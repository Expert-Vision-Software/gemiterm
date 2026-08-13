## MODIFIED Requirements

### Requirement: CommandRegistry

The system MUST provide a `CommandRegistry` class in `src/cli/command-registry.ts` that stores `CliCommand` instances keyed by command name. The `register(name, handler)` method MUST throw `Command already registered: <name>` when the same name is registered twice. The `getHandler(name)` method MUST return the handler for the name or `undefined` if not present. The `has(name)` method MUST return a boolean. The `getRegisteredNames()` method MUST return an array of all registered names. The `registerAllCommands()` method MUST register all commands by name (including `auth`/`login`, `status`, `list`, `fetch`, `continue`, `new`, `delete`, `export`, `export-all`, `install-browser`, `install-skills`, `models`). The `CliCommandContext` interface MUST carry `{ verbose: boolean, profileAuthManager: ProfileAuthManager, getGeminiClient: () => GeminiClientService, listProfiles: () => string[] }`. The `CliCommand` interface MUST require `name: string`, `description: string`, and `execute(args, context): Promise<void>`.

#### Scenario: Registering the same name twice throws
- **WHEN** `register("dup", handlerA)` is called and then `register("dup", handlerB)`
- **THEN** the second call throws `Command already registered: dup`

#### Scenario: getHandler returns the registered handler
- **WHEN** `register("list", handler)` is called
- **THEN** `getHandler("list")` returns the same handler instance

#### Scenario: getHandler returns undefined for unknown names
- **WHEN** no handler is registered for `nope`
- **THEN** `getHandler("nope")` returns `undefined` and `has("nope")` returns `false`

#### Scenario: registerAllCommands registers all commands
- **WHEN** `registerAllCommands()` is called
- **THEN** `getRegisteredNames()` returns an array that includes every user-facing command name

#### Scenario: Context carries services, not a mediator
- **WHEN** a `CliCommandContext` is constructed for a command
- **THEN** it exposes `verbose`, `profileAuthManager`, `getGeminiClient`, and `listProfiles`, and does NOT expose a `mediator` field

### Requirement: Commands Dispatch Directly to Services

Command handlers MUST obtain the `GeminiClientService` via `context.getGeminiClient()` and call its methods directly; they MUST NOT send messages through a mediator. Profile-scoped operations MUST route to `client.forProfile(profileName)` when a profile is resolved, otherwise the default client. The user-visible behavior (flags, output formatting, exit codes, error messages) MUST remain byte-equivalent to the pre-mediator-removal baseline.

#### Scenario: List dispatches directly
- **WHEN** the user runs `gemiterm list --limit 5`
- **THEN** the command calls `getGeminiClient()` and renders at most 5 chats via `formatChatList`; no mediator is involved

#### Scenario: Profile-scoped fetch routes to forProfile
- **WHEN** the user runs `gemiterm fetch <id> --profile work`
- **THEN** the command calls `getGeminiClient().forProfile("work").fetchChat(id)`

#### Scenario: Delete dispatches directly
- **WHEN** the user runs `gemiterm delete <id> --force`
- **THEN** the command calls `deleteChat(id)` on the resolved client and prints `deleted.` on success

### Requirement: Command Help Output

Every command in the registry MUST support `--help` and `-h`. When `--help` or `-h` is supplied, the command MUST print a usage block starting with `Usage: gemiterm <command> ...` and MUST NOT perform its primary action (no `GeminiClientService` call is made). Each command's usage block MUST list that command's flags and positional arguments.

#### Scenario: Every command has a --help that starts with Usage
- **WHEN** any of `gemiterm <cmd> --help` or `gemiterm <cmd> -h` is invoked for a registered command
- **THEN** the first line of the output is `Usage: gemiterm <cmd> ...`

#### Scenario: --help does not perform the command's primary action
- **WHEN** `gemiterm <cmd> --help` is invoked
- **THEN** the command's primary action is not executed (no `GeminiClientService` method is called)
