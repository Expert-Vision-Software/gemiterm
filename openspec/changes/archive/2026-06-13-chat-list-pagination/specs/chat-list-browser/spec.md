## MODIFIED Requirements

### Requirement: Chat-list browser SHALL display the list with cursor navigation

The browser SHALL render the chat list as a table with the columns `ID`, `DATE`, `TITLE`, and `PIN` (and `PROFILE` when `--all-profiles` is set). The browser SHALL display the filtered list as a **paged window** of `pageSize` rows centered on the active row, where `pageSize` is derived from the terminal height as `max(5, floor((process.stdout.rows - 4) * 0.8))` (with the `?? 24` fallback when `process.stdout.rows` is `undefined`); the `BrowserConfig.pageSize` test override MAY be used to force a specific value in test fixtures. When the filtered list has fewer rows than `pageSize`, every row is shown. The user navigates the list with the `↑` and `↓` arrow keys (one row at a time) and pages through the list with the `←` and `→` arrow keys (one `pageSize` at a time). `←` at the first row and `→` at the last row are no-ops on the active cursor position. A cursor indicator (`> `) SHALL mark the active row; the active row's index MUST be clamped to `[0, filteredSorted.length - 1]` and MUST NOT wrap at the ends. The title bar MUST show the total chat count, the current sort mode, the current profile filter, and the current favourites state. When the filtered list spans more than one page, the title bar MUST additionally show a `Page: X/Y` indicator immediately after the chat count, where `Y = ceil(N / pageSize)` (total pages) and `X = min(Y, floor(active / pageSize) + 1)` (the 1-indexed page the active row is in). When the list fits on a single page, the `Page:` indicator MUST be omitted. The hint line MUST advertise the `←` / `→` page keys adjacent to the existing `↑↓ navigate` label. The browser SHALL recognise `s` to cycle the sort mode, `p` to cycle the profile filter, and `f` to toggle the favourites filter (each described in its own requirement below).

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

#### Scenario: Right arrow pages forward

- **WHEN** the user presses `→`
- **THEN** the active row index advances by `pageSize` rows (clamped to `filteredSorted.length - 1`)
- **AND** the visible window shifts so the new active row is centered

#### Scenario: Left arrow pages backward

- **WHEN** the user presses `←`
- **THEN** the active row index retreats by `pageSize` rows (clamped to `0`)
- **AND** the visible window shifts so the new active row is centered

#### Scenario: Right arrow clamps at the last row

- **WHEN** the active row is within `pageSize` rows of the end and the user presses `→`
- **THEN** the active row index is set to `filteredSorted.length - 1` and does not exceed it

#### Scenario: Left arrow clamps at the first row

- **WHEN** the active row is within `pageSize` rows of the start and the user presses `←`
- **THEN** the active row index is set to `0` and does not go below it

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
