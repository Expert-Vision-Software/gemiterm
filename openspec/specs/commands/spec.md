## Purpose

The CLI command layer of the `gemiterm` application. It defines the 11 top-level user-facing commands (auth, profile, status, list, fetch, continue, new, delete, export, export-all, install-browser), each implemented as a `CliCommand` class registered by the `CommandRegistry`. The command layer is responsible for argument parsing, mediator dispatch (queries `ListChatsQuery` / `FetchChatQuery` and commands `SendMessageCommand` / `StartNewChatCommand` / `DeleteConversationCommand`), interactive REPL I/O for `new` and `continue`, and human-readable / JSON output formatting. This spec documents the as-built behavior of the command layer; any future conformance fixes are tracked separately in the `command-spec-conformance` change.
## Requirements
### Requirement: ListCommand

The system MUST provide a `list` command implemented by `ListCommand` in `src/cli/commands/list-command.ts`. The command MUST be registered under the name `list` and MUST obtain chats through the shared listing helper (`listChatsForRequest`) — see the *Multi-Profile Listing Resilience* requirement for the default scope and failure semantics. The command MUST support the flags `--limit/-n <N>` (no default; omitting `--limit` returns every conversation returned by the listing), `--offset <N>` (default 0), `--all-profiles` (accepted and preserved for script compatibility; with the all-profiles default it is redundant but MUST NOT error), `--profile/-p <name>` (scope the listing to exactly the named profile), `--sort <recent|oldest|alpha>` (default `recent`), `--search/-s <query>`, `--after <date>`, `--before <date>`, `--format/-f <text|json>` (default `text`), `--out/-o <path>`, and `--interactive/-i` (see the interactive requirements). When `--limit N` is supplied, the command MUST additionally slice the result set to `[offset, offset + N)`. When `--limit` is omitted the command MUST NOT slice; when `--offset N > 0` is supplied without `--limit` the command MUST slice to `[N, ∞)`. Sorting MUST be applied via the shared `sortChats` and date filtering via the shared `filterChatsByDate` (see the `chat-output` capability). Rendering MUST be delegated to `ChatOutput.render` — the command MUST NOT implement its own sort, date filter, output helpers, or stdout-vs-file dispatch. When `--out <path>` is supplied, the rendered output MUST be written to that file via `infrastructure/io.ts:writeTextFile` and the command MUST print `Output written to: <path>`; otherwise the output MUST be printed to stdout. The command MUST NOT recognize `--path` as an output flag and MUST NOT support a `--all` flag (omitting `--limit` is the canonical way to request every conversation).

#### Scenario: List with no flags aggregates all profiles
- **WHEN** the user runs `gemiterm list` and profiles `work` and `personal` are configured
- **THEN** the listing spans both profiles (chats from each are included), chats from inaccessible profiles are skipped with a warning, and the rendered table is sorted by the default `recent` order

#### Scenario: List with --profile scopes to the named profile
- **WHEN** the user runs `gemiterm list --profile work`
- **THEN** only the `work` profile's chats are listed

#### Scenario: List with --limit
- **WHEN** the user runs `gemiterm list --limit 5`
- **THEN** at most 5 chats are displayed

#### Scenario: List with --offset and no --limit skips the first N chats
- **WHEN** the user runs `gemiterm list --offset 20`
- **THEN** the first 20 chats are skipped before display

#### Scenario: List with --all-profiles remains accepted
- **WHEN** the user runs `gemiterm list --all-profiles`
- **THEN** the command behaves identically to `gemiterm list` (the flag is redundant with the all-profiles default and MUST NOT error)

#### Scenario: List with --sort alpha sorts ascending by title
- **WHEN** the user runs `gemiterm list --sort alpha`
- **THEN** the displayed chats are sorted by `title` ascending using `localeCompare` (via the shared `sortChats`)

#### Scenario: List with --search forwards the search term
- **WHEN** the user runs `gemiterm list --search "Bun"`
- **THEN** the listing carries `search: "Bun"` for every profile in scope

#### Scenario: List with --format json
- **WHEN** the user runs `gemiterm list --format json`
- **THEN** the output is a JSON document with shape `{ chats: ChatInfo[] }` and nothing else is written to stdout

#### Scenario: List with --out writes the rendered output to the given file
- **WHEN** the user runs `gemiterm list --out ./out.txt`
- **THEN** the rendered text or JSON content is written to `./out.txt` and a confirmation line `Output written to: <resolved>` is printed

#### Scenario: List with --after and --before filters chats by date
- **WHEN** the user runs `gemiterm list --after 2024-01-01 --before 2024-12-31`
- **THEN** chats with `timestamp` outside the inclusive range are removed before display (via the shared `filterChatsByDate`)

#### Scenario: List with no conversations prints the empty message
- **WHEN** the listing resolves to an empty `chats` array
- **THEN** the output contains the message `No conversations found.`

#### Scenario: List --help shows usage
- **WHEN** the user runs `gemiterm list --help`
- **THEN** the output contains `Usage: gemiterm list` and documents every flag above, and does NOT document a `--all` flag

#### Scenario: List rendering goes through ChatOutput
- **WHEN** `ListCommand.execute` runs
- **THEN** output is produced via `ChatOutput.render`, and the command file defines no `applySort`, `applyDateFilter`, `outputJson`, `outputText`, or `writeOutput`

### Requirement: ListCommand Text Output Table

The `list` command's default text output MUST be a 4-column table with headers `ID`, `TITLE`, `DATE`, `PIN` (in that order), produced by `formatChatList` via `ChatOutput.render`. The render MUST call `formatChatList(chats, { includeProfileColumn: true })` and the text output MUST include a `PROFILE` column as the 5th column when: more than one profile is configured, OR `--all-profiles` is explicitly supplied, OR `--profile <name>` scopes the listing. When exactly one profile is configured and neither `--all-profiles` nor `--profile` is supplied, the table MUST remain the 4-column form (byte-equivalent to the single-profile baseline).

#### Scenario: Single-profile default output has 4 columns
- **WHEN** the user runs `gemiterm list` (no flags) and exactly one profile is configured
- **THEN** the rendered table contains header columns `ID`, `TITLE`, `DATE`, and `PIN` only, byte-equivalent to the pre-change single-profile output

