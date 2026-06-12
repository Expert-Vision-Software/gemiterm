## Purpose

This capability defines the interactive chat-list browser for the `gemiterm list` command. The browser is an opt-in TUI (entered via `gemiterm list --interactive` or `gemiterm list -i`) that lets a human user page through their Gemini conversations, sort them interactively, filter them with a live search input, and pick one to view / export / copy. The browser is built on `@inquirer/core`'s `createPrompt` + `usePagination` + `useKeypress` primitives, accessed through the `prompts.browser` facade in `src/cli/utils/prompts.ts`.

**Status:** TBD

## ADDED Requirements

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
- **THEN** the command prints `Cannot use --interactive with --format or --path.` to stderr
- **AND** the process exits with code 1

#### Scenario: --interactive conflicts with --path
- **WHEN** the user runs `gemiterm list -i --path out.txt`
- **THEN** the command prints `Cannot use --interactive with --format or --path.` to stderr
- **AND** the process exits with code 1

#### Scenario: --interactive requires a TTY
- **WHEN** the user runs `gemiterm list -i` and `process.stdin.isTTY` is not `true`
- **THEN** the facade throws `NonInteractiveError` whose message contains `gemiterm list -i requires a TTY` and the hint `use --format json for machine-readable output`
- **AND** the process exits with code 1

#### Scenario: --interactive --search pre-fills the filter
- **WHEN** the user runs `gemiterm list -i --search "react"`
- **THEN** the TUI opens with the filter `"react"` already applied
- **AND** the visible list is narrowed to chats whose title contains `"react"` (case-insensitive)

#### Scenario: --interactive --sort pre-selects the sort
- **WHEN** the user runs `gemiterm list -i --sort alpha`
- **THEN** the TUI opens with the list sorted alphabetically by title

### Requirement: Chat-list browser SHALL display the list with cursor navigation

The browser SHALL render the chat list as a paginated table with the columns `ID`, `DATE`, `TITLE`, and `PIN` (and `PROFILE` when `--all-profiles` is set). The browser SHALL use `usePagination` with `pageSize: 15` and `loop: true`. A cursor indicator SHALL mark the active row.

#### Scenario: Browser renders the chat list
- **WHEN** the browser opens against a mediator returning 200 chats
- **THEN** the visible page shows the first 15 chats (or fewer if there are < 15)
- **AND** the cursor (`›`) marks the first row
- **AND** the title bar shows `Browse conversations (PageSize: 15 | <total> chats | Sort: <mode>)`

#### Scenario: Down arrow moves the cursor
- **WHEN** the user presses `↓` (or `j` with `keybindings: ['vim']`)
- **THEN** the cursor moves to the next row
- **AND** the visible page slides so the cursor stays in view

#### Scenario: Up arrow moves the cursor
- **WHEN** the user presses `↑` (or `k` with `keybindings: ['vim']`)
- **THEN** the cursor moves to the previous row

#### Scenario: n / p jump by page
- **WHEN** the user presses `n`
- **THEN** the cursor jumps forward by 15 rows
- **WHEN** the user presses `p`
- **THEN** the cursor jumps backward by 15 rows

#### Scenario: g / G jump to top / bottom
- **WHEN** the user presses `g`
- **THEN** the cursor moves to the first row
- **WHEN** the user presses `G`
- **THEN** the cursor moves to the last row

#### Scenario: Cursor wraps at the end (loop: true)
- **WHEN** the user presses `↓` while the cursor is on the last row
- **THEN** the cursor wraps to the first row

#### Scenario: Empty list shows the empty message
- **WHEN** the mediator returns an empty `chats` array
- **THEN** the browser displays `No conversations found.`
- **AND** the cursor has no row to land on
- **AND** pressing `enter`, `/`, or `s` is a no-op
- **AND** pressing `q` or `esc` resolves the prompt with `{ kind: 'quit' }`

### Requirement: Chat-list browser SHALL support interactive sorting

The browser SHALL support an interactive sort sub-menu invoked by pressing `s`. The sub-menu SHALL be a `prompts.select` with three options matching the non-interactive `--sort` flag: `Most recent first` (value `recent`), `Oldest first` (value `oldest`), `Alphabetical` (value `alpha`). The current sort SHALL be marked in the sub-menu prompt.

