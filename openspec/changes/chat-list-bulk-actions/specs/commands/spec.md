## MODIFIED Requirements

### Requirement: DeleteCommand

The system MUST provide a `delete` command implemented by `DeleteCommand` in `src/cli/commands/delete-command.ts`. The command MUST accept one or more positional `<conversation_id>` arguments, each of which MAY be a single id or a comma-separated list of ids (e.g. `id1,id2,id3`); the command MUST split comma-separated tokens into individual ids. The command MUST deduplicate ids after splitting. The command MUST support `--force/-f` and `--help/-h`. When no ids are provided, the command MUST print `Error: at least one conversation ID is required.` and exit with code 1. When ids are provided, the command MUST validate each id via `validateConversationId`; the first invalid id MUST cause the command to print an error and exit with code 1. When `--force` is not set, the command MUST prompt the user once with `Delete N conversations?` via the prompts-facade `confirm` helper, after printing a numbered list of `• <id> — "<title>"` (one per id); on confirmation it MUST iterate over the ids and, for each id, look up the owning profile via `ProfileAuthManager.findProfileForConversation(conversationId)` and send a `DeleteConversationCommand` to the mediator with payload `{ conversationId, profileName? }`; when the lookup returns a profile name, `profileName` MUST be set on the payload so the handler routes to that profile's `GeminiClientService`. When no profile owns the conversation, the id MUST be skipped with a warning `Skipped '<id>': no owning profile found. Use 'gemiterm list --all-profiles' to see which profile it belongs to.` printed in red to stderr, and the loop MUST continue. The command MUST print `Conversation '<id>' deleted.` for each successful id. The command MUST print `Failed to delete conversation '<id>': <message>` in red for each id whose mediator call fails or returns `{ success: false }`. After the iteration, when any id failed, the process MUST exit with code 1; otherwise the process MUST exit with code 0. In a single-profile setup the behavior MUST be unchanged: the default profile is used without a per-id lookup.

#### Scenario: Delete with a single id sends a DeleteConversationCommand

- **WHEN** the user runs `gemiterm delete conv-abc123 --force`
- **THEN** the command resolves to a single-element list `[conv-abc123]`
- **AND** the mediator receives a `DeleteConversationCommand` with `payload.conversationId === "conv-abc123"`
- **AND** no readline prompt is shown
- **AND** on `result.success === true` the output contains `deleted.`

#### Scenario: Delete with comma-separated ids prompts once and sends N DeleteConversationCommands

- **WHEN** the user runs `gemiterm delete id1,id2,id3` and answers `yes` to the prompt
- **THEN** the command prints a numbered list of three `• <id> — "<title>"` lines before the prompt
- **AND** a single `Delete N conversations?` confirm is shown (one prompt for the batch)
- **AND** three `DeleteConversationCommand`s are sent in order, one per id

#### Scenario: Delete with comma-separated ids and --force skips the prompt

- **WHEN** the user runs `gemiterm delete id1,id2,id3 --force`
- **THEN** no prompt is shown
- **AND** the iteration proceeds and three `DeleteConversationCommand`s are sent

#### Scenario: Delete without --force and no confirmation aborts the batch

- **WHEN** the user runs `gemiterm delete id1,id2,id3` and answers `no` to the prompt
- **THEN** no `DeleteConversationCommand` is sent and the output contains `Cancelled.`

#### Scenario: Delete with whitespace around comma-separated ids trims and splits

- **WHEN** the user runs `gemiterm delete "id1, id2 , id3" --force`
- **THEN** the three ids are parsed as `id1`, `id2`, `id3` (whitespace trimmed)
- **AND** three `DeleteConversationCommand`s are sent

#### Scenario: Delete with no ids errors and exits 1

- **WHEN** the user runs `gemiterm delete`
- **THEN** the output contains `Error: at least one conversation ID is required.` and the process exits with code 1

#### Scenario: Delete with invalid id errors and exits 1

- **WHEN** the user runs `gemiterm delete valid-id,BAD/ID --force` and `validateConversationId` rejects `BAD/ID`
- **THEN** the output contains the validator's error message
- **AND** the process exits with code 1
- **AND** no `DeleteConversationCommand` is sent for `valid-id`

#### Scenario: Delete with one failed id exits 1 but reports the success