#### Scenario: Multi-profile default adds a Profile column
- **WHEN** the user runs `gemiterm list` (no flags) and more than one profile is configured
- **THEN** the rendered text output table contains 5 columns `ID`, `TITLE`, `DATE`, `PIN`, `PROFILE` and each row shows the owning profile name

#### Scenario: --all-profiles adds a Profile column to text output
- **WHEN** the user runs `gemiterm list --all-profiles`
- **THEN** the rendered text output table contains the `PROFILE` column regardless of how many profiles are configured

#### Scenario: --profile renders the Profile column
- **WHEN** the user runs `gemiterm list --profile work`
- **THEN** the rendered table contains the 5 columns `ID`, `TITLE`, `DATE`, `PIN`, `PROFILE`, byte-equivalent to the pre-change `--profile`-scoped output

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

The `ListCommand`'s non-interactive output paths MUST remain byte-equivalent to the pre-phase-2 baseline in every configuration where the listing scope is unchanged. Specifically:
- **Single-profile setups**: `gemiterm list` (no flags) MUST emit the same 4-column text table; `--format json` the same `{ chats: ChatInfo[] }` document; `--search`, `--sort`, `--limit`/`--offset`, `--after`/`--before`, `--out` all behave identically.
- **Multi-profile setups**: `gemiterm list --profile <name>` MUST behave identically to the pre-change scoped listing.
- **Intentional delta**: in multi-profile setups the flagless default now aggregates all profiles with a `PROFILE` column (see the modified *ListCommand* and *ListCommand Text Output Table* requirements). This delta is a deliberate behavior change; `tests/integration/commands/list.test.ts` expectations for the multi-profile default are updated accordingly, while its single-profile expectations remain untouched.
- `gemiterm list --out <p>` MUST write the rendered output to the path and print a confirmation line in all configurations.

#### Scenario: Single-profile list is byte-identical
- **WHEN** the user runs any flagless or flagged non-interactive `gemiterm list` invocation in a single-profile setup
- **THEN** the output is byte-identical to the pre-change baseline for the same invocation

#### Scenario: Multi-profile --profile list is byte-identical
- **WHEN** the user runs `gemiterm list --profile work` in a multi-profile setup
- **THEN** the output is byte-identical to the pre-change `--profile`-scoped baseline

#### Scenario: --format json is the same JSON document
- **WHEN** the user runs `gemiterm list --format json` in a single-profile setup
- **THEN** the output is the same `{ chats: ChatInfo[] }` JSON document that the pre-change `list` command emitted

#### Scenario: Multi-profile default intentionally changes
- **WHEN** the user runs `gemiterm list` (no flags) in a multi-profile setup
- **THEN** the output aggregates all profiles with the `PROFILE` column — this is the documented intentional delta, covered by updated integration-test expectations

#### Scenario: --help documents --interactive
- **WHEN** the user runs `gemiterm list --help`
- **THEN** the output contains a `--interactive, -i` flag description in the existing flag list

### Requirement: FetchCommand

The system MUST provide a `fetch` command implemented by `FetchCommand` in `src/cli/commands/fetch-command.ts`. The command MUST accept a single optional positional `<conversation_id>` argument and MUST support `--format/-f <text|json>` (default `text`), `--out/-o <path>`, and `--profile/-p <name>` (profile that owns the conversation; default: auto-discover). When a conversation id is provided, the command MUST fetch the conversation via the shared fetch helper (with `resolveProfile` for profile routing). When an explicit `--profile <name>` is supplied, the profile MUST be validated as configured, armed (`ensureSession`), and — when its jar armed stale — the in-flight detached rotation MUST be awaited (bounded, stderr notice only) and the classification re-checked once before proceeding; a profile that is still not `live` after the wait MUST surface failure handling instead of an instant pre-arm rejection: interactively, a recovery confirm mirroring the `list` command's; non-interactively, a typed `AuthenticationError` naming the profile's state and remediation. When no conversation id is provided, the command MUST invoke the `list` command via the shared command invoker and return without fetching. All output rendering MUST be delegated to `ChatOutput.render` — the command MUST NOT define its own output helpers or `writeOutput` method. Text output MUST include a header line `Conversation: <id>` and label each message with `User:` or `Model:` depending on role. JSON output MUST be `{ conversationId, messages }`. When `--out <path>` is supplied, the rendered output MUST be written to that file via `infrastructure/io.ts:writeTextFile` and the command MUST print `Output written to: <path>`; otherwise the output MUST be printed to stdout. The command MUST NOT recognize `--path` as an output flag. Fresh/live profiles MUST NOT observe added latency or changed stdout bytes.

#### Scenario: Fetch with conversation id renders the conversation
- **WHEN** the user runs `gemiterm fetch conv-abc123`
- **THEN** the conversation is fetched and rendered via `ChatOutput.render` with the `Conversation: conv-abc123` header

#### Scenario: Fetch with explicit stale profile awaits rotation and retries
- **WHEN** the user runs `gemiterm fetch conv-abc123 -p stale` where `stale`'s jar is stale, a detached rotation is in flight, and it lands within the wait ceiling
- **THEN** a stderr-only `Session refresh in progress` notice is printed, the rotation is awaited, the read is retried once on the refreshed jar, and the conversation renders (stdout bytes identical to a live-profile fetch of the same conversation)

#### Scenario: Fetch with explicit profile still not live after the wait fails typed
- **WHEN** the user runs `gemiterm fetch conv-abc123 -p stale` in a non-interactive context and `stale` classifies non-live after the rotation wait
- **THEN** the command throws `AuthenticationError` naming profile `stale`'s state and the `gemiterm auth` remediation, and exits non-zero — it MUST NOT silently route to another profile

#### Scenario: Fetch with no id invokes list
- **WHEN** the user runs `gemiterm fetch` with no positional argument
- **THEN** no conversation is fetched and the `list` command is executed against the same context (after printing a "No conversation ID specified" notice)

#### Scenario: Fetch with --format json
- **WHEN** the user runs `gemiterm fetch conv-abc123 --format json`
- **THEN** the output is a JSON document with shape `{ conversationId: "conv-abc123", messages: Message[] }`

