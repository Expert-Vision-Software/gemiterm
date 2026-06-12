## MODIFIED Requirements

### Requirement: ListCommand

The system MUST provide a `list` command implemented by `ListCommand` in `src/cli/commands/list-command.ts`. The command MUST be registered under the name `list` and MUST send a `ListChatsQuery` to the mediator with a payload of shape `{ limit?, offset?, search?, allProfiles }`. The command MUST support the flags `--limit/-n <N>` (no default; omitting `--limit` returns every conversation returned by the mediator), `--offset <N>` (default 0), `--all-profiles`, `--sort <recent|oldest|alpha>` (default `recent`), `--search/-s <query>`, `--after <date>`, `--before <date>`, `--format/-f <text|json>` (default `text`), and `--path/-p <path>`. When `--limit N` is supplied, the command MUST additionally slice the result set to `[offset, offset + N)`. When `--limit` is omitted, the command MUST NOT slice; the entire mediator result is rendered. When `--limit` is omitted and `--offset N` is supplied with `N > 0`, the command MUST slice the result set to `[N, ∞)`. The `--all-profiles` flag MUST be propagated into the mediator payload as `allProfiles: true`. The `list` command MUST NOT support a `--all` flag (omitting `--limit` is the canonical way to request every conversation).

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

#### Scenario: List with --path writes the rendered output to the given file
- **WHEN** the user runs `gemiterm list --path ./out.txt`
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

## REMOVED Requirements

### Requirement: ListCommand --all flag

**Reason:** `--all` was a redundant synonym for omitting `--limit`. Removing it eliminates the duplicated flag and clarifies that the absence of `--limit` is the canonical "give me everything" form.

**Migration:** users of the old `gemiterm list --all` should drop the `--all` token; the behavior is identical to `gemiterm list` (no flags).
