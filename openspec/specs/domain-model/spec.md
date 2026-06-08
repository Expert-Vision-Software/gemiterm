## Purpose

The shared domain types and error hierarchy used across the core, services, infrastructure, and CLI layers. The domain model defines the shape of cookies, messages, conversations, chat metadata, profile status, and the typed error classes that every layer raises and handles.

## Requirements

### Requirement: Profile Status Type
The system MUST export a `ProfileStatus` interface with five fields: `name: string`, `exists: boolean`, `isActive: boolean`, `expiresAt: string | null`, and `isDefault: boolean`. The interface MUST be used to communicate the state of a single profile directory on disk and its cookies.

#### Scenario: Constructing a profile status
- **WHEN** a profile `"work"` exists, has fresh cookies, and is the default
- **THEN** a value of `{ name: "work", exists: true, isActive: true, expiresAt: "<iso>", isDefault: true }` satisfies the `ProfileStatus` interface

### Requirement: Chat Info Type
The system MUST export a `ChatInfo` interface with four fields: `id: string`, `title: string`, `isPinned: boolean`, and `timestamp: number`. The interface MUST represent one entry in the user's conversation list.

#### Scenario: Constructing a chat info entry
- **WHEN** a chat has identifier `"abc"`, title `"Hello"`, is pinned, and a numeric timestamp
- **THEN** `{ id: "abc", title: "Hello", isPinned: true, timestamp: 1718000000000 }` satisfies the `ChatInfo` interface

### Requirement: Message Type
The system MUST export a `Message` interface with three fields: `role: "user" | "model"`, `content: string`, and an optional `conversationId?: string`. The `role` field MUST be a string-literal union restricted to `"user"` or `"model"`.

#### Scenario: Constructing a user message
- **WHEN** a user submits `"Hi there"` to conversation `"c1"`
- **THEN** `{ role: "user", content: "Hi there", conversationId: "c1" }` satisfies the `Message` interface

#### Scenario: Constructing a model message
- **WHEN** the model responds with `"Hello!"` and no conversation id is bound
- **THEN** `{ role: "model", content: "Hello!" }` satisfies the `Message` interface

### Requirement: Conversation Type
The system MUST export a `Conversation` interface with three fields: `id: string`, `title: string`, and `messages: Message[]`. The `messages` array MUST be ordered chronologically (oldest first).

#### Scenario: Constructing a conversation
- **WHEN** a conversation has identifier `"c1"`, title `"Demo"`, and two messages
- **THEN** `{ id: "c1", title: "Demo", messages: [{ role: "user", content: "Hi" }, { role: "model", content: "Hello" }] }` satisfies the `Conversation` interface

### Requirement: Auth Result Type
The system MUST export an `AuthResult` interface with two fields: `cookies: Cookie[]` and `expiresAt: Date | null`. The interface MUST be the return type of a successful authentication flow.

#### Scenario: Constructing an auth result
- **WHEN** an authentication flow returns two cookies and a known expiry date
- **THEN** `{ cookies: [...], expiresAt: new Date(...) }` satisfies the `AuthResult` interface

### Requirement: Cookie Type
The system MUST export a `Cookie` interface with eight fields: `name: string`, `value: string`, `domain: string`, `path: string`, `expires: number` (Unix seconds), `httpOnly: boolean`, `secure: boolean`, and `sameSite: "Strict" | "Lax" | "None"`. The `sameSite` field MUST be the string-literal union `"Strict" | "Lax" | "None"`.

#### Scenario: Constructing a strict same-site cookie
- **WHEN** a cookie named `"SID"` with `sameSite: "Strict"` is created
- **THEN** the value satisfies the `Cookie` interface and the `sameSite` field is one of the three allowed literals

#### Scenario: Constructing a lax same-site cookie
- **WHEN** a cookie with `sameSite: "Lax"` is created
- **THEN** the value satisfies the `Cookie` interface

#### Scenario: Constructing a none same-site cookie
- **WHEN** a cookie with `sameSite: "None"` is created
- **THEN** the value satisfies the `Cookie` interface

### Requirement: Base GemitermError Class
The system MUST export a `GemitermError` class that extends the built-in `Error` class. The constructor MUST accept a `message: string` and store it on `this.message`. The constructor MUST set `this.name` to the literal string `"GemitermError"`. `GemitermError` MUST be the base class for every other domain error in the system.