#### Scenario: Fetch with --out writes the rendered output to the given file
- **WHEN** the user runs `gemiterm fetch conv-abc123 --out ./out.txt`
- **THEN** the rendered text or JSON content is written to `./out.txt` and a confirmation line `Output written to: <resolved>` is printed

#### Scenario: Fetch with empty messages prints "No messages found"
- **WHEN** the fetched conversation has `messages: []`
- **THEN** the rendered text output contains `No messages found.`

#### Scenario: Fetch --help shows usage
- **WHEN** the user runs `gemiterm fetch --help`
- **THEN** the output contains `Usage: gemiterm fetch [conversation_id] [options]` and documents `--format`, `--out`, `--profile`, and `--help`

#### Scenario: Fetch rendering goes through ChatOutput
- **WHEN** `FetchCommand.execute` runs
- **THEN** output is produced via `ChatOutput.render` and the command file defines no `writeOutput` or output-helper methods

### Requirement: ContinueCommand

The system MUST provide a `continue` command implemented by `ContinueCommand` in `src/cli/commands/continue-command.ts`. The command MUST accept an optional positional `<conversation_id>` and an optional positional `<message>`, plus `--help/-h` and `--profile`. When `<conversation_id>` is missing, the command MUST invoke the `list` command via the shared command-invoker helper and return. When `<conversation_id>` is present, the command MUST resolve the owning profile through the shared `resolveProfile` helper (`src/cli/utils/profile-resolution.ts`), which consults `context.cookieSession.activeProfiles()` and - when more than one profile is active - `context.cookieSession.findProfileForConversation(conversationId)`, throwing `AuthenticationError` with the shared remediation message when no owner is found; in a single-profile setup the helper MUST return `null` and the default profile is used without a lookup. When both `<conversation_id>` and `<message>` are present, the command MUST send the message as a one-shot continuation through the shared chat-session dispatch with the resolved profile. When `<conversation_id>` is present and `<message>` is absent, the command MUST start an interactive chat session via the shared chat-session helper and MUST create exactly one session keepalive (through `context.cookieSession.createKeepalive`) for the resolved-or-default profile; the REPL MUST exit on `/exit` or `/quit` and MUST ignore empty lines. When no profile owns the conversation, the command MUST throw `AuthenticationError` with a remediation message and exit non-zero.

#### Scenario: Continue with id and message sends a SendMessageCommand

- **WHEN** the user runs `gemiterm continue conv-abc123 "Hello there"`
- **THEN** the chat-session helper dispatches the message against the resolved profile's `GeminiClientService` and the response text is printed after a `Model:` label

#### Scenario: Continue with no id invokes list

- **WHEN** the user runs `gemiterm continue` with no positional argument
- **THEN** the `list` command is executed via the shared command-invoker helper and no chat-session dispatch occurs

#### Scenario: Continue with id but no message starts an interactive REPL

- **WHEN** the user runs `gemiterm continue conv-abc123` and types a line into stdin
- **THEN** the chat-session helper dispatches the line against the resolved profile's `GeminiClientService` and the model response is printed after a `Model:` label, with exactly one keepalive created for the resolved profile

#### Scenario: Continue REPL exits on /exit

- **WHEN** the user types `/exit` or `/quit` in the continue REPL
- **THEN** the readline interface closes and the command returns

#### Scenario: Continue REPL ignores empty lines

- **WHEN** the user enters a blank line in the continue REPL
- **THEN** no chat-session dispatch occurs and the REPL continues prompting

#### Scenario: Continue --help shows usage

- **WHEN** the user runs `gemiterm continue --help`
- **THEN** the output contains `Usage: gemiterm continue [conversation_id] [message] [options]` and documents `/exit`, `/quit`, and `--help`

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

The system MUST provide a `delete` command implemented by `DeleteCommand` in `src/cli/commands/delete-command.ts`. The command MUST accept a single positional `<conversation_id>` argument and MUST support `--force/-f`, `--profile`, and `--help/-h`. When `<conversation_id>` is missing, the command MUST print `Error: conversation ID is required.` and exit with code 1. When `<conversation_id>` is present, the command MUST validate the id via `validateConversationId`. The command MUST resolve the owning profile through the shared `resolveProfile` helper (`context.cookieSession.activeProfiles()` / `findProfileForConversation`), throwing `AuthenticationError` with the shared remediation message when no owner is found; in a single-profile setup the default profile is used without a lookup. When `--force` is not set, the command MUST prompt for confirmation and MUST treat a `y`-prefix (case-insensitive) answer as consent; declining MUST print `Cancelled.` and stop. On confirmation (or `--force`), the command MUST delete the conversation through the resolved profile's `GeminiClientService` obtained from the context client factory. The command MUST print `Conversation '<id>' deleted.` on success and MUST exit with code 1 on a failed result or error. When an explicit `--profile` names a profile without a valid session, the command MUST throw `AuthenticationError` suggesting `gemiterm auth --renew <name>`.

#### Scenario: Delete with --force sends DeleteConversationCommand

- **WHEN** the user runs `gemiterm delete conv-abc123 --force`
- **THEN** the resolved profile's `GeminiClientService.deleteChat` is invoked with `"conv-abc123"`, no readline prompt is shown, and on success the output contains `deleted.`

#### Scenario: Delete without --force prompts for confirmation

- **WHEN** the user runs `gemiterm delete conv-abc123` and answers `yes` to the prompt
- **THEN** the resolved profile's `GeminiClientService.deleteChat` is invoked with `"conv-abc123"`

#### Scenario: Delete without --force and no confirmation aborts

- **WHEN** the user runs `gemiterm delete conv-abc123` and answers `no` to the prompt
- **THEN** no delete is performed and the output contains `Cancelled.`

#### Scenario: Delete with no id errors and exits 1

- **WHEN** the user runs `gemiterm delete`
- **THEN** the output contains `Error: conversation ID is required.` and the process exits with code 1

#### Scenario: Delete with -f short flag

- **WHEN** the user runs `gemiterm delete conv-abc123 -f`
- **THEN** the command is equivalent to `--force` (no prompt, delete proceeds)

#### Scenario: Delete with failed result exits 1

- **WHEN** the resolved profile's client reports failure or throws
- **THEN** the process exits with code 1 and the output surfaces the failure

#### Scenario: Delete --help shows usage

