## MODIFIED Requirements

### Requirement: Global Flags Parsing
The system MUST parse global flags from the raw process arguments via a function `parseGlobalArgs(argv: string[])` exported from `src/infrastructure/cli-parser.ts`. The function MUST return an object `{ flags, subcommand, subcommandArgs }` where `flags` is an object with three boolean fields (`verbose`, `version`, `help`) and `subcommand` is the first non-flag token in `argv` (or `null` if none). The parser MUST be implemented on top of the `commander` npm library, which is imported only by `src/infrastructure/cli-parser.ts` and not by any other file in `src/`. The parser MUST recognize `--verbose` and its short alias `-v` as setting `verbose=true`, MUST recognize `--version` as setting `version=true`, and MUST recognize `--help` and its short alias `-h` as setting `help=true`. All non-flag arguments MUST be returned as `subcommandArgs` (the array after the first non-flag token) and the first non-flag token MUST be returned as `subcommand`. The parser MUST NOT call `process.exit` itself; it MUST return a result that the caller can act on. If commander raises a `CommanderError` (e.g. for an unknown option), the wrapper MUST catch it and re-throw a project-shaped `Error` whose message starts with `gemiterm: ` followed by the commander's message, so the caller can format it consistently with the existing "Unknown command" / "Did you mean one of:" output.

#### Scenario: Verbose flag sets verbose
- **WHEN** the user invokes `gemiterm --verbose list`
- **THEN** `parseGlobalArgs(["--verbose", "list"])` returns `flags.verbose === true`, `subcommand === "list"`, and `subcommandArgs === []`

#### Scenario: Verbose short alias works
- **WHEN** the user invokes `gemiterm -v list`
- **THEN** `parseGlobalArgs(["-v", "list"])` returns `flags.verbose === true`, `subcommand === "list"`, and `subcommandArgs === []`

#### Scenario: Version flag sets version
- **WHEN** the user invokes `gemiterm --version`
- **THEN** `parseGlobalArgs(["--version"])` returns `flags.version === true`, `subcommand === null`, and `subcommandArgs === []`

#### Scenario: Help flag sets help
- **WHEN** the user invokes `gemiterm --help`
- **THEN** `parseGlobalArgs(["--help"])` returns `flags.help === true`, `subcommand === null`, and `subcommandArgs === []`

#### Scenario: Help short alias works
- **WHEN** the user invokes `gemiterm -h`
- **THEN** `parseGlobalArgs(["-h"])` returns `flags.help === true`, `subcommand === null`, and `subcommandArgs === []`

#### Scenario: Subcommand args passthrough
- **WHEN** the user invokes `gemiterm list --limit 5 --format json`
- **THEN** `parseGlobalArgs(["list", "--limit", "5", "--format", "json"])` returns `subcommand === "list"` and `subcommandArgs === ["--limit", "5", "--format", "json"]`

#### Scenario: Unknown option re-thrown as project-shaped error
- **WHEN** the user invokes `gemiterm --bogus`
- **THEN** `parseGlobalArgs` throws an error whose message starts with `gemiterm: ` and the process exits with code 1

## ADDED Requirements

### Requirement: Commander Library Encapsulation
The `commander` npm package MUST be imported only by `src/infrastructure/cli-parser.ts`. No other file under `src/` MAY import from `commander`. The dependency MUST be listed under `dependencies` (not `devDependencies`) in `package.json` at version `^15.0.0` or compatible.

#### Scenario: Only one file imports commander
- **WHEN** `src/cli/index.ts` is read
- **THEN** it does not contain `import` or `require` of `commander`

- **WHEN** `src/cli/commands/*.ts` is read
- **THEN** none of those files contain `import` or `require` of `commander`

#### Scenario: Commander is a runtime dependency
- **WHEN** `package.json` is read
- **THEN** the `dependencies` object includes a key `"commander"` with value `"^15.0.0"` (or any compatible semver)
