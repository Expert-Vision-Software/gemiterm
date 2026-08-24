## MODIFIED Requirements

### Requirement: ContinueCommand

The system MUST provide a `continue` command implemented by `ContinueCommand` in `src/cli/commands/continue-command.ts`. The command MUST accept an optional positional `<conversation_id>` and an optional positional `<message>`, plus `--help/-h`, `--profile`, and `--model/-m <name>`. When `<conversation_id>` is missing, the command MUST invoke the `list` command via the shared command-invoker helper and return. When `<conversation_id>` is present, the command MUST resolve the owning profile through the shared `resolveProfile` helper (`src/cli/utils/profile-resolution.ts`), which consults `context.cookieSession.activeProfiles()` and - when more than one profile is active - `context.cookieSession.findProfileForConversation(conversationId)`, throwing `AuthenticationError` with the shared remediation message when no owner is found; in a single-profile setup the helper MUST return `null` and the default profile is used without a lookup. When both `<conversation_id>` and `<message>` are present, the command MUST send the message as a one-shot continuation through the shared chat-session dispatch with the resolved profile, passing the resolved model (CLI `--model` if non-empty, else the context `defaultModel`, else `Model.BASIC_FLASH`) to the chat-session helper. When `<conversation_id>` is present and `<message>` is absent, the command MUST start an interactive chat session via the shared chat-session helper, passing the same resolved model to every chat-session dispatch in the REPL, and MUST create exactly one session keepalive (through `context.cookieSession.createKeepalive`) for the resolved-or-default profile; the REPL MUST exit on `/exit` or `/quit` and MUST ignore empty lines. When no profile owns the conversation, the command MUST throw `AuthenticationError` with a remediation message and exit non-zero. When `--model` is supplied with an empty value (`--model ""` or `--model=`), the command MUST print `Error: --model requires a non-empty value.` to stderr and exit with code 1.

#### Scenario: Continue with id and message sends a SendMessageCommand

- **WHEN** the user runs `gemiterm continue conv-abc123 "Hello there"`
- **THEN** the chat-session helper dispatches the message against the resolved profile's `GeminiClientService` with the resolved model, and the response text is printed after a `Model:` label

#### Scenario: Continue with no id invokes list

- **WHEN** the user runs `gemiterm continue` with no positional argument
- **THEN** the `list` command is executed via the shared command-invoker helper and no chat-session dispatch occurs

#### Scenario: Continue with id but no message starts an interactive REPL

- **WHEN** the user runs `gemiterm continue conv-abc123` and types a line into stdin
- **THEN** the chat-session helper dispatches the line against the resolved profile's `GeminiClientService` with the resolved model, the model response is printed after a `Model:` label, and exactly one keepalive is created for the resolved profile

#### Scenario: Continue REPL exits on /exit

- **WHEN** the user types `/exit` or `/quit` in the continue REPL
- **THEN** the readline interface closes and the command returns

#### Scenario: Continue REPL ignores empty lines

- **WHEN** the user enters a blank line in the continue REPL
- **THEN** no chat-session dispatch occurs and the REPL continues prompting

#### Scenario: Continue with id and message sends a one-shot continuation

- **WHEN** `gemiterm continue <cid> hello` runs and `resolveProfile` resolves profile `work`
- **THEN** the message is dispatched through the shared chat-session path against `work`'s client with the resolved model, and no interactive session or keepalive is created

#### Scenario: Continue without a message opens the REPL with a keepalive

- **WHEN** `gemiterm continue <cid>` runs
- **THEN** an interactive session starts via the shared chat-session helper and exactly one keepalive is created for the resolved profile

#### Scenario: Multi-profile ownership lookup routes through the auth facade

- **WHEN** more than one profile is active and `context.cookieSession.findProfileForConversation(<cid>)` returns `work`
- **THEN** the continuation is routed to `work`'s `GeminiClientService` and no legacy `ProfileAuthManager` is referenced

#### Scenario: No owning profile fails with remediation

- **WHEN** no active profile owns `<cid>` and no `--profile` is given
- **THEN** the command exits non-zero with an `AuthenticationError` whose message names the conversation and suggests `gemiterm list --all-profiles` or `--profile <name>`