- **WHEN** the user runs `gemiterm delete id1,id2 --force` and the mediator returns `{ success: false }` for `id1` and `{ success: true }` for `id2`
- **THEN** the output contains `Failed to delete conversation 'id1'` and `Conversation 'id2' deleted.`
- **AND** the process exits with code 1

#### Scenario: Delete with one skipped id (no owning profile) continues with the rest

- **WHEN** the user runs `gemiterm delete id1,id2 --force` and `findProfileForConversation("id1")` returns `null`
- **THEN** the output contains `Skipped 'id1': no owning profile found.`
- **AND** a `DeleteConversationCommand` is still sent for `id2`

#### Scenario: Delete with -f short flag

- **WHEN** the user runs `gemiterm delete id1,id2,id3 -f`
- **THEN** the command is equivalent to `--force` (no prompt, mediator calls proceed)

#### Scenario: Delete --help shows usage

- **WHEN** the user runs `gemiterm delete --help`
- **THEN** the output contains `Usage: gemiterm delete <conversation_id> [options]` and documents `--force` and `--help`

### Requirement: ExportCommand

The system MUST provide an `export` command implemented by `ExportCommand` in `src/cli/commands/export-command.ts`. The command MUST accept one or more positional `<conversation_id>` arguments, each of which MAY be a single id or a comma-separated list of ids (e.g. `id1,id2,id3`); the command MUST split comma-separated tokens into individual ids. The command MUST deduplicate ids after splitting. The command MUST support `--out/-o <path>`, `--out-dir/-d <dir>`, `--format/-f <markdown|json>` (default `markdown`), `--include-metadata`, and `--help/-h`. When no ids are provided, the command MUST print `Error: at least one conversation ID is required.` and exit with code 1. The command MUST reject combining `--out` with more than one id by printing `Error: cannot use --out together with comma-separated ids. Specify --out-dir instead.` and exiting with code 1. When `--out-dir` is supplied, the command MUST create the directory (and any parents) via `infrastructure/io.ts:ensureDir`. The command MUST iterate the ids in order and, for each id, send a `FetchChatQuery` to the mediator with `payload.conversationId` and write the formatted output to `<out-dir>/gemini-chat-<id>-<YYYY-MM-DD>.<ext>` (where `ext` is `md` for markdown and `json` for json) when `--out-dir` is set, or to `<cwd>/gemini-chat-<id>-<YYYY-MM-DD>.<ext>` when `--out-dir` is not set. The legacy single-id `--out` flow MUST be preserved: when exactly one id is provided and `--out` is supplied, the command writes to that path (and not to the default filename). The command MUST reject combining `--out` with more than one id by printing `Error: cannot use --out together with comma-separated ids. Specify --out-dir instead.` and exiting with code 1. Markdown output MUST be produced by `formatChatAsMarkdown` and JSON output MUST be produced by `formatChatAsJson`. The command MUST print `Exported conversation '<id>' to: <path>` for each success. On any per-id failure, the command MUST print `Failed to export conversation '<id>': <message>` in red and continue with the next id. After the iteration, the command MUST print a summary line `Exported: <n>` (and `Failed: <m>` when m > 0) and `Output: <dir>`. When the mediator's `FetchChatQuery` handler throws for one of the ids, the failing id is counted as a failure and the summary line includes `Failed: <m>`. When all ids fail, the process MUST exit with code 1; when all succeed, the process MUST exit with code 0.

#### Scenario: Export with a single id writes the default-named file in CWD

- **WHEN** the user runs `gemiterm export conv-abc123`
- **THEN** the command resolves to a single-element list `[conv-abc123]`
- **AND** a file named `gemini-chat-conv-abc123-<YYYY-MM-DD>.md` is created in the current working directory

#### Scenario: Export with comma-separated ids writes N files in CWD

- **WHEN** the user runs `gemiterm export id1,id2,id3`
- **THEN** three files `gemini-chat-id1-<YYYY-MM-DD>.md`, `gemini-chat-id2-<YYYY-MM-DD>.md`, `gemini-chat-id3-<YYYY-MM-DD>.md` are created in the current working directory
- **AND** the output contains three `Exported conversation '<id>' to: <path>` lines
- **AND** the summary line `Exported: 3` is printed at the end

#### Scenario: Export with --out-dir writes N files under the supplied directory

