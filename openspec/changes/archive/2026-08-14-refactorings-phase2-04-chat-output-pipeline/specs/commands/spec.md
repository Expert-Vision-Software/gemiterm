## MODIFIED Requirements

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

The system MUST provide a `fetch` command implemented by `FetchCommand` in `src/cli/commands/fetch-command.ts`. The command MUST accept a single optional positional `<conversation_id>` argument and MUST support `--format/-f <text|json>` (default `text`) and `--out/-o <path>`. When a conversation id is provided, the command MUST fetch the conversation via the shared fetch helper (with `resolveProfile` for profile routing). When no conversation id is provided, the command MUST invoke the `list` command via the shared command invoker and return without fetching. All output rendering MUST be delegated to `ChatOutput.render` — the command MUST NOT define its own output helpers or `writeOutput` method. Text output MUST include a header line `Conversation: <id>` and label each message with `User:` or `Model:` depending on role. JSON output MUST be `{ conversationId, messages }`. When `--out <path>` is supplied, the rendered output MUST be written to that file via `infrastructure/io.ts:writeTextFile` and the command MUST print `Output written to: <path>`; otherwise the output MUST be printed to stdout. The command MUST NOT recognize `--path` or `-p` as output flags.

#### Scenario: Fetch with conversation id renders the conversation
- **WHEN** the user runs `gemiterm fetch conv-abc123`
- **THEN** the conversation is fetched and rendered via `ChatOutput.render` with the `Conversation: conv-abc123` header

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
- **THEN** the output contains `Usage: gemiterm fetch [conversation_id] [options]` and documents `--format`, `--out`, and `--help`

#### Scenario: Fetch rendering goes through ChatOutput
- **WHEN** `FetchCommand.execute` runs
- **THEN** output is produced via `ChatOutput.render` and the command file defines no `writeOutput` or output-helper methods

## ADDED Requirements

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
