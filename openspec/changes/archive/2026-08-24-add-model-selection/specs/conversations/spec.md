## MODIFIED Requirements

### Requirement: GeminiClientService.sendMessage returns the model response text

The `sendMessage(conversationId, message, model?)` method MUST POST `/app/api/chat/<encoded-conversationId>/send` with a URL-encoded form body of `message=<message>`. The response JSON MUST be read, and the method MUST return the value of the `response` field, falling back to the `text` field, falling back to the empty string. The method MUST accept an optional third parameter `model?: string`. When `model` is supplied as a non-empty string, the method MUST construct the underlying chat session via `client.newChat({ model })` so that the wire request targets the named model; when `model` is omitted or empty, the method MUST preserve the pre-change `newChat()` no-options behavior (server-side model selection). The `model` parameter MUST NOT be sent on the wire as a separate field; it MUST be reflected only in the `ChatSession` constructed via `newChat`. An invalid model name MUST surface as `GeminiAPIError("Model is invalid or unavailable")` via the existing `translateError` `ModelInvalid` branch at `src/services/gemini-client-wrapper.ts:149-151`.

#### Scenario: sendMessage returns the response field

- **WHEN** the API responds with `{ "response": "Hello!" }`
- **THEN** the method resolves with the string `Hello!`

#### Scenario: sendMessage falls back to the text field

- **WHEN** the API responds with `{ "text": "Hi" }` and no `response` field
- **THEN** the method resolves with the string `Hi`

#### Scenario: sendMessage returns empty string when neither field is present

- **WHEN** the API responds with `{}`
- **THEN** the method resolves with the string `""`

#### Scenario: sendMessage with model forwards model to newChat

- **WHEN** `sendMessage("conv-1", "Hi", "gemini-3-pro")` is called
- **THEN** the wrapper calls `client.newChat({ model: "gemini-3-pro" })` and the resulting `ChatSession.generateContent` carries the model selection on the wire

#### Scenario: sendMessage with empty model preserves no-options behavior

- **WHEN** `sendMessage("conv-1", "Hi", "")` is called
- **THEN** the wrapper calls `client.newChat()` with no options (the pre-change behavior) and the model parameter is treated as absent

#### Scenario: sendMessage with model omitted preserves no-options behavior

- **WHEN** `sendMessage("conv-1", "Hi")` is called (no `model` argument)
- **THEN** the wrapper calls `client.newChat()` with no options (the pre-change behavior)

#### Scenario: sendMessage with invalid model surfaces GeminiAPIError

- **WHEN** `sendMessage("conv-1", "Hi", "not-a-real-model")` is called and the upstream SDK throws `ModelInvalid`
- **THEN** the method rejects with `GeminiAPIError` whose message contains `Model is invalid or unavailable`

### Requirement: GeminiClientService.startNewChat returns response and conversation id

The `startNewChat(message, model?)` method MUST POST `/app/api/chat/new` with a URL-encoded form body of `message=<message>`. The response MUST be read and a `{ response, conversationId }` object returned, where `response` is `data.response ?? data.text ?? ""` and `conversationId` is `data.cid ?? data.conversation_id ?? ""`. Errors MUST be wrapped in `GeminiAPIError` unless they are already a `GeminiAPIError` or `AuthenticationError`. The method MUST accept an optional second parameter `model?: string`. When `model` is supplied as a non-empty string, the method MUST construct the underlying chat session via `client.newChat({ model })`; when omitted or empty, the method MUST preserve the pre-change `newChat()` no-options behavior. An invalid model name MUST surface as `GeminiAPIError("Model is invalid or unavailable")` via the existing `translateError` `ModelInvalid` branch.

#### Scenario: startNewChat returns the new conversation id

- **WHEN** the API responds with `{ "response": "Hi", "cid": "new-conv" }`
- **THEN** the method resolves with `{ response: "Hi", conversationId: "new-conv" }`

#### Scenario: startNewChat falls back to conversation_id and text

- **WHEN** the API responds with `{ "text": "Hello", "conversation_id": "fallback-id" }`
- **THEN** the method resolves with `{ response: "Hello", conversationId: "fallback-id" }`

