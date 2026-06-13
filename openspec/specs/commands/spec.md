## Purpose

The CLI command layer of the `gemiterm` application. It defines the 11 top-level user-facing commands (auth, profile, status, list, fetch, continue, new, delete, export, export-all, install-browser), each implemented as a `CliCommand` class registered by the `CommandRegistry`. The command layer is responsible for argument parsing, mediator dispatch (queries `ListChatsQuery` / `FetchChatQuery` and commands `SendMessageCommand` / `StartNewChatCommand` / `DeleteConversationCommand`), interactive REPL I/O for `new` and `continue`, and human-readable / JSON output formatting. This spec documents the as-built behavior of the command layer; any future conformance fixes are tracked separately in the `command-spec-conformance` change.

## Requirements

### Requirement: ListCommand

The system MUST provide a `list` command implemented by `ListCommand` in `src/cli/commands/list-command.ts`. The command MUST be registered under the name `list` and MUST send a `ListChatsQuery` to the mediator with a payload of shape `{ limit?, offset?, search?, allProfiles }`. The command MUST support the flags `--limit/-n <N>` (no default; omitting `--limit` returns every conversation returned by the mediator), `--offset <N>` (default 0), `--all-profiles`, `--sort <recent|oldest|alpha>` (default `recent`), `--search/-s <query>`, `--after <date>`, `--before <date>`, `--format/-f <text|json>` (default `text`), and `--out/-o <path>`. When `--limit N` is supplied, the command MUST additionally slice the result set to `[offset, offset + N)`. When `--limit` is omitted, the command MUST NOT slice; the entire mediator result is rendered. When `--limit` is omitted and `--offset N` is supplied with `N > 0`, the command MUST slice the result set to `[N, ∞)`. The `--all-profiles` flag MUST be propagated into the mediator payload as `allProfiles: true`. The `list` command MUST NOT support a `--all` flag (omitting `--limit` is the canonical way to request every conversation). When `--out <path>` is supplied, the rendered output MUST be written to that file via `infrastructure/io.ts:writeTextFile` and the command MUST print `Output written to: <path>`; otherwise the output MUST be printed to stdout. The command MUST NOT recognize `--path` or `-p` as output flags.

#### Scenario: List with no flags returns all conversations
- **WHEN** the user runs `gemiterm list`
- **THEN** the command sends a `ListChatsQuery` to the mediator with `limit: undefined`, `offset: 0`, no `search`, and `allProfiles: false`, and renders every chat returned by the mediator as a 4-column text table (ID / TITLE / DATE / PIN)

#### Scenario: List with --limit
- **WHEN** the user runs `gemiterm list --limit 5`
- **THEN** the mediator payload carries `limit: 5` and at most 5 chats are displayed

#### Scenario: List with --offset and no --limit skips the first N chats
- **WHEN** the user runs `gemiterm list --offset 20`
- **THEN** the mediator payload carries `limit: undefined` and `offset: 20`, and the first 20 chats are skipped before display

#### Scenario: List with --all-profiles propagates to mediator
- **WHEN** the user runs `gemiterm list --all-profiles`
- **THEN** the mediator payload carries `allProfiles: true`

#### Scenario: List with --sort alpha sorts ascending by title
- **WHEN** the user runs `gemiterm list --sort alpha`
- **THEN** the displayed chats are sorted by `title` ascending using `localeCompare`

#### Scenario: List with --search forwards the search term
- **WHEN** the user runs `gemiterm list --search "Bun"`
- **THEN** the mediator payload carries `search: "Bun"`

#### Scenario: List with --format json
- **WHEN** the user runs `gemiterm list --format json`
- **THEN** the output is a JSON document with shape `{ chats: ChatInfo[] }` and nothing else is written to stdout

#### Scenario: List with --out writes the rendered output to the given file
- **WHEN** the user runs `gemiterm list --out ./out.txt`
- **THEN** the rendered text or JSON content is written to `./out.txt` and a confirmation line `Output written to: <resolved>` is printed

#### Scenario: List with --after and --before filters chats by date
- **WHEN** the user runs `gemiterm list --after 2024-01-01 --before 2024-12-31`
- **THEN** chats with `timestamp` outside the inclusive range are removed before display

#### Scenario: List with no conversations prints the empty message
- **WHEN** the mediator returns an empty `chats` array
- **THEN** the output contains the message `No conversations found.`

