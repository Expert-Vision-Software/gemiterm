## Purpose

This capability defines the interactive chat-list browser for the `gemiterm list` command. The browser is an opt-in TUI (entered via `gemiterm list --interactive` or `gemiterm list -i`) that lets a human user navigate their Gemini conversations, toggle the sort order, narrow the list to a specific profile (or all profiles), narrow the list to favourites only, and pick one to view / export / copy. The browser is built on `@inquirer/core`'s `createPrompt` + `useKeypress` primitives, accessed through the `prompts.browser` facade in `src/cli/utils/prompts.ts`. Title rendering goes through the `truncateTitle` helper (see the truncation requirement below).

**Status:** TBD

## Requirements

### Requirement: Browser SHALL truncate long titles with an ellipsis

The browser SHALL truncate `chat.title` to 55 visible characters when rendering each row, and SHALL append the `…` (U+2026 HORIZONTAL ELLIPSIS) character to signal that the title has been truncated. A title of 55 characters or fewer MUST be rendered unchanged. The truncated form MUST be 55 characters total (54 source characters + the `…` glyph). The truncation MUST be applied in `src/cli/utils/prompts.ts` via the `truncateTitle` helper before chalk styling.

#### Scenario: Short titles render unchanged
- **WHEN** a chat has a `title` shorter than 55 characters
- **THEN** the browser renders the full title in the row, with no ellipsis

#### Scenario: Exactly 55-char titles render unchanged
- **WHEN** a chat has a `title` of exactly 55 characters
- **THEN** the browser renders the full title in the row, with no ellipsis

#### Scenario: Long titles are truncated to 55 chars + ellipsis
- **WHEN** a chat has a `title` longer than 55 characters
- **THEN** the browser renders the first 54 characters of the title followed by `…`, for a total of 55 characters
- **AND** the remaining characters of the original title are not visible in the row

#### Scenario: 56-char title truncates to 54 chars + ellipsis
- **WHEN** a chat has a `title` of exactly 56 characters
- **THEN** the browser renders the first 54 characters of the title followed by `…`

#### Scenario: Truncation is visible in the rendered row
- **WHEN** the browser renders a page that contains a chat whose `title` is 80 characters
- **THEN** the visible screen output contains the truncated 54-character prefix and the `…` glyph
- **AND** the full 80-character title is NOT present in the screen output (it has been replaced by the truncated form)

#### Scenario: Truncation does not affect the action menu
- **WHEN** a user picks a truncated chat and the action menu is shown
- **THEN** the action menu's `Selected: <id> — "<title>"` line displays the full un-truncated title

### Requirement: Chat-list browser SHALL be opt-in via the `--interactive` flag

The `list` command SHALL accept a `--interactive/-i` flag. When the flag is set, the command SHALL enter the chat-list browser instead of rendering the text table. The flag SHALL have no effect on the byte-for-byte content of the non-interactive output paths.

#### Scenario: --interactive enters the TUI on a TTY
- **WHEN** the user runs `gemiterm list --interactive` on a TTY
- **THEN** the command enters the chat-list browser
- **AND** no text table is written to stdout

#### Scenario: --interactive short flag is equivalent
- **WHEN** the user runs `gemiterm list -i`
- **THEN** the command behaves identically to `gemiterm list --interactive`

#### Scenario: --interactive conflicts with --format
- **WHEN** the user runs `gemiterm list -i --format json`
- **THEN** the command prints `Cannot use --interactive with --format or --out.` to stderr
- **AND** the process exits with code 1

#### Scenario: --interactive conflicts with --out
- **WHEN** the user runs `gemiterm list -i --out out.txt`
- **THEN** the command prints `Cannot use --interactive with --format or --out.` to stderr
- **AND** the process exits with code 1

#### Scenario: --interactive requires a TTY
- **WHEN** the user runs `gemiterm list -i` and `process.stdin.isTTY` is not `true`
- **THEN** the facade throws `NonInteractiveError` whose message contains `gemiterm list -i requires a TTY` and the hint `use --format json for machine-readable output`
- **AND** the process exits with code 1

#### Scenario: --interactive --sort pre-selects the sort
- **WHEN** the user runs `gemiterm list -i --sort alpha`
- **THEN** the TUI opens with the list sorted alphabetically by title

### Requirement: Chat-list browser SHALL display the list with cursor navigation

The browser SHALL render the chat list as a table with the columns `ID`, `DATE`, `TITLE`, and `PIN` (and `PROFILE` when `--all-profiles` is set). The browser SHALL render every filtered row in a single scrollable view (no paging; the entire filtered list is always in the body). The user navigates the list with the `↑` and `↓` arrow keys. A cursor indicator (`> `) SHALL mark the active row; the active row's index MUST be clamped to `[0, filteredSorted.length - 1]` and MUST NOT wrap at the ends. The title bar MUST show the total chat count, the current sort mode, the current profile filter, and the current favourites state. The browser SHALL recognise `s` to cycle the sort mode, `p` to cycle the profile filter, and `f` to toggle the favourites filter (each described in its own requirement below).

