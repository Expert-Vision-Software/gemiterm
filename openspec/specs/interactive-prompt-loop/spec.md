## Purpose

The interactive prompt loop is the REPL entry point for `gemiterm new`. It owns the TTY-gated input cycle: printing the prompt banner, awaiting user text input (or a slash command), forwarding non-empty non-slash input to the message handler, and looping until `/exit`, `/quit`, or cancellation. It surfaces validation errors from the prompt layer without consuming the user's message and propagates `CancellationError` as a clean exit with code 0.

## Requirements

### Requirement: Interactive prompt loop SHALL require a TTY

The interactive prompt loop SHALL refuse to start when `process.stdin.isTTY` is not `true`. The loop SHALL throw a `NonInteractiveError` immediately, before invoking the first prompt.

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

### Requirement: Interactive prompt loop owns the keepalive lifecycle
The interactive chat REPL MUST start exactly one session-keepalive loop on entry - unconditionally, regardless of whether conversation-profile resolution produced an explicit name - and MUST stop it on every exit path - normal exit, cancellation, and error propagation - via a `finally` block. The keepalive MUST be constructed for the session's effective profile: the explicitly selected profile when one is given, otherwise the default profile resolved via the configuration's default-profile lookup (never a hardcoded profile name). The loop's timer handles MUST NOT block process exit after the REPL ends. The keepalive loop MUST NOT be constructed by any one-shot (non-REPL) command path. Keepalive failures MUST NOT alter the REPL's prompt behavior or slash-command contract.

#### Scenario: Loop starts once and stops on normal exit
- **WHEN** the REPL runs to completion and exits normally
- **THEN** the keepalive loop was started exactly once and its stop is invoked before the REPL resolves

#### Scenario: Loop stops on cancellation
- **WHEN** the REPL exits via cancellation (`CancellationError`)
- **THEN** the keepalive loop is stopped and no timer remains active

#### Scenario: One-shot commands never start keepalive
- **WHEN** any non-interactive command (e.g. `gemiterm list`) runs
- **THEN** no keepalive loop is constructed or started

#### Scenario: Loop starts when profile resolution returns null
- **WHEN** `gemiterm continue <conversation_id>` enters the REPL with no message and conversation-profile resolution returned `null` (single active profile)
- **THEN** the keepalive loop is still constructed and started for the default profile

#### Scenario: Loop uses the resolved default profile, never a literal fallback
- **WHEN** the REPL starts with no explicit `--profile` and the configuration's default profile is named something other than "default"
- **THEN** the keepalive loop rotates for the configured default profile (no literal `"default"` profile name is used)