- **WHEN** the user runs `gemiterm export id1,id2,id3 --out-dir ./exports`
- **THEN** the directory `./exports` is created (along with any parents)
- **AND** three files are written under `./exports` with the default filename pattern
- **AND** the summary line `Output: ./exports` is printed

#### Scenario: Export rejects --out together with multiple ids

- **WHEN** the user runs `gemiterm export id1,id2,id3 --out ./out.md`
- **THEN** the output contains `Error: cannot use --out together with comma-separated ids. Specify --out-dir instead.`
- **AND** the process exits with code 1
- **AND** no files are written

#### Scenario: Export with --format json uses the json extension

- **WHEN** the user runs `gemiterm export id1,id2 --format json --out-dir ./exports`
- **THEN** the written files have a `.json` extension and the content is the JSON export of each conversation

#### Scenario: Export with --include-metadata

- **WHEN** the user runs `gemiterm export id1,id2,id3 --include-metadata`
- **THEN** `formatChatAsMarkdown` is called with `includeMetadata=true` for each id and the resulting files contain a metadata header

#### Scenario: Export with no ids errors and exits 1

- **WHEN** the user runs `gemiterm export`
- **THEN** the output contains `Error: at least one conversation ID is required.` and the process exits with code 1

#### Scenario: Export with one failed id continues with the rest and reports a summary

- **WHEN** the user runs `gemiterm export id1,id2` and the mediator's `FetchChatQuery` handler throws for `id1` but resolves for `id2`
- **THEN** the output contains `Failed to export conversation 'id1': <message>` in red
- **AND** the output contains `Exported conversation 'id2' to: <path>`
- **AND** the summary line `Exported: 1` and `Failed:  1` is printed
- **AND** the process exits with code 1

#### Scenario: Export --help shows usage

- **WHEN** the user runs `gemiterm export --help`
- **THEN** the output contains `Usage: gemiterm export <conversation_id> [options]` and documents `--out`, `--out-dir`, `--format`, `--include-metadata`, and `--help`

### Requirement: CommandRegistry

The system MUST provide a `CommandRegistry` class in `src/cli/command-registry.ts` that stores `CliCommand` instances keyed by command name. The `register(name, handler)` method MUST throw `Command already registered: <name>` when the same name is registered twice. The `getHandler(name)` method MUST return the handler for the name or `undefined` if not present. The `has(name)` method MUST return a boolean. The `getRegisteredNames()` method MUST return an array of all registered names. The `registerAllCommands()` method MUST register all 12 commands by name: `auth`, `profile`, `status`, `list`, `fetch`, `continue`, `new`, `delete`, `export`, `export-all`, `install-browser`, and `summarize`. The `CliCommandContext` interface MUST carry `{ verbose: boolean, mediator: Mediator, profileAuthManager: ProfileAuthManager }`. The `CliCommand` interface MUST require `name: string`, `description: string`, and `execute(args, context): Promise<void>`.

#### Scenario: Registering the same name twice throws

- **WHEN** `register("dup", handlerA)` is called and then `register("dup", handlerB)`
- **THEN** the second call throws `Command already registered: dup`

#### Scenario: getHandler returns the registered handler

- **WHEN** `register("list", handler)` is called
- **THEN** `getHandler("list")` returns the same handler instance

#### Scenario: getHandler returns undefined for unknown names

- **WHEN** no handler is registered for `nope`
- **THEN** `getHandler("nope")` returns `undefined` and `has("nope")` returns `false`

#### Scenario: registerAllCommands registers all 12 commands

- **WHEN** `registerAllCommands()` is called
- **THEN** `getRegisteredNames()` returns an array that includes `auth`, `profile`, `status`, `list`, `fetch`, `continue`, `new`, `delete`, `export`, `export-all`, `install-browser`, and `summarize` (12 entries total)

## ADDED Requirements

### Requirement: SummarizeCommand

