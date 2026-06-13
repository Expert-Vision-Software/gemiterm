## Purpose

TBD

## Requirements

### Requirement: Prompt layer SHALL gate every prompt on a TTY

The prompt layer facade SHALL check `process.stdin.isTTY === true` before invoking any `@inquirer/prompts` function. When the check fails, the facade SHALL throw a `NonInteractiveError` (a subclass of `GemitermError`) whose message includes the suggested non-interactive invocation for the calling command.

#### Scenario: TTY available, prompt proceeds
- **WHEN** a caller invokes any facade function and `process.stdin.isTTY` is `true`
- **THEN** the facade delegates to `@inquirer/prompts` and returns the resolved answer

#### Scenario: TTY not available, prompt throws
- **WHEN** a caller invokes any facade function and `process.stdin.isTTY` is `false` (or `undefined`)
- **THEN** the facade throws a `NonInteractiveError` without calling `@inquirer/prompts`
- **AND** the error message names the non-interactive command form (e.g. `gemiterm new "Your message"`)
- **AND** the CLI top-level error handler renders the message and exits with code 1

#### Scenario: TTY gate applies to text, confirm, and select
- **WHEN** a caller invokes `text`, `confirm`, or `select`
- **THEN** each MUST perform the TTY gate before delegating to `@inquirer/prompts`

### Requirement: Prompt layer SHALL expose text, confirm, and select

The prompt layer facade SHALL export a `text` function (wrapping `@inquirer/input`), a `confirm` function (wrapping `@inquirer/confirm`), and a `select` function (wrapping `@inquirer/select`). The facade SHALL be the only module in `src/` that imports from `@inquirer/prompts`.

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

### Requirement: Prompt layer SHALL map cancellation to a typed error

The prompt layer facade SHALL catch `ExitPromptError` and `AbortPromptError` from `@inquirer/prompts` and rethrow a single `CancellationError` (a subclass of `GemitermError`). The facade SHALL expose a `getAbortSignal(): AbortSignal` backed by a module-level `AbortController`.

#### Scenario: Ctrl+C during a one-shot prompt
- **WHEN** the user presses Ctrl+C while a `confirm` or `text` prompt is active
- **THEN** the facade throws a `CancellationError`
- **AND** the calling command renders `chalk.dim("Cancelled.")` and returns normally (no `process.exit`)

#### Scenario: Ctrl+C during the chat REPL
- **WHEN** the user presses Ctrl+C while the REPL is awaiting input
- **THEN** the facade throws a `CancellationError`
- **AND** the REPL prints `chalk.dim("\nGoodbye.")` and resolves its outer `Promise<void>`
- **AND** the CLI top-level handler exits with code 0

#### Scenario: External abort signal
- **WHEN** a caller invokes a facade function with a `signal` from an external `AbortController` and the controller is aborted
- **THEN** the facade throws a `CancellationError`

### Requirement: Prompt layer SHALL apply a shared theme

The prompt layer facade SHALL construct a shared `Theme` extension that aligns Inquirer's chrome with gemiterm's chalk palette. The theme SHALL use `chalk.cyan` for the idle prefix, `chalk.green` + the tick figure for the done prefix, `chalk.red` for validation errors, and SHALL hide the keys-help tip by returning `undefined` from `style.keysHelpTip`.

#### Scenario: Prompt prefix shows cyan question mark
- **WHEN** any facade prompt is rendered
- **THEN** the idle prefix is `chalk.cyan("?")` and the done prefix is `chalk.green(figures.tick)`

#### Scenario: Validation error is styled red
- **WHEN** a `text` prompt's `validate` returns a non-empty string
- **THEN** the error is rendered with `chalk.red` styling, matching the rest of the CLI's error output

#### Scenario: Keys-help tip is hidden
- **WHEN** a `select` or `confirm` prompt is rendered
- **THEN** the prompt body does not include the default `keysHelpTip` line ("↑↓ navigate • enter submit")

### Requirement: Prompt layer SHALL be the only importer of @inquirer/prompts

The `src/cli/utils/prompts.ts` module SHALL be the only file in `src/` that imports from `@inquirer/prompts`. No command file SHALL import from `@inquirer/prompts` directly.

#### Scenario: Lint enforces single-importer rule
- **WHEN** the mediation lint script runs
- **THEN** no file in `src/` outside `cli/utils/prompts.ts` matches the `@inquirer/prompts` import pattern

#### Scenario: Grep confirms no direct command imports
- **WHEN** a developer greps `src/cli/commands/*.ts` for `from "@inquirer/prompts"`
- **THEN** zero matches are returned
