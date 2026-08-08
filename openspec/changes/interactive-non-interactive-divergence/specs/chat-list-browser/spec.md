## MODIFIED Requirements

### Requirement: Chat-list browser SHALL show an action menu after a chat is picked

When the user presses `enter` on a highlighted chat, the browser SHALL resolve with `{ kind: 'pick', chat, action: <pending> }` and the caller SHALL show a `prompts.select` action menu with eight options, in this order: `View full conversation`, `Continue conversation`, `Export to Markdown`, `Export to JSON`, `Copy conversation ID`, `Delete conversation`, `Back to list`, `Quit`. The `Delete conversation` option SHALL display a `No confirmation` description adjacent to its label. After the user picks an action, the action SHALL execute and the loop SHALL re-enter the browser.

#### Scenario: enter on a chat opens the action menu

- **WHEN** the user navigates to a chat and presses `enter`
- **THEN** the browser prompt resolves with `{ kind: 'pick', chat, action: <pending> }`
- **AND** the caller shows the action menu titled `Selected: <id> — "<title>"`

#### Scenario: action menu lists all eight options in the documented order

- **WHEN** the caller shows the action menu
- **THEN** the choice list contains exactly eight entries with values `view`, `continue`, `export-markdown`, `export-json`, `copy-id`, `delete`, `back`, `quit` in that order
- **AND** the `delete` entry's label is `Delete conversation` and its description is `No confirmation`

#### Scenario: View action invokes fetch

- **WHEN** the user selects `View full conversation` from the action menu
- **THEN** the caller invokes `FetchCommand` against the picked `chat.id`
- **AND** the loop re-enters the browser after the fetch returns

#### Scenario: Continue action invokes continue REPL

- **WHEN** the user selects `Continue conversation` from the action menu
- **THEN** the caller invokes `ContinueCommand` with the picked `chat.id` and `--profile <chat.profile>` (when the chat has an owning profile) so the REPL opens against the right profile
- **AND** the loop re-enters the browser after the REPL exits

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