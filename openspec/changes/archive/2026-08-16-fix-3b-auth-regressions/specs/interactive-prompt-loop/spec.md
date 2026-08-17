# Delta: interactive-prompt-loop (fix-3b-auth-regressions)

Strengthens the keepalive-lifecycle requirement added by fix-3: entry is unconditional, and the profile the keepalive rotates for is the correctly-resolved effective profile. The TTY, cancellation, validation, and slash-command contracts are unchanged.

## MODIFIED Requirements

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
