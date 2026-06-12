## ADDED Requirements

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

The `ListCommand` MUST reject combinations of `--interactive` with `--format` or `--path`. The rejection MUST print `Cannot use --interactive with --format or --path.` to stderr and exit with code 1.

#### Scenario: --interactive with --format errors
- **WHEN** the user runs `gemiterm list -i --format json`
- **THEN** the command prints `Cannot use --interactive with --format or --path.` to stderr
- **AND** the process exits with code 1

#### Scenario: --interactive with --path errors
- **WHEN** the user runs `gemiterm list -i --path out.txt`
- **THEN** the command prints `Cannot use --interactive with --format or --path.` to stderr
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
- `gemiterm list --path <p>` MUST write the rendered output to the path and print a confirmation line.

#### Scenario: Default list is the 4-column text table
- **WHEN** the user runs `gemiterm list` (no flags)
- **THEN** the output is the same 4-column text table that the pre-change `list` command emitted

#### Scenario: --format json is the same JSON document
- **WHEN** the user runs `gemiterm list --format json`
- **THEN** the output is the same `{ chats: ChatInfo[] }` JSON document that the pre-change `list` command emitted

#### Scenario: --help documents --interactive
- **WHEN** the user runs `gemiterm list --help`
- **THEN** the output contains a `--interactive, -i` flag description in the existing flag list
