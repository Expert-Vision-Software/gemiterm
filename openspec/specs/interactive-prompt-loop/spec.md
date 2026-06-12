## Purpose

TBD

## Requirements

### Requirement: Interactive prompt loop SHALL require a TTY

The interactive prompt loop SHALL refuse to start when `process.stdin.isTTY` is not `true`. The loop SHALL throw a `NonInteractiveError` immediately, before constructing the readline interface or invoking the first prompt.

#### Scenario: REPL invoked from a TTY
- **WHEN** `gemiterm new` (no args, no `--prompt-file`) is invoked with `process.stdin.isTTY === true`
- **THEN** the REPL banner is printed and the loop awaits user input

#### Scenario: REPL invoked from a pipe
- **WHEN** `gemiterm new` is invoked with `process.stdin.isTTY` not `true`
- **THEN** the REPL does not start
- **AND** the CLI prints an error message containing `gemiterm new "Your message"`
- **AND** the CLI exits with code 1

#### Scenario: REPL invoked from a TTY with stdin redirected
- **WHEN** `gemiterm new < /dev/null` is invoked (stdin is not a TTY even if stdout is)
- **THEN** the REPL does not start
- **AND** the CLI prints the same non-interactive error as the pipe case

### Requirement: Interactive prompt loop SHALL propagate cancellation cleanly

The interactive prompt loop SHALL treat `CancellationError` from the prompt layer as a clean exit. On cancellation, the loop SHALL print `chalk.dim("\nGoodbye.")`, resolve its outer `Promise<void>`, and let the CLI top-level handler exit with code 0.

#### Scenario: Ctrl+C during input prompt
- **WHEN** the user presses Ctrl+C while the REPL is awaiting input
- **THEN** the REPL prints `chalk.dim("\nGoodbye.")` and returns
- **AND** the CLI exits with code 0

#### Scenario: Ctrl+C during model response
- **WHEN** the user presses Ctrl+C while a model response is being awaited
- **THEN** the in-flight `messageHandler` is interrupted (via the AbortSignal)
- **AND** the REPL prints `chalk.dim("\nGoodbye.")` and returns
- **AND** the CLI exits with code 0

### Requirement: Interactive prompt loop SHALL preserve validation behaviour

The interactive prompt loop SHALL surface validation errors from the prompt layer without consuming the user's message. A failed validation SHALL re-render the prompt with the error visible and SHALL NOT call the `messageHandler`.

#### Scenario: Validation failure in the input prompt
- **WHEN** the prompt layer's `validate` returns a non-empty string for the user's typed input
- **THEN** the error is rendered below the input
- **AND** the REPL does not call the `messageHandler`
- **AND** the REPL re-prompts for the next message

### Requirement: Interactive prompt loop SHALL preserve the slash-command contract

The interactive prompt loop SHALL recognise `/exit` and `/quit` as the only loop-terminating slash commands. The loop SHALL also recognise an empty input (Enter with no text) as a no-op that re-prompts without sending a message. The loop SHALL pass all other input to the `messageHandler` unchanged.

#### Scenario: /exit terminates the loop
- **WHEN** the user types `/exit` and presses Enter
- **THEN** the loop prints `chalk.dim("\nGoodbye.")` and resolves
- **AND** the CLI exits with code 0

#### Scenario: /quit terminates the loop
- **WHEN** the user types `/quit` and presses Enter
- **THEN** the loop prints `chalk.dim("\nGoodbye.")` and resolves
- **AND** the CLI exits with code 0

#### Scenario: Empty input re-prompts
- **WHEN** the user presses Enter with no text
- **THEN** the loop re-prompts without calling the `messageHandler`

#### Scenario: Non-slash input is forwarded
- **WHEN** the user types any string that is not `/exit`, `/quit`, or empty
- **THEN** the loop calls the `messageHandler` with the trimmed string