- **WHEN** the user runs `gemiterm delete --help`
- **THEN** the output contains `Usage: gemiterm delete <conversation_id> [options]` and documents `--force`, `--profile`, and `--help`

#### Scenario: Delete with --force skips the prompt

- **WHEN** `gemiterm delete <cid> -f` runs and the profile is resolved
- **THEN** no confirmation prompt is shown and the delete routes to the resolved profile's client

#### Scenario: Declining confirmation cancels

- **WHEN** the confirmation prompt is answered with `n`
- **THEN** `Cancelled.` is printed, nothing is deleted, and the conversation remains

#### Scenario: Missing id errors with code 1

- **WHEN** `gemiterm delete` runs with no argument
- **THEN** `Error: conversation ID is required.` is printed and the exit code is 1

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

### Requirement: AuthCommand

The system MUST provide an `auth` command implemented by `AuthCommand` in `src/cli/commands/auth-command.ts`. The command MUST be registered under the name `auth` with `login` as a registered alias, and MUST accept an optional positional `<profile_name>` that authenticates an existing profile directly (equivalent to the `auth` action's `profileName` param). The command MUST be a thin adapter: it MUST delegate all profile-lifecycle work to `context.profileLifecycle.manageProfiles(action, params)`, which forwards the actual browser-driven authentication to `context.cookieSession.captureLogin` (the `create` action after `ProfileManager.create`, and the `auth` action's renewal via `captureLogin(profile, { mode: "renew" })` for `--renew`). The command MUST accept the subaction flags `--add <name>`, `--delete <name>`, `--rename <old> <new>` (or paired values), `--default <name>`, and `--renew <name>`, mapping them to the corresponding lifecycle actions; with no flags it MUST run the interactive flow. The command MUST NOT construct any profile, storage, browser, or auth collaborator itself - everything arrives via `CliCommandContext`. When zero profiles exist, the command MUST create the default profile and authenticate against it. When exactly one profile exists, the command MUST authenticate against that profile directly. When more than one profile exists, the command MUST display a profile management menu using `formatProfileTable` and the options `[A] Add new profile`, `[D] Delete profile`, `[S] Set default`, `[R] Rename profile`, `[E] Renew session (extend/refresh cookies)`, `[X] Exit and continue with current default`. The `A` and `R` options MUST trigger authentication against the resulting profile; the `E` option MUST renew the named profile's session via `captureLogin(name, { mode: "renew" })`; `D`, `S`, and `X` MUST NOT trigger authentication. The `D` option MUST require a `[y/N]` confirmation before deletion. Profile names MUST be validated via `validateProfileName`. All menu text, prompts, and error messages MUST be byte-equivalent to the pre-change baseline.

#### Scenario: Auth with no profiles creates and authenticates the default profile

- **WHEN** the user runs `gemiterm auth` and no profiles exist
- **THEN** the default profile is created and `CookieSession.captureLogin` is invoked against it

#### Scenario: Auth with one profile authenticates that profile directly

- **WHEN** the user runs `gemiterm auth` and exactly one profile exists
- **THEN** `CookieSession.captureLogin` is invoked against that profile and no menu is shown

#### Scenario: Auth with multiple profiles shows the menu

- **WHEN** the user runs `gemiterm auth` and more than one profile exists
- **THEN** the profile management menu is printed and the user is prompted with `Select an option:`

#### Scenario: Auth menu option A creates and authenticates

- **WHEN** the user selects `A` and enters a valid new profile name
- **THEN** the profile is created and `CookieSession.captureLogin` is invoked against the new name

#### Scenario: Auth menu option D requires confirmation

- **WHEN** the user selects `D`, enters an existing profile name, and answers the `Delete profile '<name>'? [y/N]` prompt with `y`
- **THEN** the profile is removed via `ProfileManager.delete`

#### Scenario: Auth menu option S sets the default profile

- **WHEN** the user selects `S` and enters an existing profile name
- **THEN** `ProfileManager.setDefault(name)` and `setDefaultProfileName(name)` are both called

#### Scenario: Auth menu option R renames and authenticates

- **WHEN** the user selects `R` and enters an existing name and a new valid name
- **THEN** `ProfileManager.rename(old, new)` is called and `CookieSession.captureLogin` is invoked against the new name

#### Scenario: Auth menu option X exits without authenticating

- **WHEN** the user selects `X` (or any other unhandled option) in the menu
- **THEN** no `captureLogin` is invoked and the output contains `Continuing with current default profile.`

#### Scenario: Auth rejects invalid profile names

- **WHEN** the user enters an invalid profile name in response to an `A` or `R` prompt
- **THEN** `validateProfileName` throws and the command fails with the validator's error message

#### Scenario: Auth --help shows usage

- **WHEN** the user runs `gemiterm auth --help`
- **THEN** the output contains `Usage: gemiterm auth` and documents `-h, --help`

#### Scenario: Auth delegates through the context

- **WHEN** `AuthCommand.execute` runs
- **THEN** every profile-lifecycle operation is dispatched via `context.profileLifecycle.manageProfiles(...)` and the command file contains no inline service construction

#### Scenario: login alias resolves to the same command

- **WHEN** `gemiterm login --renew <name>` runs
- **THEN** the registered `login` alias dispatches to `AuthCommand` and the renewal delegates to `captureLogin(name, { mode: "renew" })`

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

### Requirement: InstallBrowserCommand

The system MUST provide an `install-browser` command implemented by `InstallBrowserCommand` in `src/cli/commands/install-browser-command.ts`. The command MUST be marked as hidden (its description starts with "Install Chrome for Testing browser for Playwright (hidden command)"). The command MUST print `Checking browser installation...` (dim) before invoking `InstallBrowserService.install()`. On success the command MUST print `Browser ready.` (green). On `InstallBrowserError` the command MUST log the error and cause, MUST print `Failed to install browser.` (red) and the hint `You may need to run: bunx @playwright/cli install-browser chrome-for-testing` (dim), and MUST exit with code 1.

#### Scenario: Install-browser prints the success lines on a clean install
- **WHEN** the user runs `gemiterm install-browser` and `InstallBrowserService.install()` resolves
- **THEN** the output contains `Checking browser installation...` and `Browser ready.`

