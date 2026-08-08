## ADDED Requirements

### Requirement: Interactive prompt loop SHALL forward input through the canonical mediator dispatch

The interactive prompt loop MUST accept a `messageHandler` that is constructed from the same mediator dispatch the non-interactive command path uses. The loop MUST NOT compose services (e.g., `GeminiClientService`, `AuthService`, `ProfileManager`) directly inside the handler callback. The handler signature MUST be `async (message: string) => Promise<MessageHandlerResult>` and MUST be called once per non-empty non-slash input line.

#### Scenario: REPL messageHandler is the canonical dispatch seam

- **WHEN** the `runInteractiveLoop` is invoked by a command that has both interactive and non-interactive modes
- **THEN** the `messageHandler` argument MUST be constructed so that invoking it produces the same mediator query/command payload as the non-interactive command for the same logical input
- **AND** the loop MUST NOT compose any service directly inside the `messageHandler`

#### Scenario: REPL payload matches the non-interactive path

- **WHEN** the REPL handler dispatches a `SendMessageCommand` (continue / new subsequent turns) or `StartNewChatCommand` (new first turn)
- **THEN** the dispatched payload MUST be byte-identical to the payload the non-interactive `gemiterm <command> ...` invocation produces for the same input
- **AND** any per-command parity test MUST fail if the payloads diverge