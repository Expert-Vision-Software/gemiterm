## MODIFIED Requirements

### Requirement: ExportCommand

The system MUST provide an `export` command implemented by `ExportCommand` in `src/cli/commands/export-command.ts`. The command MUST accept a single positional `<conversation_id>` argument and MUST support `--out/-o <path>`, `--format/-f <markdown|json>` (default `markdown`), `--include-metadata`, and `--help/-h`. The command MUST fetch the conversation via the `gemini-queries` helpers (with `resolveProfile` for profile routing) and MUST delegate all formatting, filename construction, and writing to `context.exportStrategies.single` — the command MUST NOT call `formatChatAsMarkdown`, `formatChatAsJson`, or `writeTextFile` itself and MUST NOT construct export filenames itself. The strategy MUST write to the path supplied by `--out` or, when `--out` is not set, to a default file in the current working directory named `gemini-chat-<conversation_id>-<YYYY-MM-DD>.<ext>` (where `ext` is `md` for markdown and `json` for json), creating the output directory (and any parents) before writing. When `<conversation_id>` is missing or invalid, the command MUST print an error and exit with code 1. The command MUST NOT recognize `--output` as a flag. All user-visible output is byte-equivalent to the pre-change baseline.

#### Scenario: Export with --out writes to the supplied path
- **WHEN** the user runs `gemiterm export conv-abc123 --out ./out.md`
- **THEN** the file `./out.md` is created (its parent directory is created if missing) and contains the markdown export of the conversation

#### Scenario: Export with default path
- **WHEN** the user runs `gemiterm export conv-abc123` with no `--out`
- **THEN** a file named `gemini-chat-conv-abc123-<YYYY-MM-DD>.md` is created in the current working directory

#### Scenario: Export with --format json
- **WHEN** the user runs `gemiterm export conv-abc123 --format json`
- **THEN** the default output filename has a `.json` extension and the file content is the JSON export of the conversation

#### Scenario: Export with --include-metadata
- **WHEN** the user runs `gemiterm export conv-abc123 --include-metadata`
- **THEN** the markdown formatting is invoked with `includeMetadata=true` (inside the strategy) and the resulting file contains a metadata header

#### Scenario: Export with no id errors and exits 1
- **WHEN** the user runs `gemiterm export`
- **THEN** the output contains `Error: conversation ID is required.` and the process exits with code 1

#### Scenario: Export --help shows usage
- **WHEN** the user runs `gemiterm export --help`
- **THEN** the output contains `Usage: gemiterm export <conversation_id> [options]` and documents `--out`, `--format`, `--include-metadata`, and `--help`

#### Scenario: Export delegates through the strategy seam
- **WHEN** `ExportCommand.execute` runs
- **THEN** formatting, filename construction, and file writing are performed by `context.exportStrategies.single`, and the command file contains no `formatChatAsMarkdown` / `formatChatAsJson` / `writeTextFile` call and no `defaultFilename` method

### Requirement: ExportAllCommand

The system MUST provide an `export-all` command implemented by `ExportAllCommand` in `src/cli/commands/export-all-command.ts`. The command MUST support `--out-dir/-o <dir>` (default `./exports`), `--since <date>`, `--include-metadata`, `--all-profiles/-a`, and `--help/-h`. The command MUST obtain the chat list (propagating `allProfiles`), filter to chats whose `timestamp` is on or after the `--since` date when supplied, and MUST delegate the entire batch — iteration, per-chat fetch, markdown formatting, sanitized filenames of the form `gemini-chat-<sanitized-title>-<YYYY-MM-DD>.md`, directory creation, per-chat progress and error collection, `index.md` generation, and the final summary — to `context.exportStrategies.batch`. The command MUST NOT implement the batch loop, progress reporting, error collection, index generation, or filename sanitization itself. When the batch lists chats across profiles, a profile whose listing fails MUST log a warning and be skipped (warn-and-continue), matching the `export-strategy` capability's `Batch Listing Warns and Continues Per Profile` requirement. All printed output (`[i/N]` progress lines with `OK`/`FAILED`, `Exported:` / `Failed:` / `Output:` / `Index:` summary, `index.md` content, and the empty-list message) MUST be byte-equivalent to the pre-change baseline. When `--include-metadata` is set the index MUST include a `> Successful: <n> | Failed: <n>` line. The command MUST NOT recognize `--output-dir` as a flag.

