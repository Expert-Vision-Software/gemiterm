## ADDED Requirements

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