#### Scenario: List --help shows usage
- **WHEN** the user runs `gemiterm list --help`
- **THEN** the output contains `Usage: gemiterm list` and documents every flag above, and does NOT document a `--all` flag

#### Scenario: List rejects the removed --all flag
- **WHEN** the user runs `gemiterm list --all`
- **THEN** the command leaves the `--all` token in `subcommandArgs` and either ignores it (if argv parsing is tolerant) or rejects it; in either case the output is the same as `gemiterm list` with no flags (every conversation rendered)

### Requirement: ListCommand Text Output Table

The `list` command's default text output MUST be a 4-column table with headers `ID`, `TITLE`, `DATE`, `PIN` (in that order). The table MUST be produced by `formatChatList` in `src/infrastructure/formatters.ts`. When `--all-profiles` is set, the command MUST call `formatChatList(chats, { includeProfileColumn: true })` and the rendered text output MUST include a `PROFILE` column as the 5th column.

#### Scenario: Default text output has 4 columns
- **WHEN** the user runs `gemiterm list` (no flags)
- **THEN** the rendered table contains header columns `ID`, `TITLE`, `DATE`, and `PIN` only

#### Scenario: --all-profiles adds a Profile column to text output
- **WHEN** the user runs `gemiterm list --all-profiles`
- **THEN** the rendered text output table contains 5 columns `ID`, `TITLE`, `DATE`, `PIN`, `PROFILE` and each row shows the owning profile name

### Requirement: ListCommand --interactive flag

The `ListCommand` MUST accept an `--interactive/-i` flag. The flag MUST be additive: the existing flag set and the existing default behaviour MUST be preserved. The flag MUST enter the chat-list browser (see the `chat-list-browser` capability) instead of the text-table or JSON output.

#### Scenario: --interactive enters the TUI
- **WHEN** the user runs `gemiterm list --interactive` on a TTY
- **THEN** the command enters the chat-list browser
- **AND** no text table or JSON is written to stdout

#### Scenario: --interactive short flag is equivalent
- **WHEN** the user runs `gemiterm list -i`
- **THEN** the command behaves identically to `gemiterm list --interactive`

### Requirement: ListCommand --interactive conflict detection

The `ListCommand` MUST reject combinations of `--interactive` with `--format` or `--out`. The rejection MUST print `Cannot use --interactive with --format or --out.` to stderr and exit with code 1.

#### Scenario: --interactive with --format errors
- **WHEN** the user runs `gemiterm list -i --format json`
- **THEN** the command prints `Cannot use --interactive with --format or --out.` to stderr
- **AND** the process exits with code 1

#### Scenario: --interactive with --out errors
- **WHEN** the user runs `gemiterm list -i --out out.txt`
- **THEN** the command prints `Cannot use --interactive with --format or --out.` to stderr
- **AND** the process exits with code 1

### Requirement: ListCommand --interactive TTY requirement

The `ListCommand` MUST invoke the chat-list browser only when `process.stdin.isTTY === true`. When the flag is set but stdin is not a TTY, the command MUST print a `NonInteractiveError`-derived message containing `gemiterm list -i requires a TTY` and the hint `use --format json for machine-readable output`, and exit with code 1.

#### Scenario: --interactive on a non-TTY errors
- **WHEN** the user runs `gemiterm list -i` and `process.stdin.isTTY` is not `true`
- **THEN** the command prints a message containing `gemiterm list -i requires a TTY` and the hint about `--format json`
- **AND** the process exits with code 1

### Requirement: ListCommand non-interactive byte-equivalence contract

The `ListCommand`'s non-interactive output paths MUST remain byte-equivalent to the pre-change baseline. Specifically:
- `gemiterm list` (no flags) MUST emit the same 4-column text table (`ID` / `TITLE` / `DATE` / `PIN`).
- `gemiterm list --format json` MUST emit the same `{ chats: ChatInfo[] }` JSON document.
- `gemiterm list --search <q>` MUST forward the search term to the mediator.
- `gemiterm list --sort <mode>` MUST apply the sort.
- `gemiterm list --limit <N>` / `--offset <N>` MUST apply the limit/offset (the deprecated `--all` flag is no longer recognised — omit `--limit` to get every conversation).
- `gemiterm list --all-profiles` MUST add the `PROFILE` column.
- `gemiterm list --after <date>` / `--before <date>` MUST apply the date filter.
- `gemiterm list --out <p>` MUST write the rendered output to the path and print a confirmation line.

