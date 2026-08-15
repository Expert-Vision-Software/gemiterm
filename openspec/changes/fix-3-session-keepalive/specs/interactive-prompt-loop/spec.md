# Delta: interactive-prompt-loop (fix-3-session-keepalive)

The REPL becomes the owner of the session-keepalive lifecycle. The existing TTY, cancellation, validation, and slash-command contracts are unchanged.

## ADDED Requirements

### Requirement: Interactive prompt loop owns the keepalive lifecycle
The interactive chat REPL MUST start exactly one session-keepalive loop for the active profile on entry and MUST stop it on every exit path - normal exit, cancellation, and error propagation - via a `finally` block. The loop's timer handles MUST NOT block process exit after the REPL ends. The keepalive loop MUST NOT be constructed by any one-shot (non-REPL) command path. Keepalive failures MUST NOT alter the REPL's prompt behavior or slash-command contract.

#### Scenario: Loop starts once and stops on normal exit
- **WHEN** the REPL runs to completion and exits normally
- **THEN** the keepalive loop was started exactly once and its stop is invoked before the REPL resolves

#### Scenario: Loop stops on cancellation
- **WHEN** the REPL exits via cancellation (`CancellationError`)
- **THEN** the keepalive loop is stopped and no timer remains active

#### Scenario: One-shot commands never start keepalive
- **WHEN** any non-interactive command (e.g. `gemiterm list`) runs
- **THEN** no keepalive loop is constructed or started
