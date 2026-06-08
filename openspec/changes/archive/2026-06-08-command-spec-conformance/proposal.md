## Why

Three small but real spec-conformance gaps remain in the CLI commands after the Maestro migration:

1. **`continue-command.ts` and `delete-command.ts` do not call `ProfileAuthManager.findProfileForConversation`.** Per Maestro Phase 4 (`Phase-04-Commands.md:31, 47`), both commands should look up the profile that owns the conversation before sending the mediator command, so that a user with multiple profiles (e.g. work + personal) sends the message to / deletes from the right profile. Currently both commands go to the default profile regardless of where the conversation lives.
2. **`ProfileAuthManager.findProfileForConversation` ignores its `conversationId` argument** (`src/services/profile-auth-manager.ts:46-60`). The method body iterates over all profiles and returns the first active one, never inspecting the cookies or storage of each profile for ownership of the requested conversation. In a single-profile setup this is a no-op; in a multi-profile setup it returns a wrong profile. The method is wired up to the registry but is functionally broken, which means even if commands 1 were implemented they would still be wrong without this fix.
3. **`list-command.ts` does not render a `Profile` column when `--all-profiles` is set.** Per Maestro Phase 4 (`Phase-04-Commands.md:11`), the table should include a `Profile` column in that mode. The mediator payload already carries `allProfiles: boolean` (`list-command.ts:62`) and the integration tests assert the JSON contains profile info, but the text output uses `formatChatList(chats)` (`formatters.ts:115-145`) which renders only `ID / TITLE / DATE / PIN`. Users with multiple profiles cannot tell which profile a chat belongs to in the text output.

## What Changes

- **Fix `ProfileAuthManager.findProfileForConversation(conversationId)` in `src/services/profile-auth-manager.ts:46-60`** so that the `conversationId` argument is actually used. The implementation should iterate over all profiles; for each, call `geminiClient.listChats({ profile: name })` (or a new lightweight `profileHasConversation(name, conversationId)` helper on the Gemini client) to check whether the conversation appears in that profile's chat list; return the first matching profile name, or `null` if no profile owns it. **The 8 existing unit tests in `tests/services/profile-auth-manager.test.ts:88-223` are the regression gate** — they must be updated to assert the new per-profile-lookup behavior, not the broken first-active behavior. **Do NOT change the public method signature** — it must remain `findProfileForConversation(conversationId: string): string | null`.
- **Add `profileHasConversation(profileName, conversationId): Promise<boolean>` (or a non-async equivalent that reuses the same chat-listing path)** to `GeminiClientService` in `src/services/gemini-client-wrapper.ts` so `ProfileAuthManager` has a fast per-profile lookup. This is a small wrapper around the existing `listChats()` call scoped to a single profile. The existing `tests/integration/commands/list.test.ts` and the `IGeminiClientService` interface in `src/core/command-handlers.ts` already define the per-profile listing path.
- **Update `src/cli/commands/continue-command.ts:50-69` and `:75-130`** to call `profileAuthManager.findProfileForConversation(conversationId)` before sending the `SendMessageCommand`. If the method returns `null`, throw `AuthenticationError` with a clear message ("Could not find a profile that owns conversation '<id>'. Run 'gemiterm list --all-profiles' to see which profile it belongs to, then 'gemiterm continue <id> <msg> --profile <name>' to specify the profile explicitly."). If it returns a profile name, send the command to that profile's mediator wiring (this may require extending the `IGeminiClientService` injection so commands can target a specific profile, or routing through a profile-scoped client constructor). Document the chosen approach in `design.md`.
- **Update `src/cli/commands/delete-command.ts:51-77`** analogously — call `findProfileForConversation` before sending `DeleteConversationCommand`. Same error-handling pattern.
- **Add `profile?: string` to `ChatInfo` in `src/core/types.ts:9-14`** (optional, backward-compatible).
- **Update `formatChatList` in `src/infrastructure/formatters.ts:115-145`** to accept an optional `includeProfileColumn: boolean` parameter. When true, render a 5th `PROFILE` column (width 14 chars); when false, keep the current 4-column layout.
- **Update `src/cli/commands/list-command.ts:129-136`** to pass `includeProfileColumn: options.allProfiles` to `formatChatList`.
- **Add a new optional `profile` field to the `ListChatsQueryResult.chats` payload** by propagating the active profile name in `GeminiClientService.listChats(options)` when `options.allProfiles` is true.
- **Tests:**
  - Update `tests/services/profile-auth-manager.test.ts` so the 8 existing cases test the new per-profile-lookup behavior (mocking `profileHasConversation`).
  - Add 3-4 new unit tests in `tests/services/profile-auth-manager.test.ts` covering: "conversation found in second profile", "conversation not in any profile", "throws when no active profiles".
  - Add 2 new integration tests in `tests/integration/commands/continue.test.ts` and `tests/integration/commands/delete.test.ts` covering the profile-lookup code path.
  - Add 2 new integration tests in `tests/integration/commands/list.test.ts` covering the new Profile column when `--all-profiles` is set.

**No breaking changes** to the CLI user surface. The `profile` field in `ChatInfo` is optional; existing JSON output is unchanged. The Profile column only appears when the user explicitly passes `--all-profiles`.

## Capabilities

### New Capabilities
- `multi-profile-conversations`: The ability for the `continue` and `delete` commands to locate the profile that owns a given conversation, and for `list --all-profiles` to display which profile each conversation belongs to. Creates `openspec/changes/command-spec-conformance/specs/multi-profile-conversations/spec.md`.

### Modified Capabilities
- (none) — there is no existing main `commands` spec yet, so this is a new capability rather than a modification.

## Impact

- **Code (8 files):**
  - `src/services/profile-auth-manager.ts` — fix `findProfileForConversation`
  - `src/services/gemini-client-wrapper.ts` — add `profileHasConversation` helper
  - `src/cli/commands/continue-command.ts` — call `findProfileForConversation`
  - `src/cli/commands/delete-command.ts` — call `findProfileForConversation`
  - `src/cli/commands/list-command.ts` — pass `includeProfileColumn` flag
  - `src/core/types.ts` — add optional `profile` to `ChatInfo`
  - `src/infrastructure/formatters.ts` — add `includeProfileColumn` to `formatChatList`
  - `src/core/command-handlers.ts` (or the `IGeminiClientService` interface) — ensure per-profile routing is exposed
- **Tests (3 files):**
  - `tests/services/profile-auth-manager.test.ts` — update 8 existing + add 3-4 new
  - `tests/integration/commands/continue.test.ts` — add 2
  - `tests/integration/commands/delete.test.ts` — add 2
  - `tests/integration/commands/list.test.ts` — add 2
- **Baseline gate:** 432/432 tests must continue to pass; the new tests bring the count higher.
- **SENSITIVE AREA:** the auth/playwright-cli/cookie-monitor code paths are NOT touched. This change is purely about the `continue`, `delete`, and `list` commands and the `ProfileAuthManager` + `GeminiClientService` services. No cookie capture or browser lifecycle code is modified.
