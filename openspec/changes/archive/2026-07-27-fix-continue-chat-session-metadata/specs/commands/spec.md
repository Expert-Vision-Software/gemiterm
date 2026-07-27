## MODIFIED Requirements

### Requirement: ContinueCommand appends to the named conversation

The `continue` command's contract on `<conversation_id>` is **append** —
the named conversation MUST receive the new turn, not a brand-new chat.
The wrapper-level mechanism that achieves this is out of scope for this
requirement; the requirement is on the user-visible behavior the
`ContinueCommand` and its mediator dispatch enforce.

When the user runs `gemiterm continue <conversation_id> <message>`,
`<conversation_id>` MUST thread onto the conversation that already holds
that id. The model's response MUST be contextually aware of any prior
turns in the same conversation (today, the wrapper fails to thread and the
model treats the message as a fresh prompt — this requirement forbids that
outcome).

When `<message>` is omitted and the REPL is started with
`gemiterm continue <conversation_id>`, each subsequent non-empty line
MUST be appended to the same `<conversation_id>`; the REPL MUST NOT
silently create a new chat under the hood.

This requirement does NOT define how threading is implemented at the
wrapper layer (the implementation detail lives in the `conversations`
capability). It only enforces the user-visible outcome at the command
layer.

#### Scenario: Continue threads onto the named conversation when metadata is known
- **WHEN** the wrapper has previously persisted `rid`/`rcid` for
  `(profile, conversation_id)` (e.g. an earlier `sendMessage` in this
  process)
- **AND** the user runs `gemiterm continue <conversation_id> "follow up"`
- **THEN** the model's response references the prior turns of
  `<conversation_id>`
- **AND** no new chat is created (the response is appended to the named
  conversation; no new cid appears in `gemiterm list`)

#### Scenario: Continue second turn threads onto the first in the same process
- **WHEN** the user runs `gemiterm new` (no message) and types two lines
  into the REPL
- **THEN** both turns land in the same conversation
- **AND** the second turn's response references the first

#### Scenario: Continue REPL exits on /exit or /quit
- **WHEN** the user types `/exit` or `/quit` in the continue REPL
- **THEN** the readline interface closes and the command returns

#### Scenario: Continue REPL ignores empty lines
- **WHEN** the user enters a blank line in the continue REPL
- **THEN** no `SendMessageCommand` is sent and the REPL continues
  prompting