#### Scenario: Install-browser exits 1 on InstallBrowserError
- **WHEN** the user runs `gemiterm install-browser` and `InstallBrowserService.install()` throws an `InstallBrowserError`
- **THEN** the output contains `Failed to install browser.` and the hint about `bunx @playwright/cli install-browser chrome-for-testing`, and the process exits with code 1

### Requirement: CommandRegistry

The system MUST provide a `CommandRegistry` class in `src/cli/command-registry.ts` that stores `CliCommand` instances keyed by command name. The `register(name, handler)` method MUST throw `Command already registered: <name>` when the same name is registered twice. The `getHandler(name)` method MUST return the handler for the name or `undefined` if not present. The `has(name)` method MUST return a boolean. The `getRegisteredNames()` method MUST return an array of all registered names. The `registerAllCommands()` method MUST register all commands by name, with `login` registered as an alias of the `auth` command. The `CliCommandContext` interface MUST carry `{ verbose: boolean, cookieSession: CookieSession, profileLifecycle: ProfileLifecycle, exportStrategies: { single: ExportStrategy; batch: ExportStrategy }, getGeminiClient: () => Promise<GeminiClientService>, listProfiles: () => Promise<string[]> }` (no `mediator` field). The `CliCommand` interface MUST require `name: string`, `description: string`, and `execute(args, context): Promise<void>`.

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
- **THEN** it exposes `verbose`, `cookieSession`, `profileLifecycle`, `exportStrategies`, `getGeminiClient`, and `listProfiles` (async), and does NOT expose a `mediator` or `profileAuthManager` field

#### Scenario: login alias dispatches to the auth command

- **WHEN** `registerAllCommands()` runs and `getHandler("login")` is called
- **THEN** the returned handler is the same instance registered under `auth`

### Requirement: Command Help Output

Every command in the registry MUST support `--help` and `-h`. When `--help` or `-h` is supplied, the command MUST print a usage block starting with `Usage: gemiterm <command> ...` and MUST NOT perform its primary action (no `GeminiClientService` call is made). Each command's usage block MUST list that command's flags and positional arguments.

#### Scenario: Every command has a --help that starts with Usage
- **WHEN** any of `gemiterm <cmd> --help` or `gemiterm <cmd> -h` is invoked for a registered command
- **THEN** the first line of the output is `Usage: gemiterm <cmd> ...`

#### Scenario: --help does not perform the command's primary action
- **WHEN** `gemiterm <cmd> --help` is invoked
- **THEN** the command's primary action is not executed (no `GeminiClientService` method is called)

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

### Requirement: ContinueCommand appends to the named conversation

The `continue` command's contract on `<conversation_id>` is **append** —
the named conversation MUST receive the new turn, not a brand-new chat.
The wrapper-level mechanism that achieves this is out of scope for this
requirement; the requirement is on the user-visible behavior the
`ContinueCommand` and its mediator dispatch enforce.

When the user runs `gemiterm continue <conversation_id> <message>`,
`<conversation_id>` MUST thread onto the conversation that already holds
that id. The model's response MUST be contextually aware of any prior
turns in the same conversation (today, the wrapper fails to thread and the
model treats the message as a fresh prompt — this requirement forbids that
outcome).

When `<message>` is omitted and the REPL is started with
`gemiterm continue <conversation_id>`, each subsequent non-empty line
MUST be appended to the same `<conversation_id>`; the REPL MUST NOT
silently create a new chat under the hood.

This requirement does NOT define how threading is implemented at the
wrapper layer (the implementation detail lives in the `conversations`
capability). It only enforces the user-visible outcome at the command
layer.

#### Scenario: Continue threads onto the named conversation when metadata is known
- **WHEN** the wrapper has previously persisted `rid`/`rcid` for
  `(profile, conversation_id)` (e.g. an earlier `sendMessage` in this
  process)
- **AND** the user runs `gemiterm continue <conversation_id> "follow up"`
- **THEN** the model's response references the prior turns of
  `<conversation_id>`
- **AND** no new chat is created (the response is appended to the named
  conversation; no new cid appears in `gemiterm list`)

#### Scenario: Continue second turn threads onto the first in the same process
- **WHEN** the user runs `gemiterm new` (no message) and types two lines
  into the REPL
- **THEN** both turns land in the same conversation
- **AND** the second turn's response references the first

#### Scenario: Continue REPL exits on /exit or /quit
- **WHEN** the user types `/exit` or `/quit` in the continue REPL
- **THEN** the readline interface closes and the command returns

#### Scenario: Continue REPL ignores empty lines
- **WHEN** the user enters a blank line in the continue REPL
- **THEN** no `SendMessageCommand` is sent and the REPL continues
  prompting

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

### Requirement: Shared Command Argument Parsing

The system MUST provide a shared, declarative command-argument parser in `src/cli/utils/command-args.ts`. It MUST export a `parseCommandArgs(args: string[], flags: readonly ArgFlagSpec[])` function that returns a flat `Record<string, unknown>` seeded from each flag's `default`. A flag spec MUST carry `key`, `long`, optional `short`, `type` (one of `boolean`, `string`, `integer`, `enum`), `description`, `helpLabel`, optional `default`, `enum`, `required`, and `valueName`. `parseCommandArgs` MUST recognize both the `long` and `short` tokens. Boolean flags MUST set `true`. Tolerant string flags MUST consume the following token (or `""` when absent). Required string/integer/enum flags MUST print `Error: <long> requires a <valueName>` to stderr and exit with code 1 when the following token is missing or starts with `-`. Integer flags MUST parse via `parseInt(value, 10) || default`. Enum flags MUST accept only values in `enum` and silently fall back to `default` otherwise. Unknown tokens MUST be ignored.

The system MUST also provide a `renderUsage(spec: UsageSpec)` function that renders a help block starting with the `usageLine`, an optional `Arguments:` section, an `Options:` section whose flag column is padded to `max(helpLabel length) + 2` using `chalk.cyan` for the flag and `chalk.dim` for the description, and optional footer lines.

#### Scenario: Boolean flag sets true
- **WHEN** `parseCommandArgs(["--force"], [{ key: "force", long: "--force", short: "-f", type: "boolean", default: false, description: "", helpLabel: "--force, -f" }])` is called
- **THEN** the result has `force === true`

#### Scenario: Tolerant string consumes the next token
- **WHEN** `parseCommandArgs(["--profile", "work"], [...profile spec...])` is called
- **THEN** the result has `profile === "work"`