#### Scenario: Default list is the 4-column text table
- **WHEN** the user runs `gemiterm list` (no flags)
- **THEN** the output is the same 4-column text table that the pre-change `list` command emitted

#### Scenario: --format json is the same JSON document
- **WHEN** the user runs `gemiterm list --format json`
- **THEN** the output is the same `{ chats: ChatInfo[] }` JSON document that the pre-change `list` command emitted

#### Scenario: --help documents --interactive
- **WHEN** the user runs `gemiterm list --help`
- **THEN** the output contains a `--interactive, -i` flag description in the existing flag list

### Requirement: FetchCommand

The system MUST provide a `fetch` command implemented by `FetchCommand` in `src/cli/commands/fetch-command.ts`. The command MUST accept a single optional positional `<conversation_id>` argument and MUST support `--format/-f <text|json>` (default `text`) and `--out/-o <path>`. When a conversation id is provided, the command MUST send a `FetchChatQuery` to the mediator with payload `{ conversationId }`. When no conversation id is provided, the command MUST invoke the `list` command via the `CommandRegistry` and return without sending a fetch query. Text output MUST include a header line `Conversation: <id>` and label each message with `User:` or `Model:` depending on role. JSON output MUST be `{ conversationId, messages }`. When `--out <path>` is supplied, the rendered output MUST be written to that file via `infrastructure/io.ts:writeTextFile` and the command MUST print `Output written to: <path>`; otherwise the output MUST be printed to stdout. The command MUST NOT recognize `--path` or `-p` as output flags.

#### Scenario: Fetch with conversation id sends a FetchChatQuery
- **WHEN** the user runs `gemiterm fetch conv-abc123`
- **THEN** the mediator receives a `FetchChatQuery` with `payload.conversationId === "conv-abc123"`

#### Scenario: Fetch with no id invokes list
- **WHEN** the user runs `gemiterm fetch` with no positional argument
- **THEN** no `FetchChatQuery` is sent and the `list` command is executed against the same context (after printing a "No conversation ID specified" notice)

#### Scenario: Fetch with --format json
- **WHEN** the user runs `gemiterm fetch conv-abc123 --format json`
- **THEN** the output is a JSON document with shape `{ conversationId: "conv-abc123", messages: Message[] }`

#### Scenario: Fetch with --out writes the rendered output to the given file
- **WHEN** the user runs `gemiterm fetch conv-abc123 --out ./out.txt`
- **THEN** the rendered text or JSON content is written to `./out.txt` and a confirmation line `Output written to: <resolved>` is printed

#### Scenario: Fetch with empty messages prints "No messages found"
- **WHEN** the mediator returns `messages: []`
- **THEN** the rendered text output contains `No messages found.`

#### Scenario: Fetch --help shows usage
- **WHEN** the user runs `gemiterm fetch --help`
- **THEN** the output contains `Usage: gemiterm fetch [conversation_id] [options]` and documents `--format`, `--out`, and `--help`

### Requirement: ContinueCommand

The system MUST provide a `continue` command implemented by `ContinueCommand` in `src/cli/commands/continue-command.ts`. The command MUST accept an optional positional `<conversation_id>` and an optional positional `<message>`, plus `--help/-h`. When `<conversation_id>` is missing, the command MUST invoke the `list` command via the `CommandRegistry` and return. When both `<conversation_id>` and `<message>` are present, the command MUST look up the owning profile via `ProfileAuthManager.findProfileForConversation(conversationId)` and send a `SendMessageCommand` to the mediator with payload `{ conversationId, message, profileName? }`; when the lookup returns a profile name, `profileName` MUST be set on the payload so the handler routes to that profile's `GeminiClientService`. When no profile owns the conversation, the command MUST throw `AuthenticationError` with a remediation message and exit non-zero. When `<conversation_id>` is present and `<message>` is absent, the command MUST start an interactive REPL that reads lines from stdin and sends each non-empty line as a `SendMessageCommand` using the same profile-lookup logic; the REPL MUST exit on `/exit` or `/quit` and MUST ignore empty lines. In a single-profile setup the behavior MUST be unchanged: the default profile is used without a lookup.

