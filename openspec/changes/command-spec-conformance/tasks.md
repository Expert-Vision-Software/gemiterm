## 1. Fix `findProfileForConversation` core logic in `ProfileAuthManager`

- [x] 1.1 Read `src/services/profile-auth-manager.ts:46-60` to confirm the current implementation iterates `profileManager.list()` and returns the first profile with `getStatus(name).isActive === true`, never using the `conversationId` argument.
- [x] 1.2 Read `src/services/profile-auth-manager.ts:10-39` to confirm the constructor signature and the `getActiveProfiles` pattern; the new method should follow the same shape (use `profileManager.list()`, then filter for the owning profile).
- [x] 1.3 Refactor `findProfileForConversation(conversationId)` so it calls a `profileHasConversation` helper on the injected service for each active profile and returns the first profile whose helper returns `true`. If no profile returns `true`, the method MUST return `null`. The method signature MUST remain `findProfileForConversation(conversationId: string): string | null` (the public contract is unchanged).
- [x] 1.4 Do NOT touch any of the SENSITIVE files (`src/services/playwright-cli-driver.ts`, `src/services/cookie-monitor.ts`, `src/services/auth-service.ts`); the change is scoped to `profile-auth-manager.ts` and its dependencies.
- [x] 1.5 Do NOT change the public method signature; the only acceptable change is the method body.

## 2. Add `profileHasConversation` helper to `GeminiClientService`

- [x] 2.1 Read `src/services/gemini-client-wrapper.ts:91-141` to confirm the existing `listChats(options)` method; the new helper is a thin wrapper that scopes a `listChats` call to a single profile's cookies and returns a boolean.
- [x] 2.2 Add `async profileHasConversation(profileName: string, conversationId: string): Promise<boolean>` to `GeminiClientService` in `src/services/gemini-client-wrapper.ts`. The method MUST construct a per-profile client (via the `forProfile` factory in task 2.3), call `listChats()` on it, and return `true` if the conversation ID is in the result.
- [x] 2.3 Add a `forProfile(profileName: string): GeminiClientService` factory method on `GeminiClientService` that returns a NEW instance configured with the named profile's cookies (via `CookieStorageService.loadCookiesForProfile`). The method MUST NOT mutate the calling instance's `config` or `authenticated` fields.
- [x] 2.4 Expose `profileHasConversation` on the `IGeminiClientService` interface in `src/core/command-handlers.ts:90-94` so handlers and tests can use it without downcasting. The interface method signature is `profileHasConversation(profileName: string, conversationId: string): Promise<boolean>`.
- [x] 2.5 The helper MUST NOT make any changes to the on-disk cookie storage; it only reads via the injected `CookieStorageService`.

## 3. Update `profile-auth-manager.test.ts` to encode the new behavior

- [x] 3.1 Add a leading comment block at the top of `tests/services/profile-auth-manager.test.ts` (above the first `describe`) stating: "The 8 tests in `describe('findProfileForConversation')` previously asserted the BUGGY 'first active profile' behavior; they have been updated to assert the CORRECT per-profile-lookup behavior. See `openspec/changes/command-spec-conformance/proposal.md` for context." This is required so reviewers do not flag the test changes as a regression.
- [x] 3.2 Rewrite the existing "returns first active profile" test (currently at `tests/services/profile-auth-manager.test.ts:188-200`) to: create two profiles, mock `GeminiClientService.profileHasConversation` to return `true` for `work` and `false` for `personal`, and assert the method returns `"work"`. The test name MUST be changed to "returns the profile that owns the conversation" (or similar) to reflect the new behavior.
- [x] 3.3 Keep the "returns null when no active profiles" test (currently at `tests/services/profile-auth-manager.test.ts:202-212`) but update it to mock `profileHasConversation` to return `false` for the only active profile; the assertion (`toBeNull()`) is unchanged.
- [x] 3.4 Keep the "returns null when no profiles exist" test (currently at `tests/services/profile-auth-manager.test.ts:214-222`) unchanged: the `profileManager.list()` returns an empty array, so the loop never runs and the method returns `null`.
- [x] 3.5 Add a new test "returns null when conversation is not in any profile" that creates two profiles with valid cookies, mocks `profileHasConversation` to return `false` for both, and asserts `findProfileForConversation` returns `null`.
- [x] 3.6 Add a new test "returns first profile in list order when multiple profiles report ownership" that creates three profiles, mocks `profileHasConversation` to return `true` for profiles 1 and 3 (and `false` for profile 2), and asserts the method returns profile 1 (the first in `list()` order). This guards the iteration-order contract.
- [x] 3.7 Add a new test "passes the conversationId argument to the lookup helper" that mocks `profileHasConversation` with a spy and asserts the spy was called with the exact `conversationId` string the test passed in. This is the regression gate that catches the "first-active-wins" bug recurring.
- [x] 3.8 The test count for `profile-auth-manager.test.ts` MUST be 11 or higher after the change (the original 8, minus 0 since we keep all but rename one, plus 3 new tests = 11; the new tests can be expanded to 4 if helpful for coverage).