#### Scenario: Tolerant string with no value yields empty string
- **WHEN** `parseCommandArgs(["--profile"], [...profile spec with type string, required false...])` is called
- **THEN** the result has `profile === ""`

#### Scenario: Required string with no value errors and exits 1
- **WHEN** `parseCommandArgs(["--profile"], [...profile spec with required true, valueName "profile name"...])` is called
- **THEN** stderr contains `Error: --profile requires a profile name` and the process exits with code 1

#### Scenario: Enum falls back to default on invalid value
- **WHEN** `parseCommandArgs(["--sort", "bogus"], [...sort spec enum ["recent","oldest","alpha"] default "recent"...])` is called
- **THEN** the result has `sort === "recent"`

#### Scenario: Integer parses via parseInt
- **WHEN** `parseCommandArgs(["--limit", "5"], [...limit spec type integer default 0...])` is called
- **THEN** the result has `limit === 5`

#### Scenario: renderUsage produces the Options block
- **WHEN** `renderUsage({ usageLine: "Usage: gemiterm list [options]", flags: [helpLabel "--limit, -n N" desc "Limit"], footer: [] })` is called
- **THEN** the returned string starts with `Usage: gemiterm list [options]` and contains an `Options:` section including the `--limit, -n N` label and its description

### Requirement: Shared Prompt Spillover

The system MUST provide a `loadEffectivePrompt(message: string | null, promptFile: string | null): Promise<string | null>` helper in `src/cli/utils/prompt-file.ts` used by both the `new` and `continue` commands. When `promptFile` is set it MUST load that file. When only `message` is set and it exceeds the Windows arg limit, the helper MUST spill the message to a temp file, load it, and remove the temp file afterwards. When `message` is within the limit it MUST return it unchanged. When both inputs are null it MUST return `null`.

#### Scenario: Prompt file takes precedence
- **WHEN** `loadEffectivePrompt("hi", "file.txt")` is called
- **THEN** the file content is read and returned

#### Scenario: Long message is spilled and cleaned up
- **WHEN** `loadEffectivePrompt(<message over the limit>, null)` is called
- **THEN** the message is written to a temp file, loaded, returned, and the temp file is removed

#### Scenario: No input returns null
- **WHEN** `loadEffectivePrompt(null, null)` is called
- **THEN** the result is `null`

### Requirement: Shared Command Invocation Helper

The system MUST provide an `invokeCommand(commandName: string, args: string[], context: CliCommandContext): Promise<void>` helper in `src/cli/utils/command-invoker.ts`. The helper MUST dynamically import the `CommandRegistry`, construct and register all commands, look up the named handler, and execute it with `(args, context)`. When no handler is registered for `commandName`, the helper MUST throw an `Error` whose message names the missing command. The `continue` and `fetch` commands MUST use this helper (in place of their previously byte-identical private `invokeListCommand` methods) to run the `list` command when no conversation id is supplied, preserving the `No conversation ID specified. Listing conversations:` notice. The `list` command's interactive action dispatch MUST use the same helper in place of its inline registry import+construction+registration block.

#### Scenario: Invoking a registered command executes it

- **WHEN** `invokeCommand("list", [], context)` is called
- **THEN** the registered `list` handler's `execute` receives `([], context)` and runs

#### Scenario: Invoking an unknown command throws

- **WHEN** `invokeCommand("nope", [], context)` is called
- **THEN** the helper rejects with an `Error` whose message names the missing command

#### Scenario: continue and fetch share the helper with no duplicated copies

- **WHEN** `src/cli/commands/continue-command.ts` and `src/cli/commands/fetch-command.ts` are inspected after the change
- **THEN** neither file defines an `invokeListCommand` method; both dispatch through `invokeCommand("list", [], context)` with the same `No conversation ID specified. Listing conversations:` notice as before

#### Scenario: list interactive dispatch routes through the helper

- **WHEN** the `list` command's interactive action menu dispatches `fetch`, `export`, or `continue`
- **THEN** the dispatch goes through `invokeCommand(<name>, <args>, context)` and the file contains no inline `new CommandRegistry()` construction

#### Scenario: Output byte-equivalence is preserved

- **WHEN** `gemiterm fetch` or `gemiterm continue` is run with no conversation id
- **THEN** the notice text, the rendered `list` output, and the exit code are byte-equivalent to the pre-change baseline

### Requirement: Shared Chat Session Dispatch

The system MUST provide a `startChatSession(params): Promise<void>` helper in `src/cli/utils/chat-session.ts` that owns the interactive/non-interactive mode branch for the chat commands. `params` MUST carry the effective message (`string | null`), an optional `conversationId`, an optional `profileName`, the `getGeminiClient` factory, and the logger. When the effective message is non-null the helper MUST perform the one-shot send (printing the model response after a `Model:` label, and for a new conversation printing the `Conversation ID: <id>` line via its first-turn hook). When the effective message is null the helper MUST start the interactive REPL via `runInteractiveLoop` with a `messageHandler` built from the same params. The presence of `conversationId` MUST select append semantics (`sendMessage` against the existing conversation); its absence MUST select new-chat semantics (`startNewChat` for the first turn, then `sendMessage` against the resulting id). The `new` and `continue` commands MUST obtain this behavior exclusively from the helper and MUST NOT define their own `sendNonInteractive`/`startInteractive` method pairs.

#### Scenario: Non-null message sends one shot

- **WHEN** `startChatSession({ effectiveMessage: "hi", getGeminiClient, logger })` is called
- **THEN** a new chat is started with the message and the model response is printed after a `Model:` label

#### Scenario: Null message starts the REPL

- **WHEN** `startChatSession({ effectiveMessage: null, getGeminiClient, logger })` is called
- **THEN** `runInteractiveLoop` is entered with a `messageHandler` that starts a new chat on the first non-empty line and appends to the resulting conversation id afterwards

#### Scenario: conversationId selects append semantics

- **WHEN** `startChatSession({ effectiveMessage: "follow up", conversationId: "conv-1", getGeminiClient, logger })` is called
- **THEN** the message is sent to the existing `conv-1` conversation and no new chat is created

#### Scenario: new and continue contain no mode-branch duplication