#### Scenario: startNewChat returns empty strings when fields are absent

- **WHEN** the API responds with `{}`
- **THEN** the method resolves with `{ response: "", conversationId: "" }`

#### Scenario: startNewChat with model forwards model to newChat

- **WHEN** `startNewChat("Hi", "gemini-3-pro")` is called
- **THEN** the wrapper calls `client.newChat({ model: "gemini-3-pro" })` and the resulting `ChatSession.generateContent` carries the model selection on the wire

#### Scenario: startNewChat with empty model preserves no-options behavior

- **WHEN** `startNewChat("Hi", "")` is called
- **THEN** the wrapper calls `client.newChat()` with no options (the pre-change behavior) and the model parameter is treated as absent

#### Scenario: startNewChat with model omitted preserves no-options behavior

- **WHEN** `startNewChat("Hi")` is called (no `model` argument)
- **THEN** the wrapper calls `client.newChat()` with no options (the pre-change behavior)

#### Scenario: startNewChat with invalid model surfaces GeminiAPIError

- **WHEN** `startNewChat("Hi", "not-a-real-model")` is called and the upstream SDK throws `ModelInvalid`
- **THEN** the method rejects with `GeminiAPIError` whose message contains `Model is invalid or unavailable`

## ADDED Requirements

### Requirement: GeminiClientService.getDefaultModel returns the resolved default model

The `getDefaultModel()` method MUST return the model string that `sendMessage` and `startNewChat` would use when no explicit `model` argument is supplied. The resolution order MUST be:

1. The value of the `GEMITERM_MODEL` environment variable when it is set to a non-empty string (trimmed; whitespace-only is treated as unset).
2. Otherwise, the constant `"gemini-3-flash"` (the `model_name` of `Model.BASIC_FLASH` from `gemini-web-sdk`'s `Model` enum).

The method MUST NOT perform a network call. The method MUST be safe to call before `init()`. When invoked, it MUST read `process.env.GEMITERM_MODEL` afresh on each call (so test stubs that mutate the environment are observed), and MUST return the trimmed value or `""` when neither source applies. The method MUST be available on every `GeminiClientService` instance, including instances returned by `forProfile(name)`; the resolved default is process-wide (not per-profile).

#### Scenario: getDefaultModel returns the env var when GEMITERM_MODEL is set

- **WHEN** `process.env.GEMITERM_MODEL === "gemini-3-pro"` and `getDefaultModel()` is called
- **THEN** the method returns the string `"gemini-3-pro"`

#### Scenario: getDefaultModel trims whitespace from the env var

- **WHEN** `process.env.GEMITERM_MODEL === "  gemini-3-pro  "` and `getDefaultModel()` is called
- **THEN** the method returns the trimmed string `"gemini-3-pro"`

#### Scenario: getDefaultModel ignores a whitespace-only env var

- **WHEN** `process.env.GEMITERM_MODEL === "   "` and `getDefaultModel()` is called
- **THEN** the method returns the implicit default `"gemini-3-flash"`

#### Scenario: getDefaultModel returns the implicit default when env var is unset

- **WHEN** `process.env.GEMITERM_MODEL` is `undefined` and `getDefaultModel()` is called
- **THEN** the method returns the string `"gemini-3-flash"`

#### Scenario: getDefaultModel does not perform a network call

- **WHEN** `getDefaultModel()` is called on a `GeminiClientService` whose `init()` has not been awaited
- **THEN** the method resolves synchronously without invoking `client.init()` or any network operation

#### Scenario: getDefaultModel is process-wide, not per-profile

- **WHEN** `factory.getDefaultModel()` and `(await factory.forProfile("work")).getDefaultModel()` are both called with the same `process.env.GEMITERM_MODEL`
- **THEN** both invocations return the same string

#### Scenario: getDefaultModel reflects env changes within the same process

- **WHEN** `process.env.GEMITERM_MODEL` is set to `"gemini-3-pro"`, then unset, then `getDefaultModel()` is called twice (once before the unset and once after)
- **THEN** the first call returns `"gemini-3-pro"` and the second returns `"gemini-3-flash"`