#### Scenario: Continue with id and message sends a SendMessageCommand
- **WHEN** the user runs `gemiterm continue conv-abc123 "Hello there"`
- **THEN** the mediator receives a `SendMessageCommand` with `payload.conversationId === "conv-abc123"` and `payload.message === "Hello there"`, and the response text is printed after a `Model:` label

#### Scenario: Continue with no id invokes list
- **WHEN** the user runs `gemiterm continue` with no positional argument
- **THEN** the `list` command is executed and no `SendMessageCommand` is sent

#### Scenario: Continue with id but no message starts an interactive REPL
- **WHEN** the user runs `gemiterm continue conv-abc123` and types a line into stdin
- **THEN** a `SendMessageCommand` is sent for that line and the model response is printed after a `Model:` label

#### Scenario: Continue REPL exits on /exit
- **WHEN** the user types `/exit` or `/quit` in the continue REPL
- **THEN** the readline interface closes and the command returns

#### Scenario: Continue REPL ignores empty lines
- **WHEN** the user enters a blank line in the continue REPL
- **THEN** no `SendMessageCommand` is sent and the REPL continues prompting

#### Scenario: Continue --help shows usage
- **WHEN** the user runs `gemiterm continue --help`
- **THEN** the output contains `Usage: gemiterm continue [conversation_id] [message] [options]` and documents `/exit`, `/quit`, and `--help`

### Requirement: NewCommand

The system MUST provide a `new` command implemented by `NewCommand` in `src/cli/commands/new-command.ts`. The command MUST accept an optional positional `<message>` and MUST support `--profile/-p <name>` and `--help/-h`. When `<message>` is present, the command MUST send a `StartNewChatCommand` to the mediator with payload `{ message, profileName? }` and print the new conversation id and the model response. When `<message>` is absent, the command MUST start an interactive REPL that starts a new chat on the first non-empty line and continues with `SendMessageCommand` against the resulting `conversationId` for subsequent lines; the REPL MUST exit on `/exit` or `/quit`.

#### Scenario: New with message sends StartNewChatCommand and prints the conversation id
- **WHEN** the user runs `gemiterm new "Hello Gemini"`
- **THEN** the mediator receives a `StartNewChatCommand` with `payload.message === "Hello Gemini"`, the output contains `Conversation ID: <id>`, and the model response is printed after a `Model:` label

#### Scenario: New with --profile includes profileName in the payload
- **WHEN** the user runs `gemiterm new "Hi" --profile work`
- **THEN** the mediator payload carries `profileName: "work"`

#### Scenario: New with no message starts an interactive REPL
- **WHEN** the user runs `gemiterm new` with no message
- **THEN** the command enters a REPL; the first non-empty line is sent as a `StartNewChatCommand` and subsequent lines are sent as `SendMessageCommand` against the resulting conversation id

#### Scenario: New REPL exits on /exit or /quit
- **WHEN** the user types `/exit` or `/quit` in the new-command REPL
- **THEN** the readline interface closes and the command returns

#### Scenario: New --help shows usage
- **WHEN** the user runs `gemiterm new --help`
- **THEN** the output contains `Usage: gemiterm new [message] [options]` and documents `--profile`, `--help`, and the `/exit` / `/quit` REPL commands

### Requirement: DeleteCommand

The system MUST provide a `delete` command implemented by `DeleteCommand` in `src/cli/commands/delete-command.ts`. The command MUST accept a single positional `<conversation_id>` argument and MUST support `--force/-f` and `--help/-h`. When `<conversation_id>` is missing, the command MUST print `Error: conversation ID is required.` and exit with code 1. When `<conversation_id>` is present, the command MUST validate the id via `validateConversationId`. When `--force` is not set, the command MUST prompt the user with `Delete conversation '<id>'? (yes/no):` via readline and MUST treat any answer starting with `y` (case-insensitive) as confirmation; on confirmation it MUST look up the owning profile via `ProfileAuthManager.findProfileForConversation(conversationId)` and send a `DeleteConversationCommand` to the mediator with payload `{ conversationId, profileName? }`; when the lookup returns a profile name, `profileName` MUST be set on the payload so the handler routes to that profile's `GeminiClientService`. When no profile owns the conversation, the command MUST throw `AuthenticationError` with a remediation message and exit non-zero. The command MUST print `Conversation '<id>' deleted.` on success and MUST exit with code 1 on a failed result or handler error. In a single-profile setup the behavior MUST be unchanged: the default profile is used without a lookup.