- **WHEN** `src/cli/commands/new-command.ts` and `src/cli/commands/continue-command.ts` are inspected after the change
- **THEN** neither file defines `sendNonInteractive` or `startInteractive` private methods; both dispatch through `startChatSession`

#### Scenario: REPL behavior byte-equivalence is preserved

- **WHEN** `gemiterm new` or `gemiterm continue <id>` is run with no message on a TTY
- **THEN** the banner, prompt, `/exit` / `/quit` handling, empty-line handling, `Model:` labels, and exit-on-Ctrl+C behavior are byte-equivalent to the pre-change baseline

### Requirement: Multi-Profile Listing Resilience

The shared listing helper `listChatsForRequest` in `src/cli/utils/gemini-queries.ts` MUST scope listings as follows: when `profile` is explicitly supplied, the listing targets exactly that profile; otherwise the listing MUST default to **all configured profiles**. The multi-profile fan-out MUST use `Promise.allSettled` semantics: a profile whose listing fails MUST log a warning naming the profile and be skipped, and the remaining profiles' chats MUST be aggregated (merged and sorted by descending timestamp). When every profile fails, the helper MUST resolve with an empty chat list (no unhandled rejection). The `--all-profiles` request flag MUST map onto the same multi-profile path.

#### Scenario: Default listing spans all profiles
- **WHEN** `listChatsForRequest` is called with no `profile` and no `allProfiles`, and profiles `work` and `personal` are configured
- **THEN** the result contains chats from both profiles merged in descending-timestamp order

#### Scenario: One inaccessible profile is skipped with a warning
- **WHEN** the default listing runs and the `broken` profile's listing rejects while `work` succeeds
- **THEN** a warning naming `broken` is logged and the result contains `work`'s chats

#### Scenario: All profiles failing resolves empty
- **WHEN** every configured profile's listing rejects
- **THEN** the helper resolves with `[]` and each failure was logged as a warning

#### Scenario: Explicit profile is honored exactly
- **WHEN** `listChatsForRequest` is called with `profile: "work"`
- **THEN** only the `work` profile's client is queried, with no fan-out

### Requirement: ListCommand reactive phantom detection
The single-profile list flow MUST, when `listChats` resolves zero conversations, first consult the auth facade's rotation state: when `rotationInFlight(profile)` reports a detached rotation in flight, the command MUST print a notice to stderr, await the rotation via the facade's bounded `waitForRotation(profile)`, and — when a refreshed session is resolved — retry the list query exactly once, rendering the retried result when it is non-empty. When the wait resolves `null` while a rotation is still in flight, the command MUST print a stderr hint that a session refresh is still running and the command can be re-run shortly. The rotation-await stage MUST also cover the aggregate default listing (no `--profile`, multiple configured profiles): every configured profile was armed by the fan-out, so the stage awaits every profile whose rotation is in flight (in parallel, each bounded), retries the aggregate query once when any refresh resolves, and names the still-in-flight profiles in the timeout hint. After the rotation-await stage (or when no rotation is in flight), the command MUST invoke the auth facade's read-only session classifier exactly once for that profile — classification remains single-profile-only (explicit `--profile` or exactly one configured profile). When the classification is `live`, the command MUST proceed with the normal empty output and no further auth interaction. When the classification is `phantom` or `dead`, the command MUST offer recovery on a TTY (confirm prompt through the prompt-layer facade, then the auth recovery rung, then retrying the list query exactly once) and MUST print a diagnostic to stderr in non-interactive mode naming the profile, the classified state, and the `gemiterm auth` remedy. The stdout bytes of the non-interactive list output MUST NOT change under any classification or rotation-await outcome — every notice and hint the stage produces goes to stderr. Multi-profile queries MUST NOT invoke the classifier.

#### Scenario: In-flight rotation is awaited and the retry renders

- **WHEN** a single-profile list returns zero chats, the facade reports a rotation in flight, and `waitForRotation` resolves a refreshed session after which the retried list query returns chats
- **THEN** the retried result is rendered and the classifier is never invoked

#### Scenario: Aggregate empty listing awaits every in-flight rotation

- **WHEN** a default aggregate list across configured profiles returns zero chats and one profile's rotation is in flight
- **THEN** only that profile's rotation is awaited, the aggregate query is retried once when the refresh resolves, the retried non-empty result is rendered, and the classifier is never invoked

#### Scenario: Rotation wait timeout falls through with a hint

- **WHEN** a single-profile or aggregate list returns zero chats and `waitForRotation` resolves `null` with the rotation still in flight
- **THEN** a stderr hint naming the still-in-flight profile(s) is printed and the flow proceeds to the classification stage unchanged (single-profile) or the empty output (aggregate)

#### Scenario: No rotation in flight keeps the stage free

- **WHEN** a single-profile list returns zero chats and the facade reports no rotation in flight
- **THEN** no wait notice is printed, `waitForRotation` is not awaited for the common path, and the classification stage runs exactly as before

#### Scenario: Phantom result triggers one classification and one recovery retry

- **WHEN** a single-profile list returns zero chats, the rotation-await stage yields no refreshed retry, the classifier reports `phantom`, and the user accepts the recovery prompt
- **THEN** exactly one classification, one recovery rung, and one list retry occur, and the retried result is rendered

#### Scenario: Genuinely empty account does not recover

- **WHEN** a single-profile list returns zero chats and the classifier reports `live`
- **THEN** the normal empty output is printed with no recovery prompt

#### Scenario: Non-interactive stdout stays byte-identical

- **WHEN** a single-profile list returns zero chats with the classifier reporting `phantom` in a non-TTY run
- **THEN** stdout matches the pre-existing empty-list output byte-for-byte and every diagnostic (rotation notices, hints, classification) appears on stderr only

#### Scenario: Multi-profile queries never classify

- **WHEN** an aggregate list runs across profiles and one profile returns zero chats
- **THEN** the classifier is not invoked for any profile

### Requirement: StatusCommand --verbose session probe
`StatusCommand` MUST accept a `--verbose` flag. When set, it MUST probe each profile sequentially through the auth facade's read-only classifier and render a PROBE column showing `live (N)` (with the probe's chat count), `phantom`, or `dead` per profile. The probe MUST NOT rotate cookies, write storage, or open a browser. Without `--verbose`, the command MUST perform zero probes and its output MUST be byte-identical to the pre-change form.

