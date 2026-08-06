## Purpose

Multi-profile conversation ownership and routing. This capability enables the CLI to correctly identify which authenticated profile owns a given conversation, route `continue` and `delete` commands to the owning profile, and display profile ownership in `list --all-profiles` output.
## Requirements
### Requirement: findProfileForConversation returns the profile that owns a conversation

The system MUST return the name of the profile whose server-side chat list contains the given conversation ID. The `conversationId` argument MUST be passed to the per-profile lookup helper; it MUST NOT be ignored. When no profile owns the conversation, the system MUST return `null`. When multiple profiles report ownership of the same conversation ID (an inconsistent state the user is responsible for), the system MUST return the first profile in `profileManager.list()` order that reports ownership.

#### Scenario: Conversation exists in one profile
- **WHEN** `findProfileForConversation("abc-123")` is called and conversation `abc-123` exists in profile `work` but not in profile `personal`
- **THEN** the method returns the string `"work"`

#### Scenario: Conversation exists in no profile
- **WHEN** `findProfileForConversation("abc-123")` is called and conversation `abc-123` does not exist in any active profile's chat list
- **THEN** the method returns `null`

#### Scenario: Conversation exists in multiple profiles (inconsistent state)
- **WHEN** `findProfileForConversation("abc-123")` is called and conversation `abc-123` exists in both profile `work` and profile `personal`, and `profileManager.list()` returns `["work", "personal"]` in that order
- **THEN** the method returns the string `"work"` (the first profile in list order that reports ownership)

#### Scenario: The conversationId argument is actually used
- **WHEN** a unit test calls `findProfileForConversation("abc-123")` and the `profileHasConversation` helper is mocked
- **THEN** the mocked helper MUST have been invoked with the exact string `"abc-123"` (verified via `expect(mock).toHaveBeenCalledWith("work", "abc-123")` or an equivalent assertion); the method MUST NOT return early with a first-active-wins fallback

### Requirement: continue-command targets the profile that owns the conversation

The system MUST look up the profile that owns the conversation via `ProfileAuthManager.findProfileForConversation` before sending the `SendMessageCommand`. The system MUST route the message to that profile's `GeminiClientService` instance. When no profile owns the conversation, the system MUST throw `AuthenticationError` with a remediation message and exit non-zero. In a single-profile setup (only the default profile is active), the behavior MUST be unchanged: the default profile is used.

#### Scenario: Multi-profile continue routes to the owning profile
- **WHEN** a user with active profiles `work` and `personal` runs `gemiterm continue abc-123 "hello"` and conversation `abc-123` is owned by `work`
- **THEN** the `SendMessageCommand` is sent via the `work` profile's `GeminiClientService` (verified by the response content being scoped to the `work` account); the `personal` profile's `GeminiClientService` is NOT invoked for this send

#### Scenario: Continue on an unknown conversation ID exits non-zero
- **WHEN** a user runs `gemiterm continue unknown-id "hello"` and no profile owns conversation `unknown-id`
- **THEN** the command throws `AuthenticationError` whose message contains `"Could not find a profile that owns conversation 'unknown-id'"` and the suggested remediation `"gemiterm list --all-profiles"`, and the process exits with a non-zero exit code

#### Scenario: Single-profile continue is unchanged
- **WHEN** a user with only the default profile active runs `gemiterm continue abc-123 "hello"`
- **THEN** the behavior is identical to before the change: the default profile is used, no `findProfileForConversation` call is required, and the response is returned normally

### Requirement: delete-command targets the profile that owns the conversation

The system MUST look up the profile that owns the conversation via `ProfileAuthManager.findProfileForConversation` before sending the `DeleteConversationCommand`. The system MUST route the delete to that profile's `GeminiClientService` instance. When no profile owns the conversation, the system MUST throw `AuthenticationError` with the same remediation message used by `continue` and exit non-zero. In a single-profile setup, the behavior MUST be unchanged.

#### Scenario: Multi-profile delete routes to the owning profile
- **WHEN** a user with active profiles `work` and `personal` runs `gemiterm delete abc-123 --force` and conversation `abc-123` is owned by `work`
- **THEN** the `DeleteConversationCommand` is sent via the `work` profile's `GeminiClientService`; the `personal` profile's `GeminiClientService` is NOT invoked for this delete

#### Scenario: Delete on an unknown conversation ID exits non-zero
- **WHEN** a user runs `gemiterm delete unknown-id --force` and no profile owns conversation `unknown-id`
- **THEN** the command throws `AuthenticationError` whose message contains `"Could not find a profile that owns conversation 'unknown-id'"` and the process exits with a non-zero exit code

#### Scenario: Single-profile delete is unchanged
- **WHEN** a user with only the default profile active runs `gemiterm delete abc-123 --force`
- **THEN** the behavior is identical to before the change: the default profile is used, no `findProfileForConversation` call is required, and the conversation is deleted