#### Scenario: Browser renders the chat list
- **WHEN** the browser opens against a mediator returning N chats
- **THEN** all N chats are visible in the body
- **AND** the cursor (`> `) marks the first row
- **AND** the title bar shows the chat count, the sort mode, the profile filter, and the favourites state

#### Scenario: Down arrow moves the cursor
- **WHEN** the user presses `↓`
- **THEN** the cursor moves to the next row
- **AND** when the cursor is on the last row, pressing `↓` is a no-op (it stays on the last row)

#### Scenario: Up arrow moves the cursor
- **WHEN** the user presses `↑`
- **THEN** the cursor moves to the previous row
- **AND** when the cursor is on the first row, pressing `↑` is a no-op

#### Scenario: Empty list shows the empty message
- **WHEN** the mediator returns an empty `chats` array
- **THEN** the browser displays `No conversations found.`
- **AND** the cursor has no row to land on
- **AND** pressing `enter` is a no-op
- **AND** pressing `q` or `esc` resolves the prompt with `{ kind: 'quit' }`
- **AND** the `s`, `p`, and `f` toggles still function (so the user can recover from a filter combo that produces no matches in the non-empty case)

### Requirement: Chat-list browser SHALL cycle the sort mode with `s`

Pressing `s` SHALL cycle the sort mode in the order `recent` → `oldest` → `alpha` → `recent`. The current sort mode SHALL be reflected in the title bar. The cursor SHALL remain on the same row index when the sort changes, clamped to the new list length. The cycle SHALL be live: no sub-menu is shown, the list re-renders in place.

#### Scenario: s cycles through the three sort modes
- **WHEN** the user presses `s` repeatedly
- **THEN** the sort mode cycles `recent` → `oldest` → `alpha` → `recent`, with each press advancing by one step

#### Scenario: s updates the title bar
- **WHEN** the user presses `s`
- **THEN** the title bar reflects the new sort mode (e.g. `Sort: oldest`)

#### Scenario: s keeps the cursor on the same row index
- **WHEN** the user is on row index `i` and presses `s`
- **THEN** after the re-sort, the cursor is on the new row index `min(i, newLength - 1)`

#### Scenario: s works even when the visible list is empty
- **WHEN** the visible list is empty
- **THEN** pressing `s` still cycles the sort mode (so the user can prepare a different sort order before turning off a narrowing filter)

### Requirement: Chat-list browser SHALL cycle the profile filter with `p`

Pressing `p` SHALL cycle the profile filter through the values `["all", ...uniqueProfileNames]`, where `uniqueProfileNames` is the deduplicated list of `chat.profile` values found in the input chats, in the order they first appear. The default initial value SHALL be `all`. The cycle SHALL wrap: pressing `p` on the last profile returns to `all`. The current profile filter SHALL be reflected in the title bar. When the cycle has only one element (`all` — i.e. no chat has a `profile` field), `p` SHALL be a no-op. The `p` key SHALL work even when the visible list is empty, so the user can recover from a filter combination that produced no matches.

#### Scenario: p cycles through all and each profile
- **WHEN** the user has chats from `work` and `personal` profiles
- **THEN** pressing `p` advances the profile filter through `all` → `work` → `personal` → `all`

#### Scenario: p narrows the visible list to the selected profile
- **WHEN** the profile filter is set to a specific profile name
- **THEN** the visible list is restricted to chats whose `chat.profile` matches that name

#### Scenario: p wraps from the last profile back to all
- **WHEN** the profile filter is on the last profile in the cycle
- **THEN** pressing `p` returns the filter to `all`

#### Scenario: p is a no-op when no chats have a profile field
- **WHEN** none of the input chats have a `profile` field
- **THEN** the cycle is `["all"]` and pressing `p` keeps the filter at `all`

#### Scenario: p works even when the visible list is empty
- **WHEN** the visible list is empty (e.g. favourites-only is on and the chosen profile has no pinned chats)
- **THEN** pressing `p` still cycles the profile filter, allowing the user to widen the filter

### Requirement: Chat-list browser SHALL toggle the favourites filter with `f`

Pressing `f` SHALL toggle the favourites filter on and off. When on, the visible list SHALL be restricted to chats where `chat.isPinned === true`. When off, the favourites restriction SHALL be removed. The current favourites state SHALL be reflected in the title bar. The toggle SHALL work even when the visible list is empty, so the user can recover from a filter combination that produced no matches.

#### Scenario: f toggles favourites filter on and off
- **WHEN** the user presses `f` once
- **THEN** the favourites filter turns on and the visible list narrows to pinned chats
- **WHEN** the user presses `f` again
- **THEN** the favourites filter turns off and the visible list is restored

#### Scenario: f updates the title bar
- **WHEN** the user presses `f`
- **THEN** the title bar reflects the new favourites state (e.g. `Favorites: on`)

#### Scenario: f combines with the profile filter
- **WHEN** the profile filter is set to a specific profile and the favourites filter is on
- **THEN** the visible list contains only chats from that profile that are also pinned

#### Scenario: f works even when the visible list is empty
- **WHEN** the visible list is empty because the favourites filter is on and no chats are pinned
- **THEN** pressing `f` still toggles the filter off, restoring the full list

