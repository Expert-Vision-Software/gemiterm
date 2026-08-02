## ADDED Requirements

### Requirement: list --all-profiles skips unauthenticated profiles and surfaces warnings

When `list --all-profiles` (or `list -i`) is executed, the system SHALL query only profiles with valid cookies. Profiles without valid cookies SHALL be skipped, and a warning SHALL be logged to stderr containing the profile name. The system SHALL NOT attempt API calls for unauthenticated profiles. Partial results from authenticated profiles SHALL be returned even if some profiles are skipped.

#### Scenario: One of three profiles is unauthenticated
- **WHEN** a user with profiles `work` (authenticated), `personal` (unauthenticated), and `test` (authenticated) runs `gemiterm list --all-profiles`
- **THEN** conversations from `work` and `test` are displayed
- **AND** a warning is printed to stderr: `"Warning: Skipping unauthenticated profile 'personal'"`
- **AND** no API calls are made for the `personal` profile

#### Scenario: No profiles are authenticated
- **WHEN** a user with no authenticated profiles runs `gemiterm list --all-profiles`
- **THEN** no API calls are made
- **AND** a warning is printed for each profile
- **AND** the output shows "No conversations found." (or empty JSON: `{"chats": []}`)

#### Scenario: An authenticated profile's API call fails
- **WHEN** a user with authenticated profiles `work` and `personal` runs `gemiterm list --all-profiles` and `personal`'s API call throws
- **THEN** conversations from `work` are displayed
- **AND** a warning is printed to stderr: `"Warning: Failed to list chats for profile 'personal': <error message>"`
- **AND** `work`'s results remain unaffected

## MODIFIED Requirements

### Requirement: GeminiClientService exposes a profileHasConversation helper

The `GeminiClientService` class in `src/services/gemini-client-wrapper.ts` MUST expose a `profileHasConversation(profileName: string, conversationId: string): Promise<boolean>` method. The method MUST return `true` if the given conversation ID appears in the named profile's chat list, and `false` otherwise. The `IGeminiClientService` interface in `src/core/command-handlers.ts` MUST declare the method so handlers and tests can use it without downcasting. The method MUST NOT mutate the calling instance's cookies or session state. The method MUST propagate API errors to the caller; it MUST NOT silently catch errors and return `false`.

#### Scenario: profileHasConversation returns true for owning profile
- **WHEN** `await geminiClient.profileHasConversation("work", "abc-123")` is called and conversation `abc-123` exists in `work`'s chat list
- **THEN** the method returns `true`

#### Scenario: profileHasConversation returns false for non-owning profile
- **WHEN** `await geminiClient.profileHasConversation("personal", "abc-123")` is called and conversation `abc-123` does NOT exist in `personal`'s chat list
- **THEN** the method returns `false`

#### Scenario: profileHasConversation throws on API error
- **WHEN** `await geminiClient.profileHasConversation("work", "abc-123")` is called and the underlying `listChats()` call throws an error
- **THEN** the method throws that error to the caller (does NOT return `false`)

#### Scenario: profileHasConversation is declared on the IGeminiClientService interface
- **WHEN** a handler is typed against `IGeminiClientService` and calls `geminiClient.profileHasConversation(name, id)`
- **THEN** the call type-checks (the method is part of the interface, not a concrete-class-only method)

#### Scenario: profileHasConversation does not mutate the calling instance
- **WHEN** `geminiClient.profileHasConversation("work", "abc-123")` is called on an instance configured for the default profile
- **THEN** the calling instance's cookie config and `authenticated` flag are unchanged after the call returns (verified by reading the instance fields in a test)

#### Scenario: profileHasConversation uses a targeted lookup
- **WHEN** `geminiClient.profileHasConversation("work", "abc-123")` is called
- **THEN** the underlying `listChats()` call uses `limit` to avoid fetching all conversations