#### Scenario: Verbose renders per-profile probe states
- **WHEN** `status --verbose` runs with fake classifier states `live (3)`, `phantom`, `dead` for three profiles
- **THEN** the rendered table contains a PROBE column with those three values in profile order

#### Scenario: Default status is unchanged
- **WHEN** `status` runs without `--verbose`
- **THEN** no classifier call occurs and the output contains no PROBE column, byte-identical to the pre-change output

#### Scenario: Probe is read-only
- **WHEN** `status --verbose` probes any profile state
- **THEN** no cookie write and no browser session occurs for any profile

### Requirement: Read commands await an in-flight detached rotation before surfacing auth failure
The single-profile read commands (`fetch`, `export`, `export-all`, `continue`) MUST, when their read operation has already failed for the resolved profile (typed authentication error or empty read — the exact predicate per command MUST be justified against the observed field failure shape recorded in `await-detached-rotation-on-empty-list` task 5.1, whose gate passed 2026-08-18; field data so far: `listChats` on a phantom jar resolves an empty array without error) and the auth facade reports a rotation in flight, print a notice to stderr, await the rotation via the facade's bounded `waitForRotation(profile)` (90 s default, at or above the runner's 60 s rotate budget), and retry the failed operation exactly once when a refreshed session resolves. The retry MUST execute against the refreshed credentials: when the armed `__Secure-1PSIDTS` differs from the value the process-cached default client was constructed with, the client MUST be re-armed (reconstructed from the refreshed jar) before the retry runs — a retry that reuses a client baked with the superseded pre-rotation `__Secure-1PSIDTS` does not satisfy this requirement. On wait timeout — the rotation remains in flight — the command MUST print the stderr hint that a session refresh is still running and then proceed with its existing failure handling unchanged; a still-failing retry after a landed rotation proceeds to the existing failure handling without the hint (the rotation has landed, so a "still running" message would be false). The happy path MUST NOT consult the rotation state, and every notice and hint MUST go to stderr only — each command's stdout/output contract is unchanged.

#### Scenario: Failed fetch awaits the rotation and retries once
- **WHEN** `fetch <id>` fails for the resolved profile with the facade reporting a rotation in flight, and the retried fetch after `waitForRotation` succeeds
- **THEN** the conversation renders and no authentication error surfaces

#### Scenario: Retry executes on the refreshed jar, not the cached stale client
- **WHEN** `fetch <id>` fails empty on a phantom jar, the rotation lands (armed `__Secure-1PSIDTS` changes), and the retry runs in the same process
- **THEN** the retry is issued through a client armed with the refreshed `__Secure-1PSIDTS` (the process-cached default client is invalidated on the PSIDTS change), and the conversation renders on the first process — no second invocation required

#### Scenario: Wait timeout falls through to the existing failure handling
- **WHEN** a read command's operation fails, the rotation await times out, and the retry is not attempted
- **THEN** the stderr hint is printed and the command's pre-existing failure output and exit code are unchanged

#### Scenario: Happy path never consults the rotation state
- **WHEN** a read command succeeds on its first attempt
- **THEN** `rotationInFlight` is never called and no wait occurs

#### Scenario: Unchanged jar keeps the cached client
- **WHEN** `getGeminiClient` is called repeatedly with the armed `__Secure-1PSIDTS` unchanged
- **THEN** the same client instance is returned (no reconstruction, no extra init) and the happy path observes zero added latency

### Requirement: ContinueCommand explicit-profile routing reaches stale profiles
The `continue` command MUST route its optional `--profile/-p <name>` through the same explicit-profile ladder as `fetch`: configured-profile validation, arm (`ensureSession`), bounded await of an in-flight detached rotation when the jar armed stale (stderr notice only), one reclassification, then proceed when live. Still not live: interactively, a recovery confirm mirroring the `list` command's; non-interactively, a typed `AuthenticationError` naming the profile's state and remediation — never a silent fallback to the default profile. Auto-discovered routing (no `-p`) uses `findProfileForConversation` (stale-aware second pass per the auth capability); single-profile setups are unchanged.

#### Scenario: Continue on a stale explicit profile awaits rotation
- **WHEN** the user runs `gemiterm continue conv-abc123 "hello" -p stale` and `stale`'s in-flight rotation lands within the wait ceiling
- **THEN** the message is sent via the `stale` profile's client on the refreshed jar

#### Scenario: Continue never silently falls back to the default profile
- **WHEN** the user runs `gemiterm continue conv-abc123 -p stale` in a non-interactive context and `stale` classifies non-live after the wait
- **THEN** the command throws `AuthenticationError` naming `stale` and exits non-zero; the default profile's client is NOT invoked

### Requirement: ListCommand awaits stale profiles even when live siblings return chats
The aggregate `list` fan-out MUST evaluate per-profile outcomes (chats or error per profile). When any profile yields zero chats or a rejected query while its detached rotation is in flight, the command MUST print the stderr-only `Session refresh in progress` notice, await those profiles' rotations (bounded), and re-query only those profiles, merging the results. Live profiles MUST NOT be re-queried and MUST NOT observe added latency. Stdout bytes for scenarios where no stale profile exists MUST remain byte-identical to the pinned contract (`tests/integration/commands/list.test.ts`).

#### Scenario: One live profile masks no longer — stale sibling's chats appear after its rotation lands
- **WHEN** profiles `live` (returns 14 chats) and `stale` (armed stale, rotation in flight, would return 0 chats pre-rotation) are both configured and the user runs `gemiterm list`
- **THEN** a stderr notice is printed, `stale`'s rotation is awaited, `stale` alone is re-queried, and the merged table includes both profiles' chats

#### Scenario: All-fresh fan-out is byte-identical
- **WHEN** every configured profile armed fresh (no rotation in flight) and the user runs `gemiterm list`
- **THEN** no stderr rotation notice is printed, no re-query occurs, and stdout bytes match the pinned non-interactive output exactly

#### Scenario: Stale profile whose rotation does not land gets the still-in-flight hint
- **WHEN** a stale-armed profile's rotation exceeds the wait ceiling during `gemiterm list`
- **THEN** the existing still-in-progress stderr hint names that profile, the merged (partial) results render, and the command exits without error