### Requirement: Chat-list browser SHALL show an action menu after a chat is picked

When the user presses `enter` on a highlighted chat, the browser SHALL resolve with `{ kind: 'pick', chat, action: <pending> }` and the caller SHALL show a `prompts.select` action menu with five options: `View full conversation`, `Export to Markdown`, `Export to JSON`, `Copy conversation ID`, `Back to list`. After the user picks an action, the action SHALL execute and the loop SHALL re-enter the browser.

#### Scenario: enter on a chat opens the action menu
- **WHEN** the user navigates to a chat and presses `enter`
- **THEN** the browser prompt resolves with `{ kind: 'pick', chat, action: <pending> }`
- **AND** the caller shows the action menu titled `Selected: <id> — "<title>"`

#### Scenario: View action invokes fetch
- **WHEN** the user selects `View full conversation` from the action menu
- **THEN** the caller invokes `FetchCommand` against the picked `chat.id`
- **AND** the loop re-enters the browser after the fetch returns

#### Scenario: Export to Markdown action writes a file
- **WHEN** the user selects `Export to Markdown` from the action menu
- **THEN** the caller invokes `ExportCommand` with `format: 'markdown'` against the picked `chat.id`
- **AND** the loop re-enters the browser after the export completes

#### Scenario: Export to JSON action writes a file
- **WHEN** the user selects `Export to JSON` from the action menu
- **THEN** the caller invokes `ExportCommand` with `format: 'json'` against the picked `chat.id`
- **AND** the loop re-enters the browser after the export completes

#### Scenario: Copy conversation ID action prints the id
- **WHEN** the user selects `Copy conversation ID` from the action menu
- **THEN** the caller prints `Copied: <chat.id>` to stdout
- **AND** the loop re-enters the browser

#### Scenario: Back to list returns to the browser
- **WHEN** the user selects `Back to list` (or presses `esc`) from the action menu
- **THEN** no action is executed
- **AND** the loop re-enters the browser

#### Scenario: Action menu quit exits the loop
- **WHEN** the user selects `Quit` from the action menu
- **THEN** the browser loop exits
- **AND** the process exits with code 0

### Requirement: Chat-list browser SHALL exit cleanly on quit signals

The browser SHALL exit cleanly on `q`, `esc`, or `Ctrl+C`, resolving the prompt with `{ kind: 'quit' }`. The CLI top-level handler SHALL exit with code 0.

#### Scenario: q quits the browser
- **WHEN** the user presses `q`
- **THEN** the browser prompt resolves with `{ kind: 'quit' }`
- **AND** the process exits with code 0

#### Scenario: esc quits the browser
- **WHEN** the user presses `esc`
- **THEN** the browser prompt resolves with `{ kind: 'quit' }`
- **AND** the process exits with code 0

#### Scenario: Ctrl+C quits the browser
- **WHEN** the user presses `Ctrl+C`
- **THEN** the browser prompt rejects with `CancellationError`
- **AND** the facade maps it to the prompt's `{ kind: 'quit' }` resolution
- **AND** the process exits with code 0

### Requirement: Chat-list browser SHALL preserve the non-interactive contract

The non-interactive forms of `gemiterm list` SHALL remain byte-equivalent to the previous baseline. The `--interactive` flag SHALL be the only entry point to the TUI. The flag SHALL be added without changing the default output of `gemiterm list` (no flags), the JSON output of `gemiterm list --format json`, the file output of `gemiterm list --out out.txt`, or any other existing flag's behaviour. The `--search` flag, when used with `--interactive`, SHALL be forwarded to the mediator (the browser receives the mediator-filtered list) but SHALL NOT pre-fill a browser-side search input — there is no browser-side search input.

#### Scenario: gemiterm list (no flags) is unchanged
- **WHEN** the user runs `gemiterm list` without `--interactive` (and without `--format`, `--out`, etc.)
- **THEN** the output is the same 4-column text table (`ID` / `TITLE` / `DATE` / `PIN`) that the pre-change `list` command emitted

#### Scenario: gemiterm list --format json is unchanged
- **WHEN** the user runs `gemiterm list --format json` without `--interactive`
- **THEN** the output is the same `{ chats: ChatInfo[] }` JSON document that the pre-change `list` command emitted

#### Scenario: gemiterm list --search is unchanged
- **WHEN** the user runs `gemiterm list --search "foo"` without `--interactive`
- **THEN** the mediator payload carries `search: "foo"` and the output is the filtered text table

#### Scenario: gemiterm list --out is unchanged
- **WHEN** the user runs `gemiterm list --out out.txt` without `--interactive`
- **THEN** the rendered output is written to `out.txt` and a confirmation line `Output written to: <resolved>` is printed

#### Scenario: gemiterm list --interactive --search forwards the search to the mediator
- **WHEN** the user runs `gemiterm list -i --search "foo"`
- **THEN** the `ListChatsQuery` payload carries `search: "foo"` and the browser receives the mediator-filtered chats as its `chats` argument
- **AND** the browser does not pre-fill a search input (there is no such input in the redesigned browser)