#### Scenario: Delete with --force sends DeleteConversationCommand
- **WHEN** the user runs `gemiterm delete conv-abc123 --force`
- **THEN** the mediator receives a `DeleteConversationCommand` with `payload.conversationId === "conv-abc123"`, no readline prompt is shown, and on `result.success === true` the output contains `deleted.`

#### Scenario: Delete without --force prompts for confirmation
- **WHEN** the user runs `gemiterm delete conv-abc123` and answers `yes` to the prompt
- **THEN** the mediator receives a `DeleteConversationCommand` with `payload.conversationId === "conv-abc123"`

#### Scenario: Delete without --force and no confirmation aborts
- **WHEN** the user runs `gemiterm delete conv-abc123` and answers `no` to the prompt
- **THEN** no `DeleteConversationCommand` is sent and the output contains `Cancelled.`

#### Scenario: Delete with no id errors and exits 1
- **WHEN** the user runs `gemiterm delete`
- **THEN** the output contains `Error: conversation ID is required.` and the process exits with code 1

#### Scenario: Delete with -f short flag
- **WHEN** the user runs `gemiterm delete conv-abc123 -f`
- **THEN** the command is equivalent to `--force` (no prompt, mediator call proceeds)

#### Scenario: Delete with failed result exits 1
- **WHEN** the mediator handler returns `{ success: false }`
- **THEN** the output contains `Failed to delete conversation.` and the process exits with code 1

#### Scenario: Delete --help shows usage
- **WHEN** the user runs `gemiterm delete --help`
- **THEN** the output contains `Usage: gemiterm delete <conversation_id> [options]` and documents `--force` and `--help`

### Requirement: ExportCommand

The system MUST provide an `export` command implemented by `ExportCommand` in `src/cli/commands/export-command.ts`. The command MUST accept a single positional `<conversation_id>` argument and MUST support `--out/-o <path>`, `--format/-f <markdown|json>` (default `markdown`), `--include-metadata`, and `--help/-h`. The command MUST send a `FetchChatQuery` to the mediator with `payload.conversationId` and MUST write the formatted output to the path supplied by `--out` or, when `--out` is not set, to a default file in the current working directory named `gemini-chat-<conversation_id>-<YYYY-MM-DD>.<ext>` (where `ext` is `md` for markdown and `json` for json). The command MUST create the output directory (and any parents) with `mkdirSync(..., { recursive: true })` before writing. Markdown output MUST be produced by `formatChatAsMarkdown` and JSON output MUST be produced by `formatChatAsJson`. When `<conversation_id>` is missing or invalid, the command MUST print an error and exit with code 1. The command MUST NOT recognize `--output` as a flag.

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
- **THEN** `formatChatAsMarkdown` is called with `includeMetadata=true` and the resulting file contains a metadata header

#### Scenario: Export with no id errors and exits 1
- **WHEN** the user runs `gemiterm export`
- **THEN** the output contains `Error: conversation ID is required.` and the process exits with code 1

#### Scenario: Export --help shows usage
- **WHEN** the user runs `gemiterm export --help`
- **THEN** the output contains `Usage: gemiterm export <conversation_id> [options]` and documents `--out`, `--format`, `--include-metadata`, and `--help`

### Requirement: ExportAllCommand

The system MUST provide an `export-all` command implemented by `ExportAllCommand` in `src/cli/commands/export-all-command.ts`. The command MUST support `--out-dir/-o <dir>` (default `./exports`), `--since <date>`, `--include-metadata`, `--all-profiles/-a`, and `--help/-h`. The command MUST send a `ListChatsQuery` to the mediator with payload `{ allProfiles }`, MUST filter the resulting chats to those whose `timestamp` is on or after the `--since` date (when supplied), and MUST iterate over the remaining chats sending a `FetchChatQuery` for each and writing a markdown file per chat under the output directory using `formatChatAsMarkdown` with sanitized filenames of the form `gemini-chat-<sanitized-title>-<YYYY-MM-DD>.md`. The command MUST create the output directory with `mkdirSync(..., { recursive: true })` and MUST write an `index.md` file in the output directory that lists each successfully exported conversation as a markdown link and, when present, a `## Failed Exports` section listing failed exports with their error message. The command MUST print progress to stdout as `  [i/total] Exporting <id>...` followed by `OK` or `FAILED` on the same line, and MUST print a final summary including `Exported: <n>`, optional `Failed: <n>`, `Output: <dir>`, and `Index: <dir>/index.md`. When `--include-metadata` is set the index MUST include a `> Successful: <n> | Failed: <n>` line. The command MUST NOT recognize `--output-dir` as a flag.

