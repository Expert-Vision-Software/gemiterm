## MODIFIED Requirements

### Requirement: ListCommand

The system MUST provide a `list` command implemented by `ListCommand` in `src/cli/commands/list-command.ts`. The command MUST be registered under the name `list` and MUST send a `ListChatsQuery` to the mediator with a payload of shape `{ limit?, offset?, search?, allProfiles, profile? }`. The command MUST support the flags `--limit/-n <N>` (no default; omitting `--limit` returns every conversation returned by the mediator), `--offset <N>` (default 0), `--all-profiles`, `--sort <recent|oldest|alpha>` (default `recent`), `--search/-s <query>`, `--after <date>`, `--before <date>`, `--format/-f <text|json>` (default `text`), `--out/-o <path>`, and `--profile/-p <name>`. When `--limit N` is supplied, the command MUST additionally slice the result set to `[offset, offset + N)`. When `--limit` is omitted, the command MUST NOT slice; the entire mediator result is rendered. When `--limit` is omitted and `--offset N` is supplied with `N > 0`, the command MUST slice the result set to `[N, ∞)`. The `--all-profiles` flag MUST be propagated into the mediator payload as `allProfiles: true`. The `--profile <name>` flag MUST be propagated into the mediator payload as `profile: <name>`. The `list` command MUST NOT support a `--all` flag (omitting `--limit` is the canonical way to request every conversation). When `--out <path>` is supplied, the rendered output MUST be written to that file via `infrastructure/io.ts:writeTextFile` and the command MUST print `Output written to: <path>`; otherwise the output MUST be printed to stdout. The command MUST NOT recognize `--path` as an output flag.

#### Scenario: List with no flags returns all conversations

- **WHEN** the user runs `gemiterm list`
- **THEN** the command sends a `ListChatsQuery` to the mediator with `limit: undefined`, `offset: 0`, no `search`, `allProfiles: false`, and `profile: undefined`, and renders every chat returned by the mediator as a 4-column text table (ID / TITLE / DATE / PIN)

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
- **THEN** the output contains `Usage: gemiterm list` and documents every flag above (including `--profile/-p <name>`), and does NOT document a `--all` flag

#### Scenario: List rejects the removed --all flag

- **WHEN** the user runs `gemiterm list --all`
- **THEN** the command leaves the `--all` token in `subcommandArgs` and either ignores it (if argv parsing is tolerant) or rejects it; in either case the output is the same as `gemiterm list` with no flags (every conversation rendered)

## ADDED Requirements

### Requirement: ListCommand --profile flag routes auth to the named profile

When the `--profile/-p <name>` flag is supplied, the `list` command MUST authenticate `<name>` before fetching its conversations. Authentication MUST go through `ProfileAuthManager.ensureAuthenticated(<name>)` (which probes the server session and runs the L1 `rotateCookies` ladder on the valid-probe path), so that any rotation warning, debug log, or auth-failure remediation message names `<name>` — not the default profile. The default profile MUST NOT be authenticated as a side effect. The resulting `GeminiClientService` MUST be the one bound to `<name>` before `listChats` is invoked.

#### Scenario: list -p names the right profile in rotation warnings

- **WHEN** the user runs `gemiterm list -p work` and `<name>`'s `__Secure-1PSIDTS` is stale beyond L1 recovery
- **THEN** any rotation warning, debug log, or auth-related message emitted during the handler invocation names the profile `work`
- **AND** no `ensureAuthenticated` call is observed for the default profile
- **AND** the listChats result is scoped to `work`'s conversations

#### Scenario: list -p uses the named profile's client

- **WHEN** the user runs `gemiterm list -p work` and a `clientService` stub is wired into the handler
- **THEN** `clientService.forProfile` is invoked exactly once with the argument `"work"`
- **AND** `clientService.listChats` is NOT invoked for the default profile in this code path

#### Scenario: list -p on a profile with no stored cookies

- **WHEN** the user runs `gemiterm list -p nonexistent`
- **THEN** the handler raises `AuthenticationError` with a remediation message referencing `gemiterm auth nonexistent` (or equivalent)
- **AND** the default profile is NOT touched as a side effect

### Requirement: ListCommand --all-profiles routes auth per active profile

When the `--all-profiles` flag is supplied, the `list` command MUST authenticate each active profile individually before fetching its conversations. The `ProfileAuthManager.ensureAuthenticated(name)` call MUST run for each profile in the active-profile list; per-profile auth failures MUST be isolated so that one profile's auth failure does not abort the others. The default profile MUST NOT be implicitly authed as a side effect.

#### Scenario: list --all-profiles authenticates each profile individually

- **WHEN** the user runs `gemiterm list --all-profiles` with two active profiles `work` and `personal`
- **THEN** the handler invokes `getGeminiClient` (or `clientService.forProfile`) for `work` and for `personal` separately
- **AND** each profile's `listChats` runs against a client bound to that profile

#### Scenario: list --all-profiles isolates per-profile auth failures

- **WHEN** the user runs `gemiterm list --all-profiles` with two active profiles `work` (auth OK) and `personal` (`AuthenticationError` thrown by `ensureAuthenticated`)
- **THEN** the result list contains `work`'s chats
- **AND** the failure for `personal` is reported via the existing `Promise.allSettled` warning path (not via the default profile)
- **AND** the process exits with code 0 (partial success)