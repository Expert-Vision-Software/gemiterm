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

The browser SHALL render the chat list as a table with the columns `ID`, `DATE`, `TITLE`, and `PIN` (and `PROFILE` when `--all-profiles` is set). The browser SHALL display the filtered list as a **paged, top-aligned window** of `pageSize` rows, where `pageSize` is derived from the terminal height as `max(5, floor((process.stdout.rows - 4) * 0.8))` (with the `?? 24` fallback when `process.stdout.rows` is `undefined`); the `BrowserConfig.pageSize` test override MAY be used to force a specific value in test fixtures. When the filtered list has fewer rows than `pageSize`, every row is shown. The window is **top-aligned**: after paging with `←` / `→`, the cursor lands on the first row of the new page and the visible window shows exactly the items in that page (a clean slice — no overlap with the previous or next page). The window's `windowStart` is tracked as a `useState<number>` and recomputed by the keypress handlers. For `→` / `←` paging, `windowStart` is set to the first index of the new page (`newPage * pageSize`, clamped to `[0, totalPages - 1]`). For `↑` / `↓` navigation, the window stays still while the cursor moves within it, and scrolls by one row when the cursor reaches the bottom (`↓`) or top (`↑`) edge — the cursor lands at the new edge of the scrolled window. `←` on the first page and `→` on the last page are no-ops (the cursor stays on its current row, since the page did not change). The cursor's row index MUST be clamped to `[0, filteredSorted.length - 1]` and MUST NOT wrap at the ends. A cursor indicator (`> `) SHALL mark the active row. The title bar MUST show the total chat count, the current sort mode, the current profile filter, and the current favourites state. When the filtered list spans more than one page, the title bar MUST additionally show a `Page: X/Y` indicator immediately after the chat count, where `Y = ceil(N / pageSize)` (total pages) and `X = min(Y, floor(active / pageSize) + 1)` (the 1-indexed page the active row is in). When the list fits on a single page, the `Page:` indicator MUST be omitted. The hint line MUST advertise the `←` / `→` page keys adjacent to the existing `↑↓ navigate` label. The browser SHALL recognise `s` to cycle the sort mode, `p` to cycle the profile filter, and `f` to toggle the favourites filter (each described in its own requirement below). Pressing `s`, `p`, or `f` MUST reset both the active row index and `windowStart` to `0` (the first row of the re-sorted / re-filtered list); a `useEffect` watching `[filteredSorted]` enforces the same reset for any future list-mutating path.

#### Scenario: Browser opens with the first page as a top-aligned window
- **WHEN** the browser opens against a mediator returning N chats
- **THEN** the visible window is exactly `[0, min(N - 1, pageSize - 1)]` (i.e. the first `pageSize` items, top-aligned, with the cursor on the first item)
- **AND** the cursor (`> `) marks the first row
- **AND** the title bar shows the chat count, the sort mode, the profile filter, and the favourites state
- **AND** when N ≤ `pageSize`, every row is visible

#### Scenario: Down arrow moves the cursor
- **WHEN** the user presses `↓`
- **THEN** the cursor moves to the next row
- **AND** when the cursor is on the last row, pressing `↓` is a no-op (it stays on the last row)

#### Scenario: Up arrow moves the cursor
- **WHEN** the user presses `↑`
- **THEN** the cursor moves to the previous row
- **AND** when the cursor is on the first row, pressing `↑` is a no-op

#### Scenario: Down arrow at the bottom of the window scrolls the window by one row
- **WHEN** the user presses `↓` and the cursor is at the bottom of the visible window
- **THEN** `windowStart` is incremented by 1 (so the cursor is now on the bottom row of the new window)
- **AND** the topmost row of the previous window is no longer visible

#### Scenario: Up arrow at the top of a scrolled window scrolls the window up by one row
- **WHEN** the user presses `↑` and the cursor is at the top of the visible window AND `windowStart > 0`
- **THEN** `windowStart` is decremented by 1 (so the cursor is now on the top row of the new window)
- **AND** the bottommost row of the previous window is no longer visible

