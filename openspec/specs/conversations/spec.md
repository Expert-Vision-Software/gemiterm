## Purpose

The Gemini API client wrapper. It owns the `GeminiClientService` class that implements both the `IGeminiClientService` (used by command handlers for mutations: delete, send, start-new) and the `IGeminiClientQueryService` (used by query handlers for reads: list chats, fetch chat, list models) interfaces. The wrapper issues authenticated `fetch` requests against `https://gemini.google.com`, attaching the `__Secure-1PSID` and `__Secure-1PSIDTS` cookies, and translates Gemini API responses into the domain types `ChatInfo` and `Message`.
## Requirements
### Requirement: GeminiClientService is constructed from cookies and a logger
The `GeminiClientService` constructor MUST accept two arguments: a config object with `secure1psid: string` and an optional `secure1psidts?: string | null`, and a `Logger` instance. The `authenticated` flag MUST be initialized to `true` when `secure1psid` is a non-empty string and `false` otherwise. The class MUST implement BOTH `IGeminiClientService` and `IGeminiClientQueryService`.

#### Scenario: Service initializes as authenticated with a 1PSID
- **WHEN** a `GeminiClientService` is constructed with `{ secure1psid: "abc" }` and a logger
- **THEN** `isAuthenticated()` returns `true`

#### Scenario: Service initializes as unauthenticated without a 1PSID
- **WHEN** a `GeminiClientService` is constructed with `{ secure1psid: "" }` and a logger
- **THEN** `isAuthenticated()` returns `false`

### Requirement: GeminiClientService builds the cookie header from the configured cookies
For every authenticated request, the service MUST build a `Cookie` header that includes `__Secure-1PSID=<value>` and, when `secure1psidts` is non-null/non-empty, an additional `__Secure-1PSIDTS=<value>` segment joined by `; `. The header MUST be combined with the default headers `Content-Type: application/x-www-form-urlencoded` and a Chrome User-Agent string.

#### Scenario: Cookie header includes both cookies when present
- **WHEN** the service is configured with both `secure1psid` and `secure1psidts`
- **THEN** outgoing requests carry a `Cookie` header whose value is `__Secure-1PSID=<psid>; __Secure-1PSIDTS=<psidts>`

#### Scenario: Cookie header includes only 1PSID when 1PSIDTS is absent
- **WHEN** the service is configured with `secure1psid` and `secure1psidts: null`
- **THEN** outgoing requests carry a `Cookie` header whose value is `__Secure-1PSID=<psid>` (no 1PSIDTS segment)

