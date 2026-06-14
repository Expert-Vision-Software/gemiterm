## MODIFIED Requirements

### Requirement: Chat-list browser SHALL display the list with cursor navigation

The browser SHALL render the chat list as a table with the columns `ID`, `DATE`, `TITLE`, and `PIN` (and `PROFILE` when `--all-profiles` is set). The browser SHALL display the filtered list as a **paged window** of `pageSize` rows centered on the active row, where `pageSize` is derived from the terminal height as `max(5, floor((process.stdout.rows - 4) * 0.8))` (with the `?? 24` fallback when `process.stdout.rows` is `undefined`); the `BrowserConfig.pageSize` test override MAY be used to force a specific value in test fixtures. When the filtered list has fewer rows than `pageSize`, every row is shown. The user navigates the list with the `↑` and `↓` arrow keys (one row at a time) and pages through the list with the `←` and `→` arrow keys. `←` / `→` MUST snap the cursor to the **first row of the new page** (`(currentPage ± 1) * pageSize`, clamped to `[0, filteredSorted.length - 1]`) — so paging always lands the cursor on a row the user can immediately see. `←` on the first page and `→` on the last page are no-ops (the cursor stays on its current row, since the page does not change). The window is rendered through `@inquirer/core`'s `usePagination` with `loop: false`, so the visible window does not wrap around the ends of the list (the cursor itself is bounded by `[0, filteredSorted.length - 1]` regardless). A cursor indicator (`> `) SHALL mark the active row. The title bar MUST show the total chat count, the current sort mode, the current profile filter, and the current favourites state. When the filtered list spans more than one page, the title bar MUST additionally show a `Page: X/Y` indicator immediately after the chat count, where `Y = ceil(N / pageSize)` (total pages) and `X = min(Y, floor(active / pageSize) + 1)` (the 1-indexed page the active row is in). When the list fits on a single page, the `Page:` indicator MUST be omitted. The hint line MUST advertise the `←` / `→` page keys adjacent to the existing `↑↓ navigate` label. The browser SHALL recognise `s` to cycle the sort mode, `p` to cycle the profile filter, and `f` to toggle the favourites filter (each described in its own requirement below). Pressing `s`, `p`, or `f` MUST reset the active row index to `0` (the first row of the re-sorted / re-filtered list); a `useEffect` watching `[filteredSorted]` enforces the same reset for any future list-mutating path.

#### Scenario: Browser opens with a paged window centered on the first row

- **WHEN** the browser opens against a mediator returning N chats
- **THEN** a paged window of at most `pageSize` rows is visible, centered on the first row
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

#### Scenario: Right arrow pages forward and snaps to the first row of the next page

- **WHEN** the user presses `→` and the current page is not the last page
- **THEN** the active row index is set to `(currentPage + 1) * pageSize` (i.e. the first row of the next page)
- **AND** the visible window shifts so the new active row is the top row of the page
- **AND** the page indicator updates to `Page: (X+1)/Y`

#### Scenario: Left arrow pages backward and snaps to the first row of the previous page

- **WHEN** the user presses `←` and the current page is not the first page
- **THEN** the active row index is set to `(currentPage - 1) * pageSize` (i.e. the first row of the previous page)
- **AND** the visible window shifts so the new active row is the top row of the page
- **AND** the page indicator updates to `Page: (X-1)/Y`

#### Scenario: Right arrow is a no-op on the last page

- **WHEN** the user presses `→` and the cursor is already on the last page
- **THEN** the active row index does not change
- **AND** the page indicator does not change

#### Scenario: Left arrow is a no-op on the first page

- **WHEN** the user presses `←` and the cursor is already on the first page
- **THEN** the active row index does not change
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

#### Scenario: Changing the sort resets the cursor to the top of the new sort

- **WHEN** the user is on any row and presses `s`
- **THEN** the active row index is set to `0` (the first row of the re-sorted list)
- **AND** the visible window shifts to the new first row

#### Scenario: Changing the profile filter resets the cursor to the top of the filtered list

- **WHEN** the user is on any row and presses `p`
- **THEN** the active row index is set to `0` (the first row of the newly-filtered list)
- **AND** the visible window shifts to the new first row

#### Scenario: Toggling the favorites filter resets the cursor to the top of the filtered list

- **WHEN** the user is on any row and presses `f`
- **THEN** the active row index is set to `0` (the first row of the newly-filtered list)
- **AND** the visible window shifts to the new first row

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
