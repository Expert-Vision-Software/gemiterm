## MODIFIED Requirements

### Requirement: FetchCommand

The system MUST provide a `fetch` command implemented by `FetchCommand` in `src/cli/commands/fetch-command.ts`. The command MUST accept a single optional positional `<conversation_id>` argument and MUST support `--format/-f <text|json>` (default `text`) and `--out/-o <path>`. When a conversation id is provided, the command MUST send a `FetchChatQuery` to the mediator with payload `{ conversationId }`. When no conversation id is provided, the command MUST invoke the `list` command via the `CommandRegistry` and return without sending a fetch query. When `--out <path>` is supplied, the rendered output MUST be written to that file via `infrastructure/io.ts:writeTextFile` and the command MUST print `Output written to: <path>`; otherwise the output MUST be printed to stdout. Text output MUST include a header line `Conversation: <id>` and label each message with `User:` or `Model:` depending on role. JSON output MUST be `{ conversationId, messages }`. The command MUST NOT recognize `--path` or `-p` as output flags.

#### Scenario: Fetch with --out writes the rendered output to the given file

- **WHEN** the user runs `gemiterm fetch conv-abc123 --out ./out.txt`
- **THEN** the rendered text output is written to `./out.txt`
- **AND** the command prints `Output written to: ./out.txt`

#### Scenario: Fetch help documents --out

- **WHEN** the user runs `gemiterm fetch --help`
- **THEN** the output contains `Usage: gemiterm fetch [conversation_id] [options]` and documents `--format`, `--out`, and `--help`

### Requirement: ListCommand flags

The system MUST provide a `list` command implemented by `ListCommand` in `src/cli/commands/list-command.ts`. The command MUST be registered under the name `list` and MUST send a `ListChatsQuery` to the mediator with a payload of shape `{ limit?, offset?, search?, allProfiles }`. The command MUST support the flags `--limit/-n <N>`, `--offset <N>` (default 0), `--all-profiles`, `--sort <recent|oldest|alpha>` (default `recent`), `--search/-s <query>`, `--after <date>`, `--before <date>`, `--format/-f <text|json>` (default `text`), and `--out/-o <path>`. When `--out <path>` is supplied, the rendered output MUST be written to that file via `infrastructure/io.ts:writeTextFile` and the command MUST print `Output written to: <path>`; otherwise the output MUST be printed to stdout. The command MUST NOT recognize `--path` or `-p` as output flags.

#### Scenario: List with --out writes the rendered output to the given file

- **WHEN** the user runs `gemiterm list --out ./out.txt`
- **THEN** the rendered output is written to `./out.txt`
- **AND** the command prints `Output written to: ./out.txt`

### Requirement: ListCommand interactive conflict

The `ListCommand` MUST reject combinations of `--interactive` with `--format` or `--out`. The rejection MUST print `Cannot use --interactive with --format or --out.` to stderr and exit with code 1.

#### Scenario: --interactive with --out errors

- **WHEN** the user runs `gemiterm list -i --out out.txt`
- **THEN** the command prints `Cannot use --interactive with --format or --out.` to stderr

### Requirement: ExportCommand

The system MUST provide an `export` command implemented by `ExportCommand` in `src/cli/commands/export-command.ts`. The command MUST accept a single positional `<conversation_id>` argument and MUST support `--out/-o <path>`, `--format/-f <markdown|json>` (default `markdown`), `--include-metadata`, and `--help/-h`. The command MUST send a `FetchChatQuery` to the mediator with `payload.conversationId` and MUST write the formatted output to the path supplied by `--out` or, when `--out` is not set, to a default file in the current working directory named `gemini-chat-<conversation_id>-<YYYY-MM-DD>.<ext>` (where `ext` is `md` for markdown and `json` for json). The command MUST create the output directory (and any parents) before writing. Markdown output MUST be produced by `formatChatAsMarkdown` and JSON output MUST be produced by `formatChatAsJson`. When `<conversation_id>` is missing or invalid, the command MUST print an error and exit with code 1. The command MUST NOT recognize `--output` as a flag.

#### Scenario: Export with --out writes to the supplied path

- **WHEN** the user runs `gemiterm export conv-abc123 --out ./out.md`
- **THEN** the markdown export is written to `./out.md`

#### Scenario: Export help documents --out

- **WHEN** the user runs `gemiterm export --help`
- **THEN** the output contains `Usage: gemiterm export <conversation_id> [options]` and documents `--out`, `--format`, `--include-metadata`, and `--help`

### Requirement: ExportAllCommand

The system MUST provide an `export-all` command implemented by `ExportAllCommand` in `src/cli/commands/export-all-command.ts`. The command MUST support `--out-dir/-o <dir>` (default `./exports`), `--since <date>`, `--include-metadata`, `--all-profiles/-a`, and `--help/-h`. The command MUST send a `ListChatsQuery` to the mediator with payload `{ allProfiles }`, MUST filter the resulting chats to those whose `timestamp` is on or after the `--since` date (when supplied), and MUST iterate over the remaining chats sending a `FetchChatQuery` for each and writing a markdown file per chat under the output directory using `formatChatAsMarkdown` with sanitized filenames of the form `gemini-chat-<sanitized-title>-<YYYY-MM-DD>.md`. The command MUST create the output directory with `mkdirSync(..., { recursive: true })` and MUST write an `index.md` file in the output directory that lists each successfully exported conversation as a markdown link and, when present, a `## Failed Exports` section listing failed exports with their error message. The command MUST print a final summary including `Exported: <n>`, optional `Failed: <n>`, `Output: <dir>`, and `Index: <dir>/index.md`. The command MUST NOT recognize `--output-dir` as a flag.

#### Scenario: Export-all with --out-dir writes under the supplied directory

- **WHEN** the user runs `gemiterm export-all --out-dir ./exports`
- **THEN** each exported markdown file and the `index.md` are written under `./exports`

#### Scenario: Export-all help documents --out-dir

- **WHEN** the user runs `gemiterm export-all --help`
- **THEN** the output documents `--out-dir`, `--since`, `--include-metadata`, `--all-profiles`, and `--help`
