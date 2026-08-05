## MODIFIED Requirements

### Requirement: ContinueCommand

The system MUST provide a `continue` command implemented by `ContinueCommand` in `src/cli/commands/continue-command.ts`. The command MUST accept an optional positional `<conversation_id>` and an optional positional `<message>`, plus `--help/-h`. When `<conversation_id>` is missing, the command MUST invoke the `list` command via the `CommandRegistry` and return. When both `<conversation_id>` and `<message>` are present, the command MUST look up the owning profile via `ProfileAuthManager.findProfileForConversation(conversationId)` and send a `SendMessageCommand` to the mediator with payload `{ conversationId, message, profileName? }`; when the lookup returns a profile name, `profileName` MUST be set on the payload so the handler routes to that profile's `GeminiClientService`. When no profile owns the conversation, the command MUST throw `AuthenticationError` with a remediation message and exit non-zero. When `<conversation_id>` is present and `<message>` is absent, the command MUST start an interactive REPL that reads lines from stdin and sends each non-empty line as a `SendMessageCommand` using the same profile-lookup logic; the REPL MUST exit on `/exit` or `/quit` and MUST ignore empty lines. In a single-profile setup the behavior MUST be unchanged: the default profile is used without a lookup. The interactive REPL MUST NOT pre-fetch the conversation history via `FETCH_CHAT` or any other query before the user's first input. The first `SendMessageCommand` dispatched by the REPL MUST carry the same payload shape as the non-interactive `gemiterm continue <conversation_id> <message>` invocation.

#### Scenario: Continue with id and message sends a SendMessageCommand

- **WHEN** the user runs `gemiterm continue conv-abc123 "Hello there"`
- **THEN** the mediator receives a `SendMessageCommand` with `payload.conversationId === "conv-abc123"` and `payload.message === "Hello there"`, and the response text is printed after a `Model:` label

#### Scenario: Continue with no id invokes list

- **WHEN** the user runs `gemiterm continue` with no positional argument
- **THEN** the `list` command is executed and no `SendMessageCommand` is sent

#### Scenario: Continue with id but no message starts an interactive REPL

- **WHEN** the user runs `gemiterm continue conv-abc123` and types a line into stdin
- **THEN** a `SendMessageCommand` is sent for that line and the model response is printed after a `Model:` label
- **AND** no `FetchChatQuery` is dispatched before the first user input (no interactive-only pre-fetch)

#### Scenario: Continue REPL exits on /exit

- **WHEN** the user types `/exit` or `/quit` in the continue REPL
- **THEN** the readline interface closes and the command returns

#### Scenario: Continue REPL ignores empty lines

- **WHEN** the user enters a blank line in the continue REPL
- **THEN** no `SendMessageCommand` is sent and the REPL continues prompting

#### Scenario: Continue --help shows usage

- **WHEN** the user runs `gemiterm continue --help`
- **THEN** the output contains `Usage: gemiterm continue [conversation_id] [message] [options]` and documents `/exit`, `/quit`, and `--help`

#### Scenario: Continue REPL produces the same first SEND_MESSAGE payload as the non-interactive path

- **WHEN** a test harness invokes the non-interactive `gemiterm continue conv-abc123 "Hi"` and the interactive `gemiterm continue conv-abc123` REPL with one line `"Hi"`
- **THEN** both invocations MUST dispatch a `SendMessageCommand` with `payload: { conversationId: "conv-abc123", message: "Hi", profileName: <resolved-name or undefined> }` and the payloads MUST be byte-identical

## ADDED Requirements

### Requirement: NewCommand REPL subsequent turns dispatch SEND_MESSAGE

The interactive REPL opened by `gemiterm new` (no positional `<message>`) MUST start the first turn by dispatching a `StartNewChatCommand` to the mediator with payload `{ message, profileName? }`. Every subsequent REPL turn MUST dispatch a `SendMessageCommand` against the `conversationId` returned by the first turn's response, NOT another `StartNewChatCommand`. The `SendMessageCommand` payload for subsequent turns MUST be byte-identical to `gemiterm continue <conversationId> <message>` for the same conversation and message.

#### Scenario: new REPL first turn dispatches START_NEW_CHAT

- **WHEN** the user runs `gemiterm new` (no positional `<message>`) and types `"Hi"` as the first REPL line
- **THEN** the first turn dispatches a `StartNewChatCommand` with `payload: { message: "Hi", profileName: <resolved or undefined> }`
- **AND** the response `conversationId` is captured for subsequent turns

#### Scenario: new REPL second turn dispatches SEND_MESSAGE against the captured conversationId

- **WHEN** the user types a second line `"follow up"` in the `gemiterm new` REPL
- **THEN** the second turn dispatches a `SendMessageCommand` with `payload: { conversationId: <captured>, message: "follow up", profileName: <resolved or undefined> }`
- **AND** the payload MUST be byte-identical to `gemiterm continue <captured> "follow up"`

#### Scenario: new REPL does not re-create the conversation on every turn

- **WHEN** the user types multiple lines in the `gemiterm new` REPL
- **THEN** the model response from each turn MUST be appended to the same conversation (the same `conversationId` is reused across turns)
- **AND** only the first turn dispatches `START_NEW_CHAT`