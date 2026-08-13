## MODIFIED Requirements

### Requirement: Prompt layer SHALL expose text, confirm, and select

The prompt layer facade SHALL export a `text` function (a thin wrapper over `@inquirer/input`), a `confirm` function (wrapping `@inquirer/confirm`), and a `select` function (wrapping `@inquirer/select`). The facade SHALL be the only module in `src/` that imports from `@inquirer/prompts`. The `text` function SHALL NOT contain hand-rolled raw-terminal input handling (no manual ANSI escape parsing, no manual `setRawMode`, no manual UTF-8 byte decoding, no manual backspace/Ctrl-C handling); those behaviors SHALL be delegated to `@inquirer/input`. The `text` function SHALL pass the shared `theme` and the module-level abort `signal` to `@inquirer/input` and SHALL preserve the `TextOptions` signature (`message`, optional `default`, optional `validate`).

#### Scenario: text returns the user-typed string
- **WHEN** a caller invokes `text({ message: "Your name" })` and the user types `Alice`
- **THEN** the facade resolves with the string `"Alice"`

#### Scenario: text validates input
- **WHEN** a caller invokes `text({ message: "Profile", validate: v => v.length > 0 || "required" })` and the user submits an empty string
- **THEN** the facade re-prompts without resolving
- **AND** the error message `"required"` is rendered below the input

#### Scenario: confirm returns a boolean
- **WHEN** a caller invokes `confirm({ message: "Delete?" })` and the user presses Enter
- **THEN** the facade resolves with the default boolean (or `true` if no default is set)

#### Scenario: confirm returns the user's y/n
- **WHEN** a caller invokes `confirm({ message: "Delete?", default: false })` and the user types `y`
- **THEN** the facade resolves with `true` regardless of the default

#### Scenario: select returns the chosen value
- **WHEN** a caller invokes `select({ message: "Pick", choices: [{ value: "a", label: "A" }, { value: "b", label: "B" }] })` and the user navigates to the second choice and presses Enter
- **THEN** the facade resolves with the value `"b"`

#### Scenario: text supports cursor navigation and paste
- **WHEN** the user edits the input line with arrow keys, Home, End, or pastes text
- **THEN** the editing behavior is provided by `@inquirer/input` (no hand-rolled escape handling in the facade)

#### Scenario: text has no raw-mode handling
- **WHEN** `src/cli/utils/prompts.ts` is read
- **THEN** the `text` implementation contains no `setRawMode`, no manual `data` listener, and no manual byte-level loop

#### Scenario: text maps cancellation to CancellationError
- **WHEN** the user presses Ctrl+C during a `text` prompt
- **THEN** the facade throws a `CancellationError`