#### Scenario: Export-all writes per-chat files and an index
- **WHEN** the user runs `gemiterm export-all --out-dir ./exports` against a client returning two chats
- **THEN** exactly two markdown files appear under `./exports` and `./exports/index.md` contains a `## Conversations` section linking to both filenames

#### Scenario: Export-all default output directory is ./exports
- **WHEN** the user runs `gemiterm export-all` with no `--out-dir`
- **THEN** the output directory is `./exports` (resolved against the current working directory)

#### Scenario: Export-all with --all-profiles lists across profiles
- **WHEN** the user runs `gemiterm export-all --all-profiles`
- **THEN** the chat list spans all configured profiles and one inaccessible profile is skipped with a warning while the rest are exported

#### Scenario: Export-all with --since filters by date
- **WHEN** the user runs `gemiterm export-all --since 2024-01-01`
- **THEN** chats with `timestamp < 2024-01-01` are excluded from the iteration and from the index

#### Scenario: Export-all reports failed exports
- **WHEN** the fetcher throws for one chat
- **THEN** the failing chat appears in `index.md` under a `## Failed Exports` section, the remaining chats still export, and the printed summary contains `Failed:  1` (two spaces before the count, matching the pre-change format)

#### Scenario: Export-all shows progress lines
- **WHEN** the user runs `gemiterm export-all` against a client returning N chats
- **THEN** exactly N progress lines of the form `[i/N]` are written to stdout, each followed by `OK` or `FAILED`

#### Scenario: Export-all with no conversations prints the empty message
- **WHEN** the chat list is empty
- **THEN** the output contains `No conversations found to export.` and no `index.md` is written

#### Scenario: Export-all --include-metadata adds success/failure counts to the index
- **WHEN** the user runs `gemiterm export-all --include-metadata`
- **THEN** `index.md` contains a line `> Successful: <n> | Failed: <n>`

#### Scenario: Export-all --help shows usage
- **WHEN** the user runs `gemiterm export-all --help`
- **THEN** the output contains `Usage: gemiterm export-all [options]` and documents `--out-dir`, `--since`, `--include-metadata`, `--all-profiles`, and `--help`

#### Scenario: Export-all delegates through the strategy seam
- **WHEN** `ExportAllCommand.execute` runs
- **THEN** the batch loop, progress reporting, error collection, index generation, and filename sanitization are performed by `context.exportStrategies.batch`, and the command file contains no `sanitizeFilename`, `writeIndex`, or inline batch iteration

### Requirement: CommandRegistry

The system MUST provide a `CommandRegistry` class in `src/cli/command-registry.ts` that stores `CliCommand` instances keyed by command name. The `register(name, handler)` method MUST throw `Command already registered: <name>` when the same name is registered twice. The `getHandler(name)` method MUST return the handler for the name or `undefined` if not present. The `has(name)` method MUST return a boolean. The `getRegisteredNames()` method MUST return an array of all registered names. The `registerAllCommands()` method MUST register all commands by name. The `CliCommandContext` interface MUST carry `{ verbose: boolean, profileAuthManager: ProfileAuthManager, profileLifecycle: ProfileLifecycle, exportStrategies: { single: ExportStrategy; batch: ExportStrategy }, getGeminiClient: () => GeminiClientService, listProfiles: () => string[] }` (no `mediator` field). The `CliCommand` interface MUST require `name: string`, `description: string`, and `execute(args, context): Promise<void>`.

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
- **THEN** it exposes `verbose`, `profileAuthManager`, `profileLifecycle`, `exportStrategies`, `getGeminiClient`, and `listProfiles`, and does NOT expose a `mediator` field
