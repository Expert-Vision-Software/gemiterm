## Why

`GeminiClientService.profileHasConversation` uses `listChats({ limit: 1 })` to check whether a conversation belongs to a profile. Because `listChats` sorts the full list DESC by timestamp *before* slicing to `limit`, `limit: 1` returns only the newest chat. Any non-newest conversation is therefore reported as absent, so `ProfileAuthManager.findProfileForConversation` fails to resolve the owning profile and `fetch`/`export`/`continue`/`delete` throw "Could not find a profile that owns conversation" whenever the target is not the profile's most recent chat. This is a production regression affecting every multi-chat profile.

## What Changes

- Replace the `limit: 1` targeted lookup in `GeminiClientService.profileHasConversation` (`src/services/gemini-client-wrapper.ts`) with a membership check that is correct for **any** conversation in the profile's chat list, not only the newest.
- Update the existing unit test `passes limit:1 to listChats for targeted lookup` (`tests/services/gemini-client-wrapper.test.ts`), which currently asserts the buggy `limit === 1` contract; it will assert the corrected lookup contract instead.
- Add a regression test proving a non-newest conversation in a multi-chat profile resolves to `true` (currently red).
- Amend the `multi-profile-conversations` spec scenario that mandates the `limit`-based lookup.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `multi-profile-conversations`: The `profileHasConversation` lookup MUST correctly report membership for any conversation in the profile's chat list, regardless of recency. The current "uses a targeted lookup" scenario (which mandates a `limit`-based `listChats` call) is replaced with a correctness requirement.

## Impact

- **Code**: `src/services/gemini-client-wrapper.ts` (`profileHasConversation` at `:221-225`; interacts with `listChats` sort+slice at `:245-252`).
- **Callers**: `ProfileAuthManager.findProfileForConversation` (`src/services/profile-auth-manager.ts:110-124`) is the sole caller; its contract is unchanged (still returns the first owning profile or `null`).
- **Tests**: `tests/services/gemini-client-wrapper.test.ts` (the `profileHasConversation` describe block); the broader `tests/services/profile-auth-manager.test.ts` `findProfileForConversation` suite already mocks `profileHasConversation` and is unaffected.
- **Performance**: depending on the chosen implementation (see design.md), the per-profile lookup may fetch the full chat list instead of 1 row. This is evaluated in design.md against the active-profile fan-out in `findProfileForConversation`.
- **No interface change**: `profileHasConversation(profileName, conversationId): Promise<boolean>` signature is unchanged.