## 4. Add `profile?: string` to `ChatInfo`

- [x] 4.1 Read `src/core/types.ts:9-14` to confirm the current `ChatInfo` shape: `{ id, title, isPinned, timestamp }`.
- [x] 4.2 Add an optional `profile?: string` field to the `ChatInfo` interface. The field MUST be optional (declared with `?`) to preserve backward compatibility for single-profile consumers and for JSON serialization that does not include the field.
- [x] 4.3 Do NOT change any other field in the interface. The type is purely additive.
- [x] 4.4 Verify the change compiles via `bun run build` (or the project's TypeScript check command); the optional field MUST NOT break any existing `ChatInfo` construction sites.

## 5. Add `includeProfileColumn` flag to `formatChatList`

- [x] 5.1 Read `src/infrastructure/formatters.ts:115-145` to confirm the current `formatChatList(chats)` signature and 4-column layout (ID, TITLE, DATE, PIN).
- [x] 5.2 Update the signature to `formatChatList(chats: ChatInfo[], options?: { includeProfileColumn?: boolean }): string`. The second argument is an optional options object.
- [x] 5.3 When `options?.includeProfileColumn === true`, render a 5th `PROFILE` column with width 14 characters. The column header MUST be `PROFILE` and the column value MUST be `chat.profile ?? ""` (defensive: in case the chat is missing the field for any reason). The 5-column layout MUST match the visual style of the existing columns (header + dashed underline + per-row data).
- [x] 5.4 When `options?.includeProfileColumn` is `false` or `undefined`, the output MUST be byte-compatible with the pre-change format. The 4-column layout is unchanged.
- [x] 5.5 Verify all existing callers of `formatChatList` continue to compile: the new optional second argument is non-breaking.

## 6. Wire `list-command.ts` to pass `includeProfileColumn` to `formatChatList`

- [x] 6.1 Read `src/cli/commands/list-command.ts:129-136` to confirm the current `outputText` method calls `formatChatList(chats)` without a second argument.
- [x] 6.2 Update the call to `formatChatList(chats, { includeProfileColumn: options.allProfiles })`. The flag is plumbed from the `ListCommandOptions.allProfiles` field that already exists at `list-command.ts:21`.
- [x] 6.3 Read `src/cli/commands/list-command.ts:58-63` to confirm the `ListChatsQueryPayload` already carries `allProfiles: options.allProfiles`; this is the upstream signal that the mediator will populate `ChatInfo.profile` on the result.
- [x] 6.4 Update the help text in `list-command.ts:215` to mention that the Profile column appears in `--all-profiles` mode. The existing `--all-profiles` description is "Show conversations from all profiles"; expand it to "Show conversations from all profiles (with Profile column in text output)" or similar.

## 7. Update `continue-command.ts` to call `findProfileForConversation` and route per-profile

- [x] 7.1 Read `src/cli/commands/continue-command.ts:50-69` and `:75-130` to confirm the current `sendNonInteractive` and `startInteractive` methods both send the `SendMessageCommand` to the default profile only.
- [x] 7.2 Add a call to `findProfileForConversation(conversationId)` in `sendNonInteractive` before the mediator send. The lookup MUST use the `ProfileAuthManager` (added to the `CliCommandContext` — see task 9.2).
- [x] 7.3 If the lookup returns `null`, throw `AuthenticationError` with the message: `"Could not find a profile that owns conversation '<id>'. Run 'gemiterm list --all-profiles' to see which profile it belongs to, then 'gemiterm continue <id> <msg> --profile <name>' to specify the profile explicitly."` (the `--profile` override is a follow-up; mentioned in the message as guidance, not as a current flag).
- [x] 7.4 If the lookup returns a profile name, build a per-profile `GeminiClientService` via `forProfile(name)` and route the `SendMessageCommand` through that instance. The default profile is still used as a fallback when only one profile is active.
- [x] 7.5 Apply the same pattern to `startInteractive` at `continue-command.ts:75-130` so that the interactive loop sends to the correct profile.
- [x] 7.6 The error must propagate to the existing `try/catch` at `continue-command.ts:112-116`; the user sees the error in red and the process exits non-zero.

## 8. Update `delete-command.ts` to call `findProfileForConversation` and route per-profile

- [x] 8.1 Read `src/cli/commands/delete-command.ts:51-77` to confirm the current flow sends the `DeleteConversationCommand` to the default profile only.
- [x] 8.2 Add a call to `findProfileForConversation(conversationId)` after the `validateConversationId` check at `delete-command.ts:44-49` and before the mediator send at `delete-command.ts:64-69`.
- [x] 8.3 If the lookup returns `null`, throw `AuthenticationError` with the same remediation message as `continue` (task 7.3), adapted for delete: `"… then 'gemiterm delete <id> --profile <name>' to specify the profile explicitly."`.
- [x] 8.4 If the lookup returns a profile name, route the `DeleteConversationCommand` through that profile's `GeminiClientService` (via `forProfile`).
- [x] 8.5 The error must propagate to the existing `try/catch` at `delete-command.ts:77-81`; the process exits non-zero with the error message.

## 9. Add per-profile routing via `IGeminiClientService` extension

- [x] 9.1 Add `profileName?: string` to `SendMessageCommandPayload` and `DeleteConversationCommandPayload` in `src/core/command-handlers.ts:44-55`. The field is optional: when absent, the handler uses its injected (default-profile) client; when present, the handler builds a per-profile client via `forProfile` and uses that.
- [x] 9.2 Add the `ProfileAuthManager` to `CliCommandContext` in `src/cli/command-registry.ts:14-17`. The `CliCommandContext` interface gains a new `profileAuthManager: ProfileAuthManager` field. Update the wiring at `src/cli/index.ts` (or wherever the context is constructed) to inject the `ProfileAuthManager` instance.
- [x] 9.3 Update `SendMessageCommandHandler.handle` at `src/core/command-handlers.ts:198-213` so it reads `payload.profileName`; if set, it builds the per-profile client via `geminiClient.forProfile(profileName)` and calls `sendMessage` on the per-profile client. The injected `geminiClient` is treated as the default-profile client.
- [x] 9.4 Update `DeleteConversationCommandHandler.handle` at `src/core/command-handlers.ts:178-196` with the same pattern: read `payload.profileName`, build the per-profile client, route `deleteChat` through it.
- [x] 9.5 The per-profile client is created per `handle` call; the injection of `GeminiClientService` at the handler level continues to use the default-profile instance. The factory pattern (D3 in `design.md`) means no per-profile state is held in the handler.

## 10. Add integration tests for continue/delete profile lookup

- [x] 10.1 Read `tests/integration/commands/continue.test.ts` if it exists; if it does not, create it following the pattern in `tests/integration/commands/list.test.ts` (mock the mediator, assert command behavior). The new test file MUST follow the existing test conventions (Bun's `describe`/`test`/`expect`).
- [x] 10.2 Add a new test in the continue integration suite: "resolves the profile that owns the conversation" — mock the `ProfileAuthManager.findProfileForConversation` to return `"work"`, mock the mediator to capture the `SendMessageCommandPayload`, and assert the payload's `profileName` is `"work"`.
- [x] 10.3 Add a new test in the continue integration suite: "throws AuthenticationError when no profile owns the conversation" — mock `findProfileForConversation` to return `null`, run the command, and assert the error message contains the remediation text and the process exits non-zero.
- [x] 10.4 Add a new test in the delete integration suite: "resolves the profile that owns the conversation" — analog of 10.2 for delete.
- [x] 10.5 Add a new test in the delete integration suite: "throws AuthenticationError when no profile owns the conversation" — analog of 10.3 for delete.

## 11. Add integration test for list Profile column

- [x] 11.1 Add a new test in `tests/integration/commands/list.test.ts`: "renders Profile column when --all-profiles is set" — mock the mediator to return chats with a `profile` field, run `command.execute(["--all-profiles"], context)`, and assert the output contains the `PROFILE` header and the profile names from the mocks.
- [x] 11.2 Add a new test in `tests/integration/commands/list.test.ts`: "omits Profile column when --all-profiles is not set" — mock the mediator to return chats (with or without a `profile` field), run `command.execute([], context)`, and assert the output does NOT contain the `PROFILE` header.
- [x] 11.3 Add a new test in `tests/integration/commands/list.test.ts`: "JSON output includes profile field only when --all-profiles is set" — run the command with and without `--all-profiles --format json`, parse the JSON output, and assert the `profile` key is present in the `--all-profiles` case and absent in the other.

## 12. Final verification

- [x] 12.1 Run `bun test` from the repo root and confirm all tests pass. The baseline is 432/432; the new tests (4-5 in profile-auth-manager + 2 in continue integration + 2 in delete integration + 3 in list integration) bring the count to 442+ (exact count depends on how the new tests are split).
- [x] 12.2 Run `bun test tests/services/profile-auth-manager.test.ts` and confirm the test count is at least 11 (8 original + 3-4 new) and the leading comment is in place.
- [x] 12.3 Run `bun run build` (or the project's TypeScript check command) to confirm the `ChatInfo.profile` field and the `formatChatList` options object do not break any consumer.
- [x] 12.4 Manually run `gemiterm list` (single-profile mode) and confirm the output is byte-compatible with the pre-change format. Manually run `gemiterm list --all-profiles` (multi-profile mode) and confirm the Profile column appears. Manually run `gemiterm continue <id> <msg>` against a known conversation and confirm it routes to the right profile.
- [x] 12.5 Confirm no file under `src/services/playwright-cli-driver.ts`, `src/services/cookie-monitor.ts`, or `src/services/auth-service.ts` was modified. The git diff for those files MUST be empty.
