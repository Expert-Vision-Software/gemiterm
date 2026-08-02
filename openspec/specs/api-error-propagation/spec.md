## Purpose

Structured error handling for Gemini API calls — null-gating, meaningful error messages, and partial-result collection with profile-scoped warnings.

## Requirements

### Requirement: ListChatsQueryHandler handles partial failure across profiles

When querying all profiles (`--all-profiles` or `--interactive`), the `ListChatsQueryHandler` SHALL use `Promise.allSettled` to collect results from each profile query. Fulfilled results SHALL be collected into the returned chat list. Rejected results SHALL be logged as warnings with the profile name and error message, and SHALL NOT block the overall query from returning partial results.

#### Scenario: All profiles succeed
- **WHEN** `ListChatsQueryHandler.handle()` is called with `allProfiles: true` and all profile queries resolve successfully
- **THEN** the result contains chats from all profiles, sorted by timestamp descending

#### Scenario: One profile fails, others succeed
- **WHEN** `ListChatsQueryHandler.handle()` is called with `allProfiles: true` and profile `work` succeeds but profile `personal` rejects with an error
- **THEN** the result contains chats from profile `work` only
- **AND** a warning is logged containing the profile name `"personal"` and the error message

#### Scenario: All profiles fail
- **WHEN** `ListChatsQueryHandler.handle()` is called with `allProfiles: true` and all profile queries reject
- **THEN** the result contains an empty chat list
- **AND** a warning is logged for each failed profile

### Requirement: ListChatsQueryHandler skips unauthenticated profiles

When querying all profiles, the `ListChatsQueryHandler` SHALL filter the profile list to only include profiles with valid cookies before issuing API calls. Profiles without valid cookies SHALL be skipped and a warning SHALL be logged with the profile name. The handler SHALL use `ProfileManager.hasValidCookies()` to gate each profile.

#### Scenario: One of three profiles is unauthenticated
- **WHEN** `handle()` is called with `allProfiles: true`, profiles are `["work", "personal", "test"]`, and only `work` and `test` have valid cookies
- **THEN** only `work` and `test` are queried
- **AND** a warning is logged: `"Skipping unauthenticated profile 'personal'"`

#### Scenario: No profiles are authenticated
- **WHEN** `handle()` is called with `allProfiles: true` and no profiles have valid cookies
- **THEN** no API calls are made
- **AND** a warning is logged for each profile
- **AND** the result contains an empty chat list

#### Scenario: Single profile query bypasses authentication check
- **WHEN** `handle()` is called with a specific `profile: "work"` (not `allProfiles: true`)
- **THEN** the authentication check is skipped; the handler queries the named profile directly
- **AND** any error from that profile propagates to the caller

### Requirement: GeminiClientService.listChats throws on null SDK response

The `listChats()` method in `GeminiClientService` SHALL check whether the Gemini SDK's `chats()` call returns `null` or `undefined`. If the return value is nullish, the method SHALL throw a `GemitermError` whose message contains `"Gemini returned no data"` and `"session may be expired"`. The method SHALL NOT silently coalesce a null return value into an empty array.

#### Scenario: SDK returns null
- **WHEN** `listChats()` calls `this.client!.chats()` and the SDK returns `null`
- **THEN** the method throws a `GemitermError` with a message containing `"Gemini returned no data"`

#### Scenario: SDK returns empty array
- **WHEN** `listChats()` calls `this.client!.chats()` and the SDK returns `[]` (empty array)
- **THEN** the method returns `[]` without throwing

#### Scenario: SDK returns valid chat rows
- **WHEN** `listChats()` calls `this.client!.chats()` and the SDK returns valid `RawChatRow[]` data
- **THEN** the method returns the mapped `ChatInfo[]` with no error