#### Scenario: Export-all writes per-chat files and an index
- **WHEN** the user runs `gemiterm export-all --out-dir ./exports` against a mediator returning two chats
- **THEN** exactly two markdown files appear under `./exports` and `./exports/index.md` contains a `## Conversations` section linking to both filenames

#### Scenario: Export-all default output directory is ./exports
- **WHEN** the user runs `gemiterm export-all` with no `--out-dir`
- **THEN** the output directory is `./exports` (resolved against the current working directory)

#### Scenario: Export-all with --all-profiles propagates to mediator
- **WHEN** the user runs `gemiterm export-all --all-profiles`
- **THEN** the `ListChatsQuery` payload carries `allProfiles: true`

#### Scenario: Export-all with --since filters by date
- **WHEN** the user runs `gemiterm export-all --since 2024-01-01`
- **THEN** chats with `timestamp < 2024-01-01` are excluded from the iteration and from the index

#### Scenario: Export-all reports failed exports
- **WHEN** the mediator's `FetchChatQuery` handler throws for one chat
- **THEN** the failing chat appears in `index.md` under a `## Failed Exports` section and the printed summary contains `Failed:  1` (two spaces before the count, matching `formatReportSummary`)

#### Scenario: Export-all shows progress lines
- **WHEN** the user runs `gemiterm export-all` against a mediator returning N chats
- **THEN** exactly N progress lines of the form `[i/N]` are written to stdout, each followed by `OK` or `FAILED`

#### Scenario: Export-all with no conversations prints the empty message
- **WHEN** the mediator returns an empty `chats` array
- **THEN** the output contains `No conversations found to export.` and no `index.md` is written

#### Scenario: Export-all --include-metadata adds success/failure counts to the index
- **WHEN** the user runs `gemiterm export-all --include-metadata`
- **THEN** `index.md` contains a line `> Successful: <n> | Failed: <n>`

#### Scenario: Export-all --help shows usage
- **WHEN** the user runs `gemiterm export-all --help`
- **THEN** the output contains `Usage: gemiterm export-all [options]` and documents `--out-dir`, `--since`, `--include-metadata`, `--all-profiles`, and `--help`

### Requirement: AuthCommand

The system MUST provide an `auth` command implemented by `AuthCommand` in `src/cli/commands/auth-command.ts`. The command MUST be registered under the name `auth` (NOT `login`) and MUST take no positional arguments. The command MUST delegate the actual browser-driven authentication to `AuthService.authenticate(profileName)`. When zero profiles exist, the command MUST create the default profile and authenticate against it. When exactly one profile exists, the command MUST authenticate against that profile directly. When more than one profile exists, the command MUST display a profile management menu using `formatProfileTable` and the options `[A] Add new profile`, `[D] Delete profile`, `[S] Set default`, `[R] Rename profile`, `[X] Exit and continue with current default`. The `A` and `R` options MUST trigger authentication against the resulting profile; `D`, `S`, and `X` MUST NOT trigger authentication. The `D` option MUST require a `[y/N]` confirmation before deletion. The `S` option MUST call both `ProfileManager.setDefault` and `setDefaultProfileName`. Profile names MUST be validated via `validateProfileName`.

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

### Requirement: ProfileCommand

The system MUST provide a `profile` command implemented by `ProfileCommand` in `src/cli/commands/profile-command.ts`. The command MUST be a subcommand-style dispatcher with actions `add <name>`, `delete <name>`, `rename <old> <new>`, `default <name>`, and `list`. The first positional argument MUST select the action; the action name MUST be one of the five above, otherwise the command MUST throw a `GemitermError` whose message includes the substring `Unknown action` and lists the valid actions. When no action is provided, the command MUST print usage. The `add` action MUST validate the new name via `validateProfileName`, MUST throw `Profile '<name>' already exists.` if the name is taken, MUST create the profile via `ProfileManager.create`, and MUST then call `AuthService.authenticate(profileName)`. The `delete` action MUST require a `Delete profile '<name>'? [y/N]` confirmation before calling `ProfileManager.delete`. The `rename` action MUST validate the new name, MUST call `ProfileManager.rename(old, new)`, and MUST throw if `new` already exists. The `default` action MUST call both `ProfileManager.setDefault` and `setDefaultProfileName`. The `list` action MUST print `No profiles found.` when the profile list is empty (with a hint to run `gemiterm login`); otherwise it MUST print a profile table via `formatProfileTable` with the `* = default profile` legend.