#### Scenario: Right arrow pages forward and shows the next page as a clean slice
- **WHEN** the user presses `→` and the current page is not the last page
- **THEN** the active row index and `windowStart` are both set to `(currentPage + 1) * pageSize` (i.e. the first row of the next page)
- **AND** the visible window shows exactly the items in the next page — no item from the previous page is visible
- **AND** the page indicator updates to `Page: (X+1)/Y`

#### Scenario: Left arrow pages backward and shows the previous page as a clean slice
- **WHEN** the user presses `←` and the current page is not the first page
- **THEN** the active row index and `windowStart` are both set to `(currentPage - 1) * pageSize` (i.e. the first row of the previous page)
- **AND** the visible window shows exactly the items in the previous page — no item from the current page is visible
- **AND** the page indicator updates to `Page: (X-1)/Y`

#### Scenario: Right arrow is a no-op on the last page
- **WHEN** the user presses `→` and the cursor is already on the last page
- **THEN** the active row index and `windowStart` do not change
- **AND** the page indicator does not change

#### Scenario: Left arrow is a no-op on the first page
- **WHEN** the user presses `←` and the cursor is already on the first page
- **THEN** the active row index and `windowStart` do not change
- **AND** the page indicator does not change

#### Scenario: pageSize applies the 80% reduction to (rows - 4)
- **WHEN** `process.stdout.rows` is `24`
- **THEN** `pageSize` is `floor((24 - 4) * 0.8) = 16` (i.e. 20% smaller than the un-reduced `(rows - 4)` value of 20)

#### Scenario: pageSize is at least 5 rows
- **WHEN** `process.stdout.rows` is small enough that `floor((rows - 4) * 0.8) < 5` (e.g. `rows` ≤ 10)
- **THEN** `pageSize` is `5` (the floor) and at least 5 rows are visible

#### Scenario: pageSize honors the BrowserConfig override
- **WHEN** `BrowserConfig.pageSize` is a positive integer
- **THEN** the browser uses that value as `pageSize` and ignores `process.stdout.rows`

#### Scenario: Title bar shows Page: X/Y when the list spans multiple pages
- **WHEN** the filtered list spans more than one page (i.e. `ceil(N / pageSize) > 1`)
- **THEN** the title bar contains the substring `Page: 1/Y` immediately after the chat count, where `Y = ceil(N / pageSize)`
- **AND** the indicator updates to `Page: X/Y` where `X = min(Y, floor(active / pageSize) + 1)` as the user pages with `→` or `←`

#### Scenario: Page indicator is hidden when the list fits on a single page
- **WHEN** the filtered list fits on a single page (i.e. `N ≤ pageSize`)
- **THEN** the title bar does NOT contain the substring `Page:`
- **AND** the chat count, sort mode, profile filter, and favourites state are still shown

#### Scenario: Changing the sort resets the cursor and the window to the top
- **WHEN** the user is on any row and presses `s`
- **THEN** the active row index and `windowStart` are both set to `0` (the first row of the re-sorted list)
- **AND** the visible window shifts to the new first page

#### Scenario: Changing the profile filter resets the cursor and the window to the top
- **WHEN** the user is on any row and presses `p`
- **THEN** the active row index and `windowStart` are both set to `0` (the first row of the newly-filtered list)
- **AND** the visible window shifts to the new first page

#### Scenario: Toggling the favorites filter resets the cursor and the window to the top
- **WHEN** the user is on any row and presses `f`
- **THEN** the active row index and `windowStart` are both set to `0` (the first row of the newly-filtered list)
- **AND** the visible window shifts to the new first page

#### Scenario: Empty list shows the empty message
- **WHEN** the mediator returns an empty `chats` array
- **THEN** the browser displays `No conversations found.`
- **AND** the cursor has no row to land on
- **AND** pressing `enter` is a no-op
- **AND** pressing `q` or `esc` resolves the prompt with `{ kind: 'quit' }`
- **AND** pressing `←` or `→` is a no-op (no rows to navigate)
- **AND** the `s`, `p`, and `f` toggles still function (so the user can recover from a filter combo that produces no matches in the non-empty case)

#### Scenario: Hint line advertises the page keys
- **WHEN** the browser renders
- **THEN** the hint line contains the substring `← → page` adjacent to the existing `↑↓ navigate` label