#### Scenario: GemitermError preserves message
- **WHEN** a caller constructs `new GemitermError("oops")`
- **THEN** `err.message === "oops"`, `err.name === "GemitermError"`, and `err instanceof GemitermError === true`

#### Scenario: GemitermError is an Error
- **WHEN** a `GemitermError` is constructed
- **THEN** it is also an instance of the built-in `Error` class

### Requirement: AuthenticationError Class
The system MUST export an `AuthenticationError` class that extends `GemitermError`. The constructor MUST accept an optional `message` string. When no message is supplied, the default MUST be the literal string `Not authenticated. Please run 'gemiterm login' first.`. The constructor MUST set `this.name` to `"AuthenticationError"`.

#### Scenario: Default authentication error
- **WHEN** `new AuthenticationError()` is constructed
- **THEN** `err.message` is the default auth message, `err.name === "AuthenticationError"`, and `err instanceof GemitermError` is `true`

#### Scenario: Custom authentication error
- **WHEN** `new AuthenticationError("token invalid")` is constructed
- **THEN** `err.message === "token invalid"`

### Requirement: CookieExpiredError Class
The system MUST export a `CookieExpiredError` class that extends `GemitermError`. The constructor MUST accept an optional `message` string. When no message is supplied, the default MUST be the literal string `Session has expired. Please run 'gemiterm login' again.`. The constructor MUST set `this.name` to `"CookieExpiredError"`.

#### Scenario: Default cookie-expired error
- **WHEN** `new CookieExpiredError()` is constructed
- **THEN** `err.message` is the default expiry message, `err.name === "CookieExpiredError"`, and `err instanceof GemitermError` is `true`

#### Scenario: Custom cookie-expired error
- **WHEN** `new CookieExpiredError("expired at 12:00")` is constructed
- **THEN** `err.message === "expired at 12:00"`

### Requirement: GeminiAPIError Class
The system MUST export a `GeminiAPIError` class that extends `GemitermError`. The constructor MUST accept a required `message: string` and store it. The constructor MUST set `this.name` to `"GeminiAPIError"`.

#### Scenario: API error with custom message
- **WHEN** `new GeminiAPIError("rate limit exceeded")` is constructed
- **THEN** `err.message === "rate limit exceeded"`, `err.name === "GeminiAPIError"`, and `err instanceof GemitermError` is `true`

### Requirement: ConversationNotFoundError Class
The system MUST export a `ConversationNotFoundError` class that extends `GemitermError`. The constructor MUST accept a required `conversationId: string` and MUST compose the message as `Conversation '<conversationId>' not found.`. The constructor MUST set `this.name` to `"ConversationNotFoundError"`.

#### Scenario: Conversation-not-found error with id
- **WHEN** `new ConversationNotFoundError("conv-123")` is constructed
- **THEN** `err.message === "Conversation 'conv-123' not found."`, `err.name === "ConversationNotFoundError"`, and `err instanceof GemitermError` is `true`

### Requirement: ConversationPendingError Class
The system MUST export a `ConversationPendingError` class that extends `GemitermError`. The constructor MUST accept an optional `message` string. When no message is supplied, the default MUST be the literal string `Conversation operation is still pending.`. The constructor MUST set `this.name` to `"ConversationPendingError"`.

#### Scenario: Default conversation-pending error
- **WHEN** `new ConversationPendingError()` is constructed
- **THEN** `err.message` is the default pending message, `err.name === "ConversationPendingError"`, and `err instanceof GemitermError` is `true`

#### Scenario: Custom conversation-pending error
- **WHEN** `new ConversationPendingError("still generating")` is constructed
- **THEN** `err.message === "still generating"`

### Requirement: All Domain Errors Extend GemitermError
Every concrete error class in the domain hierarchy (`AuthenticationError`, `CookieExpiredError`, `GeminiAPIError`, `ConversationNotFoundError`, `ConversationPendingError`) MUST be a subclass of `GemitermError`. As a consequence, every domain error MUST also be an instance of the built-in `Error` class.

#### Scenario: Every domain error is a GemitermError
- **WHEN** a test iterates over `AuthenticationError`, `CookieExpiredError`, `GeminiAPIError`, `ConversationNotFoundError`, and `ConversationPendingError` with default-constructible arguments
- **THEN** every constructed instance is `instanceof GemitermError`

#### Scenario: Every domain error is an Error
- **WHEN** the same iteration is performed
- **THEN** every constructed instance is also `instanceof Error`
