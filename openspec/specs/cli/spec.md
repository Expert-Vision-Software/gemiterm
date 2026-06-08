## Purpose

The CLI entry point for the `gemiterm` application. It provides the executable shebang, parses global flags, registers the 11 top-level commands, prints help and version output, and dispatches subcommand execution to a `CommandRegistry`. The CLI is the only public face of the application and is the process entry point launched by the user.

## Requirements

### Requirement: Bun Shebang Entry Point
The CLI source file MUST begin with the shebang line `#!/usr/bin/env bun` so the file is executable directly by the Bun runtime when invoked as a script or compiled binary. The shebang MUST appear on the first line of `src/cli/index.ts`.

#### Scenario: Inspecting the shebang line
- **WHEN** the file `src/cli/index.ts` is read
- **THEN** the first line is exactly `#!/usr/bin/env bun`

### Requirement: Global Flags Parsing
The system MUST parse global flags from the raw process arguments and expose a `GlobalFlags` object with three boolean fields: `verbose`, `version`, and `help`. The parser MUST recognize `--verbose` and its short alias `-v` as setting `verbose=true`, MUST recognize `--version` as setting `version=true`, and MUST recognize `--help` and its short alias `-h` as setting `help=true` (only when no subcommand has been seen yet). All non-flag arguments MUST be returned as `remaining` args.

#### Scenario: Verbose flag sets verbose
- **WHEN** the user invokes `gemiterm --verbose list`
- **THEN** `parseGlobalFlags` returns `flags.verbose === true` and `remaining === ["list"]`

#### Scenario: Verbose short alias works
- **WHEN** the user invokes `gemiterm -v list`
- **THEN** `flags.verbose === true` and `remaining === ["list"]`

#### Scenario: Version flag sets version
- **WHEN** the user invokes `gemiterm --version`
- **THEN** `flags.version === true` and `remaining === []`

#### Scenario: Help flag sets help
- **WHEN** the user invokes `gemiterm --help`
- **THEN** `flags.help === true` and `remaining === []`

#### Scenario: Help short alias works
- **WHEN** the user invokes `gemiterm -h`
- **THEN** `flags.help === true` and `remaining === []`

### Requirement: Verbose Flag Enables Debug Logging
When the global `--verbose` flag is set, the system MUST call `Logger.setVerbose(true)` so that `debug()` output from every `Logger` instance is emitted.

#### Scenario: Verbose flag enables debug
- **WHEN** the user runs `gemiterm --verbose <command>`
- **THEN** `Logger.setVerbose(true)` is invoked before the command handler runs

### Requirement: Version Output From Package Metadata
When the `--version` global flag is set, the system MUST print `gemiterm v<version>` to stdout and exit the process with code 0, where `<version>` is read from the `version` field of the `package.json` at the project root.

#### Scenario: Version output
- **WHEN** the user invokes `gemiterm --version`
- **THEN** the process prints a line of the form `gemiterm v2.0.0` to stdout and exits with code 0

### Requirement: No-Args Behavior Prints Help
When the user invokes `gemiterm` with no arguments (after global flag parsing), the system MUST print the help screen via `showHelp(registry)` and exit the process with code 0.

#### Scenario: No arguments prints help
- **WHEN** the user invokes `gemiterm` with no arguments
- **THEN** `showHelp(registry)` is called and the process exits with code 0

### Requirement: Unknown Subcommand Suggestion
When the user invokes a subcommand that is not registered with the `CommandRegistry`, the system MUST print an `Unknown command` message to stderr. If at least one command is registered, the system MUST also print a `Did you mean one of: <names>?` suggestion line listing the registered command names. If no commands are registered, the system MUST print a fallback message directing the user to `--help`. In both cases the system MUST exit with code 1.

#### Scenario: Unknown subcommand with registered names
- **WHEN** the user invokes `gemiterm not-a-command` and the registry contains registered names
- **THEN** stderr receives `Unknown command: 'not-a-command'` followed by a line starting with `Did you mean one of:` and the process exits with code 1

#### Scenario: Unknown subcommand with empty registry
- **WHEN** the user invokes `gemiterm not-a-command` and the registry is empty
- **THEN** stderr receives `Unknown command: 'not-a-command'` and a fallback suggesting `--help`, and the process exits with code 1

### Requirement: CommandRegistry Public Surface
The `CommandRegistry` class MUST expose a `register(commandName, handler)` method that throws if the name is already registered, a `getHandler(commandName)` method that returns the handler or `undefined`, a `has(commandName)` boolean check, a `getRegisteredNames()` method returning all registered names, and a `registerAllCommands()` method that wires up the full default command set.

#### Scenario: Register a new command
- **WHEN** `register("x", handler)` is called on a registry that does not yet contain `"x"`
- **THEN** `has("x")` returns `true` and `getHandler("x")` returns the registered handler

#### Scenario: Re-registering the same name throws
- **WHEN** `register("x", handler)` is called twice with the same name
- **THEN** the second call throws an error whose message mentions the duplicate name

#### Scenario: getHandler for missing name returns undefined
- **WHEN** `getHandler("missing")` is called on a registry that does not contain it
- **THEN** the result is `undefined`

#### Scenario: getRegisteredNames returns the registered keys
- **WHEN** commands `"a"`, `"b"`, and `"c"` are registered
- **THEN** `getRegisteredNames()` returns a list containing all three names

### Requirement: Default Command Set Registration
`CommandRegistry.registerAllCommands()` MUST explicitly register exactly 11 commands: `auth`, `profile`, `status`, `list`, `fetch`, `continue`, `new`, `delete`, `export`, `export-all`, and `install-browser`. Each registration MUST be performed by direct, hand-written `register()` calls — the system MUST NOT use any auto-discovery or glob-based mechanism to populate the registry.

#### Scenario: After registerAllCommands the registry has 11 entries
- **WHEN** a fresh `CommandRegistry` has `registerAllCommands()` invoked
- **THEN** `getRegisteredNames()` returns exactly the names `auth`, `profile`, `status`, `list`, `fetch`, `continue`, `new`, `delete`, `export`, `export-all`, and `install-browser`

#### Scenario: Each registered name resolves to a handler
- **WHEN** `registerAllCommands()` has been called
- **THEN** `getHandler(name)` returns a non-`undefined` `CliCommand` for each of the 11 names

### Requirement: Help Output
The system MUST expose a `showHelp(registry?)` function in `src/cli/commands/help.ts` that, when a registry is provided, prints the registered command names with their descriptions, then prints the three global options (`--version`, `--help, -h`, `--verbose, -v`) with their descriptions, and finally prints a hint to run `gemiterm <command> --help` for more information.

#### Scenario: Help with a registry
- **WHEN** `showHelp(registry)` is called with a registry containing 11 commands
- **THEN** the output contains the application name `GemiTerm`, a `Commands:` section listing all 11 names and their descriptions, a `Global Options:` section listing the three global flags, and the hint about `<command> --help`

#### Scenario: Help with no registry
- **WHEN** `showHelp()` is called with no arguments
- **THEN** the output still includes the application name, the `Global Options:` section, and the command-specific help hint (the `Commands:` section is empty)