### Requirement: list --all-profiles renders a Profile column in the text table

The system MUST render a `PROFILE` column in the text table output of `gemiterm list --all-profiles` and MUST NOT render it in any other mode. Each row MUST show the name of the profile that owns the conversation in that row. The column width MUST be 14 characters, matching the visual style of the other columns.

#### Scenario: list --all-profiles shows 5 columns
- **WHEN** a user with active profiles `work` and `personal` runs `gemiterm list --all-profiles`
- **THEN** the text table header contains the columns `ID, TITLE, DATE, PIN, PROFILE` in that order, and each row's last cell contains the owning profile name (e.g. `work` or `personal`)

#### Scenario: list without --all-profiles shows 4 columns
- **WHEN** a user runs `gemiterm list` (no `--all-profiles` flag)
- **THEN** the text table header contains the columns `ID, TITLE, DATE, PIN` only; the `PROFILE` column is absent and the chat output matches the pre-change format byte-for-byte

#### Scenario: list --all-profiles --format json includes profile field
- **WHEN** a user runs `gemiterm list --all-profiles --format json`
- **THEN** the JSON output's `chats` array contains a `profile` field on every chat; each `profile` value is the name of the profile that owns that chat

#### Scenario: list without --all-profiles --format json omits profile field
- **WHEN** a user runs `gemiterm list --format json` (no `--all-profiles` flag)
- **THEN** the JSON output's `chats` array does NOT contain a `profile` field on any chat; the JSON shape is byte-compatible with the pre-change output

### Requirement: ChatInfo carries an optional profile field

The `ChatInfo` type in `src/core/types.ts` MUST carry an optional `profile?: string` field. The field MUST be unset (or `undefined`) for chats returned by `list` without `--all-profiles` and MUST be the owning profile name for chats returned by `list --all-profiles`. Existing serialized JSON output for the non-`--all-profiles` path MUST be byte-compatible with the pre-change shape (the field is omitted, not set to `null` or `""`).

#### Scenario: ChatInfo type allows optional profile field
- **WHEN** a `ChatInfo` object is constructed with `{ id: "abc-123", title: "T", isPinned: false, timestamp: 0, profile: "work" }`
- **THEN** the object is type-valid and the `profile` field is the string `"work"`

#### Scenario: ChatInfo type allows absence of profile field
- **WHEN** a `ChatInfo` object is constructed with `{ id: "abc-123", title: "T", isPinned: false, timestamp: 0 }` (no `profile` key)
- **THEN** the object is type-valid and the `profile` field is `undefined`

#### Scenario: ChatInfo serialized to JSON omits profile when unset
- **WHEN** a `ChatInfo` object with no `profile` field is serialized via `JSON.stringify`
- **THEN** the resulting JSON does NOT contain a `profile` key (matches the pre-change byte layout)

### Requirement: formatChatList accepts an includeProfileColumn flag

The `formatChatList` function in `src/infrastructure/formatters.ts` MUST accept an optional second argument `options?: { includeProfileColumn?: boolean }`. When `options.includeProfileColumn` is `true`, the rendered table MUST have 5 columns including `PROFILE`. When the flag is `false` or omitted, the rendered table MUST have the original 4 columns (`ID, TITLE, DATE, PIN`) and the output MUST be byte-compatible with the pre-change format.

#### Scenario: formatChatList with includeProfileColumn: true renders 5 columns
- **WHEN** `formatChatList(chats, { includeProfileColumn: true })` is called with chats that each have a `profile` field
- **THEN** the rendered output contains the header `ID    TITLE    DATE    PIN    PROFILE` (with the column-padding and divider convention used elsewhere) and each row's last cell shows the chat's `profile` value

#### Scenario: formatChatList without flag renders 4 columns (backward compat)
- **WHEN** `formatChatList(chats)` is called with no second argument
- **THEN** the rendered output contains the header `ID    TITLE    DATE    PIN` and the output is byte-compatible with the pre-change format for the same input (no `PROFILE` column)

#### Scenario: Existing formatChatList callers continue to pass without modification
- **WHEN** an existing test calls `formatChatList(chats)` (the pre-change call shape) after the change lands
- **THEN** the test continues to pass without modification (regression gate for the formatter; the optional second argument is non-breaking)

### Requirement: list --all-profiles skips unauthenticated profiles and surfaces warnings