#### Scenario: Continue with --model passes the model to the chat-session dispatch

- **WHEN** the user runs `gemiterm continue conv-abc123 "Hi" --model gemini-3-pro`
- **THEN** the chat-session helper invokes `GeminiClientService.sendMessage` with the second argument `"gemini-3-pro"` and the model `"gemini-3-pro"` is forwarded to `client.newChat({ model })`

#### Scenario: Continue with --model empty value errors and exits 1

- **WHEN** the user runs `gemiterm continue conv-abc123 --model ""`
- **THEN** the output contains `Error: --model requires a non-empty value.` and the process exits with code 1

#### Scenario: Continue with --model uses context defaultModel when flag is absent

- **WHEN** the user runs `gemiterm continue conv-abc123 "Hi"` and the `CliCommandContext.defaultModel` is `"gemini-3-lite"`
- **THEN** the chat-session helper invokes `GeminiClientService.sendMessage` with the second argument `"gemini-3-lite"`

#### Scenario: Continue with --model short flag -m is equivalent

- **WHEN** the user runs `gemiterm continue conv-abc123 -m gemini-3-flash`
- **THEN** the command behaves identically to `--model gemini-3-flash`

#### Scenario: Continue --help shows usage

- **WHEN** the user runs `gemiterm continue --help`
- **THEN** the output contains `Usage: gemiterm continue [conversation_id] [message] [options]` and documents `/exit`, `/quit`, and `--help`

#### Scenario: Continue --help documents --model

- **WHEN** the user runs `gemiterm continue --help`
- **THEN** the output contains `Usage: gemiterm continue [conversation_id] [message] [options]` and documents `--model, -m <name>`, `/exit`, `/quit`, and `--help`

### Requirement: NewCommand

The system MUST provide a `new` command implemented by `NewCommand` in `src/cli/commands/new-command.ts`. The command MUST accept an optional positional `<message>` and MUST support `--profile/-p <name>`, `--model/-m <name>`, and `--help/-h`. When `<message>` is present, the command MUST call `GeminiClientService.startNewChat(message, model)` where `model` is the resolved model (CLI `--model` if non-empty, else the context `defaultModel`, else `Model.BASIC_FLASH`) and MUST print the new conversation id and the model response. When `<message>` is absent, the command MUST start an interactive REPL that starts a new chat on the first non-empty line (using the resolved model) and continues with `sendMessage(conversationId, message, model)` against the resulting `conversationId` for subsequent lines, passing the same resolved model to every dispatch; the REPL MUST exit on `/exit` or `/quit`. When `--model` is supplied with an empty value, the command MUST print `Error: --model requires a non-empty value.` to stderr and exit with code 1. When `--prompt-file` and a positional message are both supplied, the command MUST print the existing `Error: cannot use --prompt-file together with a positional message argument.` to stderr and exit with code 1.

#### Scenario: New with message starts a chat and prints the conversation id

- **WHEN** the user runs `gemiterm new "Hello Gemini"`
- **THEN** `GeminiClientService.startNewChat("Hello Gemini", <resolved model>)` is called, the output contains `Conversation ID: <id>`, and the model response is printed after a `Model:` label

#### Scenario: New with --profile includes the profileName in dispatch

- **WHEN** the user runs `gemiterm new "Hi" --profile work`
- **THEN** the chat-session helper resolves the client through `forProfile("work")` and the resolved model is passed to `startNewChat`

#### Scenario: New with no message starts an interactive REPL

- **WHEN** the user runs `gemiterm new` with no message
- **THEN** the command enters a REPL; the first non-empty line triggers `startNewChat(line, <resolved model>)` and subsequent lines trigger `sendMessage(conversationId, line, <resolved model>)` against the resulting conversation id

#### Scenario: New REPL exits on /exit or /quit

- **WHEN** the user types `/exit` or `/quit` in the new-command REPL
- **THEN** the readline interface closes and the command returns

#### Scenario: New with --model passes the model to startNewChat

