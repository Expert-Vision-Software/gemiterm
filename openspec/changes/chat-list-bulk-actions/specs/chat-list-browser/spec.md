## ADDED Requirements

### Requirement: Chat-list browser SHALL support multi-row selection

The browser SHALL maintain a per-session selection set of conversation ids. The user SHALL toggle the active row's id into or out of the selection by pressing `space`. The selection SHALL be a `ReadonlySet<string>` keyed by `chat.id`. Selected rows SHALL render with the prefix `[x] ` in place of the `[ ] ` prefix used for unselected rows. The selection SHALL be reflected in the title bar as `Selected: N` (N is the number of currently-selected ids). The selection SHALL be a per-session value: when the browser re-mounts, the selection is reset to empty. The `space` keypress SHALL have no effect on the active cursor position. The `space` keypress SHALL be a no-op when the visible list is empty.

#### Scenario: space toggles the active row into the selection

- **WHEN** the user is on row index `i` and presses `space`
- **THEN** `filteredSorted[i].id` is added to the selection set
- **AND** the title bar reflects `Selected: 1` (or N+1)
- **AND** the row at index `i` renders with the `[x] ` prefix
- **AND** the cursor remains on row `i`

#### Scenario: space toggles a selected row back out

- **WHEN** the user is on a row whose id is in the selection set and presses `space`
- **THEN** the id is removed from the selection set
- **AND** the title bar reflects the new count
- **AND** the row at that index renders with the `[ ] ` prefix

#### Scenario: space is a no-op on an empty visible list

- **WHEN** the visible list is empty
- **THEN** pressing `space` does not change the selection set and does not throw

#### Scenario: selection persists across filter changes

- **WHEN** the user has selected chats `c1` and `c2` and then changes the sort mode with `s`, the profile filter with `p`, or the favourites filter with `f`
- **THEN** the selection set still contains `c1.id` and `c2.id`
- **AND** rows whose ids are in the selection render with the `[x] ` prefix in the new filtered/sorted view

#### Scenario: title bar shows the selection count

- **WHEN** the selection set contains N ids
- **THEN** the title bar contains the substring `Selected: <N>` adjacent to the existing `Sort:`, `Profile:`, and `Favorites:` fields

#### Scenario: hint line documents space and b

- **WHEN** the browser renders
- **THEN** the hint line contains the substrings `space select` and `b bulk` adjacent to the existing key labels

### Requirement: Chat-list browser SHALL provide a bulk action menu on `b`

The browser SHALL respond to the `b` keypress by either (a) showing a hint and staying in the browser when the selection is empty, or (b) resolving the prompt with a new `BrowserResult` variant when the selection is non-empty. The new variant SHALL carry the current selection as `ReadonlyArray<ChatInfo>` (mapping the selection ids back through the current `filteredSorted` array; ids that are not in the current view are dropped silently). The caller SHALL show a `select` action menu with three bulk options (`Bulk delete`, `Bulk export`, `Combine & Summarize`) plus `Back to list` and `Quit`, and SHALL dispatch each option by invoking the corresponding existing CLI command (`DeleteCommand`, `ExportCommand`, or the new `SummarizeCommand`) via `CommandRegistry.getHandler`. The browser SHALL NOT call mediator handlers directly for bulk operations.

#### Scenario: b with empty selection shows the hint and stays in the browser

- **WHEN** the user presses `b` and the selection set is empty
- **THEN** the browser does not resolve
- **AND** the user-visible output contains the hint `No conversations selected — press space to select rows first.`
- **AND** the browser remains interactive

#### Scenario: b with non-empty selection resolves the browser

- **WHEN** the user presses `b` and the selection set is non-empty
- **THEN** the browser prompt resolves with `{ kind: "bulk", selectedChats: <ChatInfo[]>, action: "back" }`
- **AND** the caller shows the bulk action menu titled with the count `Bulk actions — N conversations selected`

#### Scenario: Bulk delete invokes DeleteCommand

- **WHEN** the user selects `Bulk delete` from the bulk action menu
- **THEN** the caller invokes `CommandRegistry.getHandler("delete")` with argv containing the comma-joined selection ids (and the existing flags)
- **AND** the browser loop re-enters the browser after the command returns

#### Scenario: Bulk export invokes ExportCommand

- **WHEN** the user selects `Bulk export` from the bulk action menu
- **THEN** the caller invokes `CommandRegistry.getHandler("export")` with argv containing the comma-joined selection ids (and the existing flags)
- **AND** the browser loop re-enters the browser after the command returns

#### Scenario: Combine & Summarize invokes SummarizeCommand

- **WHEN** the user selects `Combine & Summarize` from the bulk action menu
- **THEN** the caller invokes `CommandRegistry.getHandler("summarize")` with argv containing the comma-joined selection ids (and any flags forwarded from the bulk action menu)
- **AND** the browser loop re-enters the browser after the command returns

#### Scenario: bulk action menu back returns to the browser

- **WHEN** the user selects `Back to list` from the bulk action menu
- **THEN** no command is invoked
- **AND** the browser loop re-enters the browser
- **AND** the previous selection is NOT preserved (the user re-selects if needed)

#### Scenario: bulk action menu quit exits the loop

- **WHEN** the user selects `Quit` from the bulk action menu
- **THEN** the browser loop exits
- **AND** the process exits with code 0

#### Scenario: existing single-row action menu is unchanged

- **WHEN** the user navigates to a chat and presses `enter` (regardless of the current selection state)
- **THEN** the browser resolves with `{ kind: "pick", chat, action: "back" }` exactly as before
- **AND** the existing single-row action menu is shown with the same five options
- **AND** the existing `BrowserAction` type is unchanged