When `list --all-profiles` (or `list -i`) is executed, the system SHALL query only profiles that have stored authentication cookies on disk (a cookie file exists for the profile and contains both `__Secure-1PSID` and `__Secure-1PSIDTS`). Profiles without stored cookies SHALL be skipped, and a warning SHALL be logged to stderr containing the profile name. The system SHALL NOT consult the freshness check (`checkCookieFreshness`) when deciding whether to include a profile for listing — near-expiry cookies are eligible for listing. The default profile, when its cookies are within the 1-hour freshness grace window, SHALL be silently refreshed in `ProfileAuthManager.ensureAuthenticated` before the API client is built, and SHALL be queried as usual. Profiles other than the default whose cookies are within the grace window SHALL be queried with the cookies as-is; any auth error surfaced by the API is caught by `Promise.allSettled` in the handler and logged as a warning per profile, not propagated as "No conversations found." The system SHALL NOT attempt API calls for profiles without stored cookies. Partial results from profiles with stored cookies SHALL be returned even if some profiles are skipped or fail.

#### Scenario: One of three profiles is unauthenticated
- **WHEN** a user with profiles `work` (stored cookies), `personal` (no stored cookies), and `test` (stored cookies) runs `gemiterm list --all-profiles`
- **THEN** conversations from `work` and `test` are displayed
- **AND** a warning is printed to stderr: `"Skipping unauthenticated profile 'personal'"`
- **AND** no API calls are made for the `personal` profile

#### Scenario: No profiles are authenticated
- **WHEN** a user with no stored-cookie profiles runs `gemiterm list --all-profiles`
- **THEN** no API calls are made
- **AND** a warning is printed for each profile
- **AND** the output shows "No conversations found." (or empty JSON: `{"chats": []}`)

#### Scenario: An authenticated profile's API call fails
- **WHEN** a user with stored-cookie profiles `work` and `personal` runs `gemiterm list --all-profiles` and `personal`'s API call throws
- **THEN** conversations from `work` are displayed
- **AND** a warning is printed to stderr: `"Failed to list chats for profile 'personal': <error message>"`
- **AND** `work`'s results remain unaffected

#### Scenario: A profile's cookies are within the 1-hour freshness grace window
- **WHEN** a user with profile `work` whose `__Secure-1PSIDTS` cookie expires in 30 minutes runs `gemiterm list --all-profiles`
- **THEN** the `work` profile IS queried (not skipped by the listing filter)
- **AND** if the API returns a non-empty chat list, those chats are displayed
- **AND** for the **default** profile specifically, any needed silent refresh happens transparently in `ProfileAuthManager.ensureAuthenticated` before the API client is built — the user does not see an interactive reauth prompt in this case

#### Scenario: Non-default profile's cookies are within the 1-hour freshness grace window and the API rejects them
- **WHEN** a user with default profile `work` (fresh cookies) and additional profile `personal` (cookies inside the 1-hour grace window) runs `gemiterm list --all-profiles` and `personal`'s API call returns an auth error
- **THEN** conversations from `work` are displayed
- **AND** a warning is printed to stderr: `"Failed to list chats for profile 'personal': <error message>"`
- **AND** `work`'s results remain unaffected (the listing is not empty)

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

#### Scenario: profileHasConversation returns true for a non-newest conversation
- **WHEN** `await geminiClient.profileHasConversation("work", "older-target")` is called and profile `work` has multiple chats where `older-target` is not the newest chat
- **THEN** the method returns `true` (the lookup does not exclude older conversations)

#### Scenario: profileHasConversation scans the full chat list for membership
- **WHEN** `geminiClient.profileHasConversation("work", "abc-123")` is called
- **THEN** the underlying `listChats()` call is made without a `limit` that would truncate the result before membership is determined

### Requirement: Regression test update for profile-auth-manager documents the bug fix

The 8 existing unit tests in the `describe("findProfileForConversation")` block of `tests/services/profile-auth-manager.test.ts` MUST be updated to assert the correct per-profile-lookup behavior (not the previous first-active-wins behavior). The test count for that describe block MUST increase (8 → 11+) after the change. A leading comment in the test file MUST explain that the 8 changed tests previously documented the bug and the change is the fix.

#### Scenario: The 8 existing tests are updated to mock profileHasConversation
- **WHEN** `tests/services/profile-auth-manager.test.ts` is read after the change
- **THEN** the existing tests in the `findProfileForConversation` block are rewritten to mock `GeminiClientService.profileHasConversation` and assert the new behavior; the new behavior is the first profile in list order whose `profileHasConversation` returns `true`

#### Scenario: The test count for profile-auth-manager increases
- **WHEN** `bun test tests/services/profile-auth-manager.test.ts` is run after the change
- **THEN** the test count is at least 11 (8 original tests updated plus 3-4 new tests covering: "conversation found in second profile", "conversation not in any profile", "throws when no active profiles")

#### Scenario: The test file's leading comment documents the test changes
- **WHEN** `tests/services/profile-auth-manager.test.ts` is read after the change
- **THEN** the file contains a leading comment block stating: "The 8 tests in `describe('findProfileForConversation')` previously asserted the BUGGY 'first active profile' behavior; they have been updated to assert the CORRECT per-profile-lookup behavior. See `openspec/changes/command-spec-conformance/proposal.md` for context."

