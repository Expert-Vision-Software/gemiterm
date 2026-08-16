# Delta: commands (fix-2-phantom-detection)

Adds reactive phantom detection to `ListCommand` and an opt-in `--verbose` session probe to `StatusCommand`. Both build on the `CookieSession` facade from fix-1 `cookie-session-core`. All other command contracts are unchanged; the non-interactive stdout of `list` remains byte-stable.

## ADDED Requirements

### Requirement: ListCommand reactive phantom detection
The single-profile list flow MUST, when `listChats` resolves zero conversations, invoke the auth facade's read-only session classifier exactly once for that profile. When the classification is `live`, the command MUST proceed with the normal empty output and no further auth interaction. When the classification is `phantom` or `dead`, the command MUST offer recovery on a TTY (confirm prompt through the prompt-layer facade, then the auth recovery rung, then retrying the list query exactly once) and MUST print a diagnostic to stderr in non-interactive mode naming the profile, the classified state, and the `gemiterm auth` remedy. The stdout bytes of the non-interactive list output MUST NOT change under any classification outcome. Multi-profile queries (`--all-profiles` and aggregate forms) MUST NOT invoke the classifier.

#### Scenario: Phantom result triggers one classification and one recovery retry
- **WHEN** a single-profile list returns zero chats, the classifier reports `phantom`, and the user accepts the recovery prompt
- **THEN** exactly one classification, one recovery rung, and one list retry occur, and the retried result is rendered

#### Scenario: Genuinely empty account does not recover
- **WHEN** a single-profile list returns zero chats and the classifier reports `live`
- **THEN** the normal empty output is printed with no recovery prompt

#### Scenario: Non-interactive stdout stays byte-identical
- **WHEN** a single-profile list returns zero chats with the classifier reporting `phantom` in a non-TTY run
- **THEN** stdout matches the pre-existing empty-list output byte-for-byte and the diagnostic appears on stderr only

#### Scenario: Multi-profile queries never classify
- **WHEN** an aggregate list runs across profiles and one profile returns zero chats
- **THEN** the classifier is not invoked for any profile

### Requirement: StatusCommand --verbose session probe
`StatusCommand` MUST accept a `--verbose` flag. When set, it MUST probe each profile sequentially through the auth facade's read-only classifier and render a PROBE column showing `live (N)` (with the probe's chat count), `phantom`, or `dead` per profile. The probe MUST NOT rotate cookies, write storage, or open a browser. Without `--verbose`, the command MUST perform zero probes and its output MUST be byte-identical to the pre-change form.

#### Scenario: Verbose renders per-profile probe states
- **WHEN** `status --verbose` runs with fake classifier states `live (3)`, `phantom`, `dead` for three profiles
- **THEN** the rendered table contains a PROBE column with those three values in profile order

#### Scenario: Default status is unchanged
- **WHEN** `status` runs without `--verbose`
- **THEN** no classifier call occurs and the output contains no PROBE column, byte-identical to the pre-change output

#### Scenario: Probe is read-only
- **WHEN** `status --verbose` probes any profile state
- **THEN** no cookie write and no browser session occurs for any profile
