## MODIFIED Requirements

### Requirement: GeminiClientService exposes a profileHasConversation helper

The `GeminiClientService` class in `src/services/gemini-client-wrapper.ts` MUST expose a `profileHasConversation(profileName: string, conversationId: string): Promise<boolean>` method. The method MUST return `true` if the given conversation ID appears in the named profile's chat list, and `false` otherwise. The membership check MUST be correct for any conversation in the list regardless of recency; it MUST NOT rely on a `limit`-bounded `listChats` call that would exclude non-newest conversations. The `IGeminiClientService` interface in `src/core/command-handlers.ts` MUST declare the method so handlers and tests can use it without downcasting. The method MUST NOT mutate the calling instance's cookies or session state. The method MUST propagate API errors to the caller; it MUST NOT silently catch errors and return `false`.

#### Scenario: profileHasConversation returns true for owning profile
- **WHEN** `await geminiClient.profileHasConversation("work", "abc-123")` is called and conversation `abc-123` exists in `work`'s chat list
- **THEN** the method returns `true`

#### Scenario: profileHasConversation returns false for non-owning profile
- **WHEN** `await geminiClient.profileHasConversation("personal", "abc-123")` is called and conversation `abc-123` does NOT exist in `personal`'s chat list
- **THEN** the method returns `false`

#### Scenario: profileHasConversation returns true for a non-newest conversation
- **WHEN** `await geminiClient.profileHasConversation("work", "older-target")` is called and profile `work` has multiple chats where `older-target` is not the newest chat
- **THEN** the method returns `true` (the lookup does not exclude older conversations)

#### Scenario: profileHasConversation throws on API error
- **WHEN** `await geminiClient.profileHasConversation("work", "abc-123")` is called and the underlying `listChats()` call throws an error
- **THEN** the method throws that error to the caller (does NOT return `false`)

#### Scenario: profileHasConversation is declared on the IGeminiClientService interface
- **WHEN** a handler is typed against `IGeminiClientService` and calls `geminiClient.profileHasConversation(name, id)`
- **THEN** the call type-checks (the method is part of the interface, not a concrete-class-only method)

#### Scenario: profileHasConversation does not mutate the calling instance
- **WHEN** `geminiClient.profileHasConversation("work", "abc-123")` is called on an instance configured for the default profile
- **THEN** the calling instance's cookie config and `authenticated` flag are unchanged after the call returns (verified by reading the instance fields in a test)

#### Scenario: profileHasConversation scans the full chat list for membership
- **WHEN** `geminiClient.profileHasConversation("work", "abc-123")` is called
- **THEN** the underlying `listChats()` call is made without a `limit` that would truncate the result before membership is determined
