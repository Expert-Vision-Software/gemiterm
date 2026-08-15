## ADDED Requirements

### Requirement: Shared Command Invocation Helper

The system MUST provide an `invokeCommand(commandName: string, args: string[], context: CliCommandContext): Promise<void>` helper in `src/cli/utils/command-invoker.ts`. The helper MUST dynamically import the `CommandRegistry`, construct and register all commands, look up the named handler, and execute it with `(args, context)`. When no handler is registered for `commandName`, the helper MUST throw an `Error` whose message names the missing command. The `continue` and `fetch` commands MUST use this helper (in place of their previously byte-identical private `invokeListCommand` methods) to run the `list` command when no conversation id is supplied, preserving the `No conversation ID specified. Listing conversations:` notice. The `list` command's interactive action dispatch MUST use the same helper in place of its inline registry import+construction+registration block.

#### Scenario: Invoking a registered command executes it

- **WHEN** `invokeCommand("list", [], context)` is called
- **THEN** the registered `list` handler's `execute` receives `([], context)` and runs

#### Scenario: Invoking an unknown command throws

- **WHEN** `invokeCommand("nope", [], context)` is called
- **THEN** the helper rejects with an `Error` whose message names the missing command

#### Scenario: continue and fetch share the helper with no duplicated copies

- **WHEN** `src/cli/commands/continue-command.ts` and `src/cli/commands/fetch-command.ts` are inspected after the change
- **THEN** neither file defines an `invokeListCommand` method; both dispatch through `invokeCommand("list", [], context)` with the same `No conversation ID specified. Listing conversations:` notice as before

#### Scenario: list interactive dispatch routes through the helper

- **WHEN** the `list` command's interactive action menu dispatches `fetch`, `export`, or `continue`
- **THEN** the dispatch goes through `invokeCommand(<name>, <args>, context)` and the file contains no inline `new CommandRegistry()` construction

#### Scenario: Output byte-equivalence is preserved

- **WHEN** `gemiterm fetch` or `gemiterm continue` is run with no conversation id
- **THEN** the notice text, the rendered `list` output, and the exit code are byte-equivalent to the pre-change baseline

### Requirement: Shared Chat Session Dispatch

The system MUST provide a `startChatSession(params): Promise<void>` helper in `src/cli/utils/chat-session.ts` that owns the interactive/non-interactive mode branch for the chat commands. `params` MUST carry the effective message (`string | null`), an optional `conversationId`, an optional `profileName`, the `getGeminiClient` factory, and the logger. When the effective message is non-null the helper MUST perform the one-shot send (printing the model response after a `Model:` label, and for a new conversation printing the `Conversation ID: <id>` line via its first-turn hook). When the effective message is null the helper MUST start the interactive REPL via `runInteractiveLoop` with a `messageHandler` built from the same params. The presence of `conversationId` MUST select append semantics (`sendMessage` against the existing conversation); its absence MUST select new-chat semantics (`startNewChat` for the first turn, then `sendMessage` against the resulting id). The `new` and `continue` commands MUST obtain this behavior exclusively from the helper and MUST NOT define their own `sendNonInteractive`/`startInteractive` method pairs.

#### Scenario: Non-null message sends one shot

- **WHEN** `startChatSession({ effectiveMessage: "hi", getGeminiClient, logger })` is called
- **THEN** a new chat is started with the message and the model response is printed after a `Model:` label

#### Scenario: Null message starts the REPL

- **WHEN** `startChatSession({ effectiveMessage: null, getGeminiClient, logger })` is called
- **THEN** `runInteractiveLoop` is entered with a `messageHandler` that starts a new chat on the first non-empty line and appends to the resulting conversation id afterwards

#### Scenario: conversationId selects append semantics

- **WHEN** `startChatSession({ effectiveMessage: "follow up", conversationId: "conv-1", getGeminiClient, logger })` is called
- **THEN** the message is sent to the existing `conv-1` conversation and no new chat is created

#### Scenario: new and continue contain no mode-branch duplication

- **WHEN** `src/cli/commands/new-command.ts` and `src/cli/commands/continue-command.ts` are inspected after the change
- **THEN** neither file defines `sendNonInteractive` or `startInteractive` private methods; both dispatch through `startChatSession`

#### Scenario: REPL behavior byte-equivalence is preserved

- **WHEN** `gemiterm new` or `gemiterm continue <id>` is run with no message on a TTY
- **THEN** the banner, prompt, `/exit` / `/quit` handling, empty-line handling, `Model:` labels, and exit-on-Ctrl+C behavior are byte-equivalent to the pre-change baseline