- **WHEN** the user runs `gemiterm new "Hi" --model gemini-3-pro`
- **THEN** `GeminiClientService.startNewChat("Hi", "gemini-3-pro")` is called and `client.newChat({ model: "gemini-3-pro" })` is the wire call

#### Scenario: New with --model empty value errors and exits 1

- **WHEN** the user runs `gemiterm new "Hi" --model ""`
- **THEN** the output contains `Error: --model requires a non-empty value.` and the process exits with code 1

#### Scenario: New without --model uses context defaultModel

- **WHEN** the user runs `gemiterm new "Hi"` and the `CliCommandContext.defaultModel` is `"gemini-3-flash"`
- **THEN** `GeminiClientService.startNewChat("Hi", "gemini-3-flash")` is called

#### Scenario: New with --model short flag -m is equivalent

- **WHEN** the user runs `gemiterm new -m gemini-3-flash "Hi"`
- **THEN** the command behaves identically to `--model gemini-3-flash`

#### Scenario: New --help shows usage

- **WHEN** the user runs `gemiterm new --help`
- **THEN** the output contains `Usage: gemiterm new [message] [options]` and documents `--profile`, `--help`, and the `/exit` / `/quit` REPL commands

#### Scenario: New --help documents --model

- **WHEN** the user runs `gemiterm new --help`
- **THEN** the output contains `Usage: gemiterm new [message] [options]` and documents `--model, -m <name>`, `--profile`, `--help`, and the `/exit` / `/quit` REPL commands

## ADDED Requirements

### Requirement: ModelsCommand

The system MUST provide a `models` command implemented by `ModelsCommand` in `src/cli/commands/models-command.ts`, registered under the name `models`. The command MUST support `--help/-h`. When `--help` is supplied, the command MUST print a usage block starting with `Usage: gemiterm models` and return without contacting Gemini. Otherwise the command MUST call `GeminiClientService.listModels()` to obtain the list of available model identifiers and `GeminiClientService.getDefaultModel()` to obtain the resolved-default model string. For each model returned by `listModels()`, the command MUST print one line of the form `  <model>` in the order returned, with ` (default)` appended as a suffix on the line whose model exactly equals the `getDefaultModel()` return value (case-sensitive comparison). When `getDefaultModel()` returns a non-empty string, the command MUST additionally print a trailing hint line of the form `Use --model <name> (or set GEMITERM_MODEL=<name>) to select. The default is currently <name>.` to stdout. When `getDefaultModel()` returns the empty string, the command MUST NOT append the hint line and MUST NOT suffix any model with `(default)`. The command MUST print `<N> model(s) available` to the logger at info level (where `<N>` is the number of models returned by `listModels()`). The command MUST NOT perform a network call when `--help` is supplied.

#### Scenario: Models lists every model returned by listModels

- **WHEN** the user runs `gemiterm models` and `client.listModels()` resolves to `["gemini-3-flash", "gemini-3-pro", "gemini-3-lite"]`
- **THEN** stdout contains exactly three lines beginning with `  gemini-3-flash`, `  gemini-3-pro`, and `  gemini-3-lite`
- **AND** the line for `gemini-3-flash` ends with ` (default)` when `getDefaultModel()` returns `"gemini-3-flash"`
- **AND** a hint line `Use --model <name> (or set GEMITERM_MODEL=<name>) to select. The default is currently gemini-3-flash.` is appended

#### Scenario: Models with no resolved default omits the marker and hint

- **WHEN** the user runs `gemiterm models` and `client.getDefaultModel()` resolves to `""`
- **THEN** stdout contains one line per model, none suffixed with ` (default)`
- **AND** no hint line is appended

#### Scenario: Models --help shows usage

- **WHEN** the user runs `gemiterm models --help`
- **THEN** the output contains `Usage: gemiterm models` and documents `--help`
- **AND** no `client.listModels()` call is made

#### Scenario: Models with empty catalog prints the count and no list lines

- **WHEN** the user runs `gemiterm models` and `client.listModels()` resolves to `[]`
- **THEN** stdout contains only the hint line (when `getDefaultModel()` is non-empty) or is otherwise empty
- **AND** `<N> model(s) available` is logged with `<N> = 0`