### Requirement: Chat-list browser SHALL cycle the sort mode with `s`

Pressing `s` SHALL cycle the sort mode in the order `recent` → `oldest` → `alpha` → `recent`. The current sort mode SHALL be reflected in the title bar. The cursor SHALL be reset to the first row of the re-sorted list (i.e. `active = 0`); the previous row index is intentionally not preserved across sort changes. The cycle SHALL be live: no sub-menu is shown, the list re-renders in place.

#### Scenario: s cycles through the three sort modes
- **WHEN** the user presses `s` repeatedly
- **THEN** the sort mode cycles `recent` → `oldest` → `alpha` → `recent`, with each press advancing by one step

#### Scenario: s updates the title bar
- **WHEN** the user presses `s`
- **THEN** the title bar reflects the new sort mode (e.g. `Sort: oldest`)

#### Scenario: s resets the cursor to the top of the new sort
- **WHEN** the user is on any row and presses `s`
- **THEN** after the re-sort, the cursor is on the first row of the new sort (i.e. the new row index `0`)

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

When the user presses `enter` on a highlighted chat, the browser SHALL resolve with `{ kind: 'pick', chat, action: <pending> }` and the caller SHALL show a `prompts.select` action menu with seven options, in this order: `View full conversation`, `Export to Markdown`, `Export to JSON`, `Copy conversation ID`, `Delete conversation`, `Back to list`, `Quit`. The `Delete conversation` option SHALL display a `No confirmation` description adjacent to its label. After the user picks an action, the action SHALL execute and the loop SHALL re-enter the browser.

#### Scenario: enter on a chat opens the action menu
- **WHEN** the user navigates to a chat and presses `enter`
- **THEN** the browser prompt resolves with `{ kind: 'pick', chat, action: <pending> }`
- **AND** the caller shows the action menu titled `Selected: <id> — "<title>"`

#### Scenario: action menu lists all seven options in the documented order
- **WHEN** the caller shows the action menu
- **THEN** the choice list contains exactly seven entries with values `view`, `export-markdown`, `export-json`, `copy-id`, `delete`, `back`, `quit` in that order
- **AND** the `delete` entry's label is `Delete conversation` and its description is `No confirmation`

#### Scenario: View action invokes fetch
- **WHEN** the user selects `View full conversation` from the action menu
- **THEN** the caller invokes `FetchCommand` against the picked `chat.id`
- **AND** the loop re-enters the browser after the fetch returns

#### Scenario: Export to Markdown action writes a file
- **WHEN** the user selects `Export to Markdown` from the action menu
- **THEN** the caller prompts for an output path (see the *Export action prompts for an output path* requirement)
- **AND** the caller invokes `ExportCommand` with `format: 'markdown'` and `--out <path>` against the picked `chat.id`
- **AND** the loop re-enters the browser after the export completes

#### Scenario: Export to JSON action writes a file
- **WHEN** the user selects `Export to JSON` from the action menu
- **THEN** the caller prompts for an output path (see the *Export action prompts for an output path* requirement)
- **AND** the caller invokes `ExportCommand` with `format: 'json'` and `--out <path>` against the picked `chat.id`
- **AND** the loop re-enters the browser after the export completes

#### Scenario: Copy conversation ID action prints the id
- **WHEN** the user selects `Copy conversation ID` from the action menu
- **THEN** the caller prints `Copied: <chat.id>` to stdout
- **AND** the loop re-enters the browser

#### Scenario: Delete conversation action invokes delete with --force
- **WHEN** the user selects `Delete conversation` from the action menu
- **THEN** the caller invokes `DeleteCommand` with `--force` against the picked `chat.id` (see the *Delete action bypasses confirmation* requirement)
- **AND** the loop re-enters the browser after the delete completes

#### Scenario: Back to list returns to the browser
- **WHEN** the user selects `Back to list` (or presses `esc`) from the action menu
- **THEN** no action is executed
- **AND** the loop re-enters the browser

#### Scenario: Action menu quit exits the loop
- **WHEN** the user selects `Quit` from the action menu
- **THEN** the browser loop exits
- **AND** the process exits with code 0