#### Scenario: Profile with no arguments prints usage
- **WHEN** the user runs `gemiterm profile`
- **THEN** the output contains `Usage: gemiterm profile <action> [args]` and lists all five actions with descriptions

#### Scenario: Profile add creates a profile and authenticates
- **WHEN** the user runs `gemiterm profile add new-name`
- **THEN** `ProfileManager.create("new-name")` is called and `AuthService.authenticate("new-name")` is invoked

#### Scenario: Profile add rejects duplicate name
- **WHEN** the user runs `gemiterm profile add existing`
- **THEN** the command throws `Profile 'existing' already exists.`

#### Scenario: Profile delete requires confirmation
- **WHEN** the user runs `gemiterm profile delete my-profile` and answers `n` to the confirmation prompt
- **THEN** no `ProfileManager.delete` is called and the output contains `Cancelled.`

#### Scenario: Profile rename calls ProfileManager.rename
- **WHEN** the user runs `gemiterm profile rename old new`
- **THEN** `ProfileManager.rename("old", "new")` is called

#### Scenario: Profile default sets the default profile
- **WHEN** the user runs `gemiterm profile default work`
- **THEN** `ProfileManager.setDefault("work")` and `setDefaultProfileName("work")` are both called

#### Scenario: Profile list prints the profile table
- **WHEN** the user runs `gemiterm profile list` and profiles exist
- **THEN** the output contains `Profiles` and a profile table produced by `formatProfileTable`

#### Scenario: Profile list with no profiles prints the empty message
- **WHEN** the user runs `gemiterm profile list` and no profiles exist
- **THEN** the output contains `No profiles found.`

#### Scenario: Profile with unknown action throws
- **WHEN** the user runs `gemiterm profile bogus`
- **THEN** the command throws a `GemitermError` whose message contains `Unknown action 'bogus'`

#### Scenario: Profile --help shows usage
- **WHEN** the user runs `gemiterm profile --help`
- **THEN** the output contains `Usage: gemiterm profile <action> [args]` and documents all five actions

### Requirement: StatusCommand

The system MUST provide a `status` command implemented by `StatusCommand` in `src/cli/commands/status-command.ts`. The command MUST take no arguments (other than `--help/-h`). The command MUST call `ensureConfigDir()`, MUST print a `Configuration` section containing `Directory: <configDir>` (the value from `getConfigDir()`), and MUST then print a `Profiles` section using `formatProfileTable`. When no profiles exist, the command MUST print `No profiles found. Run 'gemiterm login' to create one.` and MUST exit with code 2. When profiles exist, the command MUST additionally log a status line with the count of active profiles via `Logger.info`.

#### Scenario: Status with profiles shows the directory and the profile table
- **WHEN** the user runs `gemiterm status` and at least one profile exists
- **THEN** the output contains `Configuration`, `Directory: <configDir>`, `Profiles`, and a profile table with columns `NAME`, `ACTIVE`, `EXPIRES`, `DEFAULT`

#### Scenario: Status with no profiles exits with code 2
- **WHEN** the user runs `gemiterm status` and no profiles exist
- **THEN** the output contains `No profiles found.` and the process exits with code 2

#### Scenario: Status --help shows usage
- **WHEN** the user runs `gemiterm status --help`
- **THEN** the output contains `Usage: gemiterm status` and documents `-h, --help`

### Requirement: InstallBrowserCommand

The system MUST provide an `install-browser` command implemented by `InstallBrowserCommand` in `src/cli/commands/install-browser-command.ts`. The command MUST be marked as hidden (its description starts with "Install Chromium browser for Playwright (hidden command)"). The command MUST print `Checking browser installation...` (dim) before invoking `InstallBrowserService.install()`. On success the command MUST print `Browser ready.` (green). On `InstallBrowserError` the command MUST log the error and cause, MUST print `Failed to install browser.` (red) and the hint `You may need to run: bunx @playwright/cli install chromium` (dim), and MUST exit with code 1.