#### Scenario: s opens the sort menu
- **WHEN** the user presses `s`
- **THEN** a sub-menu appears titled `Sort by` with the three options
- **AND** the current sort mode is marked (e.g. `(current: Most recent first)`)

#### Scenario: Selecting a sort mode updates the list
- **WHEN** the user selects `Oldest first` from the sort menu
- **THEN** the sub-menu closes
- **AND** the list re-renders sorted by `timestamp` ascending
- **AND** the title bar shows `Sort: oldest`
- **AND** the cursor remains on the same row index (clamped to the new list length)

#### Scenario: Selecting a sort mode keeps the same list
- **WHEN** the user selects `Alphabetical` and the filter is non-empty
- **THEN** only the filtered chats are re-sorted
- **AND** the filter is preserved

#### Scenario: esc closes the sort menu without changing the sort
- **WHEN** the user presses `esc` while the sort menu is open
- **THEN** the sub-menu closes
- **AND** the sort mode is unchanged

### Requirement: Chat-list browser SHALL support interactive filtering

The browser SHALL support a live filter input invoked by pressing `/`. The filter SHALL be a substring match (case-insensitive) against `chat.title`. As the user types, the visible list narrows in real time. Pressing `enter` applies the filter and returns to browse mode. Pressing `esc` clears the filter and returns to browse mode with the full list.

#### Scenario: / opens the search input
- **WHEN** the user presses `/`
- **THEN** a search input appears below the message line with the placeholder `Search…`
- **AND** the cursor moves into the search input

#### Scenario: Typing narrows the list
- **WHEN** the user types `react` in the search input
- **THEN** the visible list narrows to chats whose `title` contains `react` (case-insensitive)
- **AND** the narrowing happens on every keystroke

#### Scenario: No matches shows the empty filter message
- **WHEN** the user types `xyzzy` in the search input and no chats match
- **THEN** the visible list shows `No matches`
- **AND** pressing `enter` is a no-op (the empty filter does not resolve the prompt)
- **AND** pressing `esc` clears the filter

#### Scenario: enter applies the filter
- **WHEN** the user types `react` and presses `enter`
- **THEN** the search input closes
- **AND** the list remains narrowed to chats whose title contains `react`
- **AND** the cursor is positioned on the first visible row

#### Scenario: esc clears the filter
- **WHEN** the user presses `esc` while the search input is focused
- **THEN** the search input closes
- **AND** the search term is discarded
- **AND** the visible list is restored to the pre-filter state

#### Scenario: Empty filter shows the full list
- **WHEN** the user types and then deletes all characters, leaving the search input empty
- **THEN** the visible list shows the full unfiltered list
- **AND** the `No matches` message is not shown

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

The non-interactive forms of `gemiterm list` SHALL remain byte-equivalent to the previous baseline. The `--interactive` flag SHALL be the only entry point to the TUI. The flag SHALL be added without changing the default output of `gemiterm list` (no flags), the JSON output of `gemiterm list --format json`, the file output of `gemiterm list --path out.txt`, the search forwarding of `gemiterm list --search foo`, or any other existing flag's behaviour.

#### Scenario: gemiterm list (no flags) is unchanged
- **WHEN** the user runs `gemiterm list` without `--interactive` (and without `--format`, `--path`, etc.)
- **THEN** the output is the same 4-column text table (`ID` / `TITLE` / `DATE` / `PIN`) that the pre-change `list` command emitted

#### Scenario: gemiterm list --format json is unchanged
- **WHEN** the user runs `gemiterm list --format json` without `--interactive`
- **THEN** the output is the same `{ chats: ChatInfo[] }` JSON document that the pre-change `list` command emitted

#### Scenario: gemiterm list --search is unchanged
- **WHEN** the user runs `gemiterm list --search "foo"` without `--interactive`
- **THEN** the mediator payload carries `search: "foo"` and the output is the filtered text table

#### Scenario: gemiterm list --path is unchanged
- **WHEN** the user runs `gemiterm list --path out.txt` without `--interactive`
- **THEN** the rendered output is written to `out.txt` and a confirmation line `Output written to: <resolved>` is printed