### Requirement: Export action prompts for an output path

When the user selects `Export to Markdown` or `Export to JSON` from the action menu, the caller SHALL prompt for an output path via `prompts.text` (a single-line `text` input) before invoking `ExportCommand`. The prompt message SHALL be `Output path:`. The prompt's `default` value SHALL be `gemini-chat-<chat.id>-<YYYY-MM-DD>.<ext>`, where `<ext>` is `md` for Markdown and `json` for JSON, and `<YYYY-MM-DD>` is `new Date().toISOString().slice(0, 10)`. The user MAY accept the default (by pressing Enter) or supply a custom path. If the supplied value is empty or whitespace-only, the caller SHALL fall back to the default path. The resolved path SHALL be forwarded to `ExportCommand` as `--out <path>`.

#### Scenario: Export to Markdown prompts with the default markdown filename
- **WHEN** the user selects `Export to Markdown`
- **THEN** the caller calls `text` with message `Output path:` and a default matching `^gemini-chat-<id>-\d{4}-\d{2}-\d{2}\.md$`
- **AND** on user input `<path>`, the caller invokes `ExportCommand` with `["<id>", "--format", "markdown", "--out", "<path>"]`

#### Scenario: Export to JSON prompts with the default json filename
- **WHEN** the user selects `Export to JSON`
- **THEN** the caller calls `text` with message `Output path:` and a default matching `^gemini-chat-<id>-\d{4}-\d{2}-\d{2}\.json$`
- **AND** on user input `<path>`, the caller invokes `ExportCommand` with `["<id>", "--format", "json", "--out", "<path>"]`

#### Scenario: Empty export input falls back to the default filename
- **WHEN** the user submits an empty or whitespace-only path
- **THEN** the caller uses the default `gemini-chat-<id>-<YYYY-MM-DD>.<ext>` as the resolved path
- **AND** `ExportCommand` is invoked with `--out <default>`

#### Scenario: Path prompt requires a TTY
- **WHEN** the user selects Export and `process.stdin.isTTY` is not `true`
- **THEN** `text` throws `NonInteractiveError` whose message contains `gemiterm new "Your message"`
- **AND** the process exits with code 1

### Requirement: Delete action bypasses confirmation

When the user selects `Delete conversation` from the action menu, the caller SHALL invoke `DeleteCommand` with the picked `chat.id` and the `--force` flag. The caller SHALL NOT show the standalone-delete confirmation prompt (`prompts.confirm`); the in-browser delete is one-shot and unconfirmed by design. The `DeleteCommand`'s own profile-resolution and per-id error reporting behavior is unchanged from the standalone `gemiterm delete --force` invocation (errors are logged to stderr; on failure the process exits with code 1).

#### Scenario: Delete dispatches to DeleteCommand with --force
- **WHEN** the user selects `Delete conversation`
- **THEN** the caller invokes `DeleteCommand` with argv `[<chat.id>, "--force"]`
- **AND** the caller does NOT call `prompts.confirm` first

#### Scenario: Delete is unconfirmed by design
- **WHEN** the user selects `Delete conversation`
- **THEN** no confirmation prompt is shown
- **AND** the delete is dispatched immediately, matching the standalone `gemiterm delete <id> --force` behavior

#### Scenario: After delete, the deleted chat is removed from the in-memory list
- **WHEN** the user selects `Delete conversation` and `DeleteCommand` resolves successfully
- **THEN** the caller removes the picked `chat.id` from the in-memory chat list before re-entering the browser
- **AND** the next `browser(...)` call receives the chat list with that id absent
- **AND** the cursor on the re-entered browser starts at the first row of the now-shorter list (the `useEffect` reset on `filteredSorted` in the browser prompt fires because the list reference changed)

#### Scenario: Non-delete actions do not mutate the in-memory list
- **WHEN** the user selects any action other than `Delete conversation` (e.g. `View full conversation`, `Export to Markdown`, `Export to JSON`, `Copy conversation ID`, `Back to list`, or `Quit`)
- **THEN** the in-memory chat list is unchanged across the action
- **AND** the next `browser(...)` call receives the same chat list as the previous one

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