The system MUST provide a `summarize` command implemented by `SummarizeCommand` in `src/cli/commands/summarize-command.ts`. The command MUST be registered under the name `summarize`. The command MUST accept one or more positional `<conversation_id>` arguments, each of which MAY be a single id or a comma-separated list of ids; the command MUST split comma-separated tokens into individual ids. The command MUST support `--out/-o <path>` and `--help/-h`. When no ids are provided, the command MUST print `Error: at least one conversation ID is required.` and exit with code 1. When ids are provided, the command MUST send a `ListChatsQuery` to the mediator to obtain the chat metadata for the summary header (the per-id content is fetched via a `FetchChatQuery` per id). For each id whose `FetchChatQuery` fails, the command MUST log a warning `Skipped '<id>': <message>` to stderr and continue with the rest. The command MUST call `summarizeChatsLocally` from `src/services/local-summarizer.ts` to compute the summary structure, MUST call `formatBulkSummary` to render markdown, and MUST write the rendered content via `infrastructure/io.ts:writeTextFile` to the path supplied by `--out` or, when `--out` is not set, to a default file in the current working directory named `gemiterm-bulk-summary-<YYYY-MM-DD-HHMMSS>.md`. The command MUST print `Bulk summary written to: <path>`. When `process.stdin.isTTY === true`, the command MUST additionally call the prompts-facade `confirm` helper with message `Open a new chat with this file as context?`; on a yes answer, the command MUST look up the active profile via `ProfileAuthManager.getActiveProfiles()` (or the single default profile), MUST invoke `CommandRegistry.getHandler("new")` with argv `["--prompt-file", outputPath, "--profile", profileName]` (omitting `--profile` when no active profile is resolvable), and MUST return after the new command completes. When `process.stdin.isTTY` is not `true`, the command MUST skip the prompt and MUST NOT spawn the new command. The command MUST NOT call Gemini or any other LLM; the summary is computed entirely from the local chat content via the `local-summarizer` service.

#### Scenario: Summarize with comma-separated ids writes the summary file

- **WHEN** the user runs `gemiterm summarize id1,id2,id3`
- **THEN** the output contains `Bulk summary written to: gemini-bulk-summary-<timestamp>.md`
- **AND** the file exists in the current working directory and contains a `# Bulk summary — 3 conversations` heading

#### Scenario: Summarize with --out writes to the supplied path

- **WHEN** the user runs `gemiterm summarize id1,id2 --out ./out.md`
- **THEN** the file `./out.md` is created and contains the bulk summary

#### Scenario: Summarize with no ids errors and exits 1

- **WHEN** the user runs `gemiterm summarize`
- **THEN** the output contains `Error: at least one conversation ID is required.` and the process exits with code 1

#### Scenario: Summarize with one failed FetchChatQuery continues with the rest

- **WHEN** the user runs `gemiterm summarize id1,id2,id3` and the mediator's `FetchChatQuery` handler throws for `id2`
- **THEN** the output contains `Skipped 'id2': <message>` in red
- **AND** the summary file is written and contains per-note extracts for `id1` and `id3`

#### Scenario: Summarize with a single id writes a valid summary

- **WHEN** the user runs `gemiterm summarize id1`
- **THEN** the summary file is written
- **AND** it contains a `### <title> ('id1', <date>)` per-note block
- **AND** the cross-references section contains a `### No related notes` group listing `id1`

#### Scenario: Summarize post-action prompt on a TTY offers to launch new

- **WHEN** the user runs `gemiterm summarize id1,id2` on a TTY and answers `yes` to the post-action prompt
- **THEN** `CommandRegistry.getHandler("new")` is invoked with argv containing `--prompt-file` and the path to the summary file
- **AND** `--profile` is included in the argv when an active profile is resolvable

#### Scenario: Summarize post-action prompt is skipped on a non-TTY

- **WHEN** the user runs `gemiterm summarize id1,id2` and `process.stdin.isTTY` is not `true`
- **THEN** the summary file is written
- **AND** no confirm prompt is shown
- **AND** no `new` command is invoked

#### Scenario: Summarize does not call any LLM

- **WHEN** the user runs `gemiterm summarize id1,id2,id3`
- **THEN** the only mediator calls are one `ListChatsQuery` and N `FetchChatQuery` calls
- **AND** no `StartNewChatCommand` and no `SendMessageCommand` is sent during the summarize execution (the `StartNewChatCommand` may be sent later by the spawned `new` command, but not by `summarize` itself)

#### Scenario: Summarize --help shows usage

- **WHEN** the user runs `gemiterm summarize --help`
- **THEN** the output contains `Usage: gemiterm summarize <conversation_id> [options]` and documents `--out` and `--help`