#### Scenario: Install-browser prints the success lines on a clean install
- **WHEN** the user runs `gemiterm install-browser` and `InstallBrowserService.install()` resolves
- **THEN** the output contains `Checking browser installation...` and `Browser ready.`

#### Scenario: Install-browser exits 1 on InstallBrowserError
- **WHEN** the user runs `gemiterm install-browser` and `InstallBrowserService.install()` throws an `InstallBrowserError`
- **THEN** the output contains `Failed to install browser.` and the hint about `bunx @playwright/cli install chromium`, and the process exits with code 1

### Requirement: CommandRegistry

The system MUST provide a `CommandRegistry` class in `src/cli/command-registry.ts` that stores `CliCommand` instances keyed by command name. The `register(name, handler)` method MUST throw `Command already registered: <name>` when the same name is registered twice. The `getHandler(name)` method MUST return the handler for the name or `undefined` if not present. The `has(name)` method MUST return a boolean. The `getRegisteredNames()` method MUST return an array of all registered names. The `registerAllCommands()` method MUST register all 11 commands by name: `auth`, `profile`, `status`, `list`, `fetch`, `continue`, `new`, `delete`, `export`, `export-all`, and `install-browser`. The `CliCommandContext` interface MUST carry `{ verbose: boolean, mediator: Mediator, profileAuthManager: ProfileAuthManager }`. The `CliCommand` interface MUST require `name: string`, `description: string`, and `execute(args, context): Promise<void>`.

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
- **THEN** `getRegisteredNames()` returns an array that includes `auth`, `profile`, `status`, `list`, `fetch`, `continue`, `new`, `delete`, `export`, `export-all`, and `install-browser` (11 entries total)

### Requirement: Command Help Output

Every command in the registry MUST support `--help` and `-h`. When `--help` or `-h` is supplied, the command MUST print a usage block starting with `Usage: gemiterm <command> ...` and MUST NOT perform its primary mediator action. Each command's usage block MUST list that command's flags and positional arguments.

#### Scenario: Every command has a --help that starts with Usage
- **WHEN** any of `gemiterm <cmd> --help` or `gemiterm <cmd> -h` is invoked for `cmd` in `{list, fetch, continue, new, delete, export, export-all, status, auth, profile}`
- **THEN** the first line of the output is `Usage: gemiterm <cmd> ...`

#### Scenario: --help does not perform the command's primary action
- **WHEN** `gemiterm <cmd> --help` is invoked
- **THEN** the command's primary mediator action is not executed (no `ListChatsQuery`, `FetchChatQuery`, `SendMessageCommand`, `StartNewChatCommand`, or `DeleteConversationCommand` is sent)

### Requirement: Global Help and Version

The system MUST print a global help block via `showHelp(registry)` in `src/cli/commands/help.ts` when `gemiterm` is invoked with no arguments, when `gemiterm --help` or `gemiterm -h` is invoked, or when an unknown subcommand is supplied. The global help block MUST list the `Commands:` section using the names from the registry, the `Global Options:` section (`--version`, `--help, -h`, `--verbose, -v`), and a footer hinting at `gemiterm <command> --help`. When `--version` is supplied the system MUST print `gemiterm v<version>` (where `<version>` is the value of `package.json:version`) and exit with code 0. When an unknown subcommand is supplied, the system MUST print `Unknown command: '<name>'` to stderr and MUST additionally print a `Did you mean one of: <list>?` hint when the registry has registered commands, otherwise a `Run 'gemiterm --help' for available commands.` hint, and the process MUST exit with code 1.

#### Scenario: No arguments prints global help
- **WHEN** the user runs `gemiterm` with no arguments
- **THEN** the output contains `GemiTerm - Google Gemini Terminal Client`, a `Commands:` section, and a `Global Options:` section; the process exits with code 0

#### Scenario: --version prints the package version
- **WHEN** the user runs `gemiterm --version`
- **THEN** the output is `gemiterm v<package.json:version>` and the process exits with code 0

#### Scenario: Unknown subcommand prints an error and a hint
- **WHEN** the user runs `gemiterm bogus` and the registry has registered commands
- **THEN** stderr contains `Unknown command: 'bogus'` and a `Did you mean one of:` line listing the registered names, and the process exits with code 1