### Requirement: GeminiClientService.listChats returns ChatInfo sorted by recency
The `listChats(options?)` method MUST GET `/app/api/chat/history` and parse the response JSON. Each entry in the `chats` array MUST be mapped to a `ChatInfo` object with fields:
- `id: string` (from the API's `cid`)
- `title: string` (from the API's `title`, defaulting to `"Untitled"` when missing)
- `isPinned: boolean` (from the API's `is_pinned`, defaulting to `false` when missing)
- `timestamp: number` (from the API's `timestamp`, defaulting to `0` when missing)

The `ChatInfo` type MUST NOT include a `profile` field at this time. After mapping, the method MUST sort the array by `timestamp` descending, apply an in-memory `search` filter on the lowercased `title` when `options.search` is provided, then apply `options.offset` (skip) and `options.limit` (truncate) in that order. Network errors MUST be re-thrown as `GeminiAPIError`; HTTP 401/403 MUST be re-thrown as `AuthenticationError` with the message `Session expired or invalid. Please run 'gemiterm login' again.` and the service MUST mark itself unauthenticated.

#### Scenario: listChats maps API response to ChatInfo
- **WHEN** `/app/api/chat/history` returns a JSON object with a `chats` array of objects with `cid`, `title`, `is_pinned`, and `timestamp` fields
- **THEN** the method resolves with a `ChatInfo[]` whose elements have `id` (from `cid`), `title`, `isPinned` (from `is_pinned`), and `timestamp` fields, and no `profile` field is present on any element

#### Scenario: listChats sorts results by timestamp descending
- **WHEN** the API returns chats with timestamps `1000` and `2000`
- **THEN** the resolved array is ordered with the `timestamp: 2000` entry first and the `timestamp: 1000` entry second

#### Scenario: listChats applies the search filter
- **WHEN** `listChats({ search: "hello" })` is called and the response contains chats with mixed titles
- **THEN** the resolved array contains only chats whose lowercased title includes the substring `hello`

#### Scenario: listChats applies limit and offset in order
- **WHEN** `listChats({ offset: 5, limit: 10 })` is called and the sorted response has 20 entries
- **THEN** the resolved array has length 10 and is the slice of the sorted response from index 5 to index 14 (inclusive)

#### Scenario: listChats surfaces 401/403 as AuthenticationError
- **WHEN** the upstream API responds with HTTP 401 or 403
- **THEN** the method rejects with an `AuthenticationError` whose message contains `Session expired` and `isAuthenticated()` returns `false` thereafter

### Requirement: GeminiClientService.fetchChat returns ordered messages
The `fetchChat(conversationId)` method MUST GET `/app/api/chat/history/<encoded-conversationId>` and parse the `turns` array. Each turn MUST be converted to a `Message` with:
- `role: "user" | "model"` (mapped from the turn's `role`; non-`"user"` roles are normalized to `"model"`)
- `content: string` (built from `turn.text` when present, else by joining `turn.parts[].text` strings, else the empty string)
- `conversationId: string` (the same conversation id passed to the method)

Errors from the underlying fetch MUST be wrapped in `GeminiAPIError` unless they are already a `GeminiAPIError` or `AuthenticationError`.

#### Scenario: fetchChat returns messages with role and content
- **WHEN** `/app/api/chat/history/<id>` returns a `turns` array with user and model turns
- **THEN** the method resolves with a `Message[]` whose entries have the correct `role` (`"user"` or `"model"`) and `content`, and whose `conversationId` matches the input

#### Scenario: fetchChat builds content from parts when text is absent
- **WHEN** a turn has no `text` field but has `parts: [{ text: "a" }, { text: "b" }]`
- **THEN** the resulting `Message.content` is the string `"ab"` (parts joined)

### Requirement: GeminiClientService.deleteChat removes a conversation
The `deleteChat(conversationId)` method MUST issue `DELETE /app/api/chat/history/<encoded-conversationId>`. Errors MUST be wrapped in `GeminiAPIError` unless they are already a `GeminiAPIError` or `AuthenticationError`.

#### Scenario: deleteChat issues a DELETE to the history endpoint
- **WHEN** `deleteChat("conv-1")` is called
- **THEN** the underlying request is `DELETE https://gemini.google.com/app/api/chat/history/conv-1`

#### Scenario: deleteChat surfaces upstream errors as GeminiAPIError
- **WHEN** the upstream API responds with a non-2xx status other than 401/403
- **THEN** the method rejects with a `GeminiAPIError` whose message contains the status code

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

### Requirement: GeminiClientService.listModels returns model display names
The `listModels()` method MUST GET `/app/api/models` and parse the `models` array. For each entry, the method MUST return `display_name` when present, else `name`. When the response has no `models` field, the method MUST return `[]`.

#### Scenario: listModels returns display names
- **WHEN** the API responds with `{ "models": [{ "name": "x", "display_name": "Gemini Pro" }, { "name": "y" }] }`
- **THEN** the method resolves with `["Gemini Pro", "y"]`

#### Scenario: listModels returns empty array when no models field
- **WHEN** the API responds with `{}`
- **THEN** the method resolves with `[]`

### Requirement: GeminiClientService.isAuthenticated reports the current session state
The `isAuthenticated()` method MUST return the value of the internal `authenticated` flag. The flag MUST be initialized based on the constructor config and MUST be reset to `false` whenever a request surfaces a 401/403 response (so subsequent calls to mutating/querying methods throw `AuthenticationError`).

#### Scenario: Returns true after successful construction
- **WHEN** the service is constructed with a non-empty `secure1psid`
- **THEN** `isAuthenticated()` returns `true`

#### Scenario: Returns false after a 401/403 response
- **WHEN** any method issues a request that returns 401 or 403
- **THEN** the subsequent `isAuthenticated()` call returns `false`

#### Scenario: Mutating methods throw AuthenticationError when not authenticated
- **WHEN** the service is constructed with an empty `secure1psid` and `deleteChat`, `sendMessage`, or `startNewChat` is called
- **THEN** the call rejects with an `AuthenticationError` (no network call is made)

### Requirement: GeminiClientService.sendMessage restores chat metadata for thread continuity

The `sendMessage(conversationId, message)` method MUST thread the
`SendMessageCommand` onto the named conversation rather than creating a new
one. To do so it MUST look up per-profile persisted chat metadata for
`conversationId` and, when found, construct the underlying
`gemini-reverse` `ChatSession` via `client.newChat({ metadata })` with the
persisted metadata's `rid`, `rcid`, and `ctx` slots restored; the
`gemini-reverse` README documents the wire contract (`[cid, rid, rcid, ...]`
uniquely identifies the conversation turn, and storing and restoring the
metadata is what allows `continue` to resume the exact conversation context).

When no persisted metadata exists for `(profile, conversationId)`, the
method MUST fall back to the existing `newChat() + session.cid = cid` path
and log the fallback at debug level; the call still resolves normally and
the response text is still returned. The fallback preserves byte-level
equivalence with the pre-fix behavior for any cid whose first metadata
write has not yet happened (legacy chats and the first turn of any new
chat).

After every successful `sendMessage` call, the method MUST extract the
returned `output.metadata` array and persist `rid`, `rcid`, and `ctx` (slot
9) under the key `(profileName, conversationId)` so the next turn of the
same conversation threads without a re-fetch. The extraction step MUST be
failure-isolated: a malformed or empty metadata array MUST NOT cause the
user's `sendMessage` call to throw; the persistence call's own failures
MUST also be isolated (logged at debug level, in-memory cache updated
regardless).

#### Scenario: sendMessage with persisted metadata threads onto the existing conversation
- **WHEN** `sendMessage("conv-xyz", "msg")` is called on a profile whose
  persisted metadata for `conv-xyz` is `{ rid: "rid-1", rcid: "rcid-1", ctx: null }`
- **THEN** the request body the wrapper sends to the upstream
  `StreamGenerate` endpoint carries `chat.metadata = ["conv-xyz", "rid-1", "rcid-1", null, null, null, null, null, null, ""]`
- **AND** the model response references the conversation's prior turns

#### Scenario: sendMessage with no persisted metadata falls back to cid-only
- **WHEN** `sendMessage("conv-legacy", "msg")` is called on a profile
  whose persisted-metadata store has no entry for `conv-legacy`
- **THEN** the wrapper logs at debug level naming the profile and the cid
- **AND** the request body the wrapper sends to upstream carries
  `chat.metadata = ["conv-legacy", "", "", null, null, null, null, null, null, ""]`
- **AND** `sendMessage` resolves normally with the response text
- **AND** the byte-level output to the user matches the pre-fix behavior

#### Scenario: sendMessage captures new rid/rcid into the persisted store
- **WHEN** `sendMessage("conv-xyz", "msg")` returns successfully and the
  upstream response's `metadata` array is
  `["conv-xyz", "rid-new", "rcid-new", null, null, null, null, null, null, ""]`
- **THEN** the persisted store for `(profile, "conv-xyz")` is updated to
  `{ rid: "rid-new", rcid: "rcid-new", ctx: null }`
- **AND** a subsequent `sendMessage("conv-xyz", "next")` on the same
  process reads the updated store and threads with `rid-new` / `rcid-new`

#### Scenario: Persistence is skipped on the factory-client path
- **WHEN** `sendMessage` is called on a `GeminiClientService` instance
  constructed without a `profileName` (the CLI factory instance used when
  no profile lookup happened)
- **THEN** the persistence call is skipped (no write, no `lookup`)

#### Scenario: Persistence failure does not fail the send
- **WHEN** the underlying `chat-metadata.json` write throws an `IOError`
- **THEN** `sendMessage` resolves normally with the response text
- **AND** the failure is logged at debug level

### Requirement: startNewChat persists chat metadata

The `startNewChat(message)` method MUST extract `rid`, `rcid`, and `ctx`
from the response's `output.metadata` after a successful
`generateContent` call and persist them via the storage layer under
`(profileName, conversationId)`. The existing return shape
`{ response, conversationId }` stays the same; persistence is a
side-effect. Persistence is gated on `this.profileName` being set;
the factory-client case is a no-op.

#### Scenario: startNewChat persists metadata for the new cid
- **WHEN** `startNewChat("msg")` returns successfully and the upstream
  response's `metadata` array is
  `["generated-cid", "rid-a", "rcid-a", null, null, null, null, null, null, ""]`
- **THEN** the persisted store for `(profile, "generated-cid")` is updated
  to `{ rid: "rid-a", rcid: "rcid-a", ctx: null }`

#### Scenario: startNewChat does NOT persist when the mock response has empty rid/rcid
- **WHEN** `startNewChat("msg")` returns successfully and the upstream
  response's `metadata` array has empty `rid` and `rcid` strings
- **THEN** the persisted store has no entry for the new cid
- **AND** no file write occurs

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

