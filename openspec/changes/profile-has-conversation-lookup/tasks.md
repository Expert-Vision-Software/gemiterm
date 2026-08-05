# Tasks: profile-has-conversation-lookup

## 1. Green the red test

- [ ] 1.1 In `src/services/gemini-client-wrapper.ts`, change `profileHasConversation` to call `listChats()` (no `limit`) instead of `listChats({ limit: 1 })`, preserving the `this.forProfile(profileName)` indirection and `chats.some(...)` membership check.
- [ ] 1.2 Run `bun test tests/services/gemini-client-wrapper.test.ts -t "limit:1 bug"` and confirm it now passes (green).

## 2. Update the bug-encoding test

- [ ] 2.1 In `tests/services/gemini-client-wrapper.test.ts`, replace the `passes limit:1 to listChats for targeted lookup` test with an assertion that `profileHasConversation` calls `listChats` WITHOUT a truncating `limit` (e.g., assert `capturedOptions?.limit` is `undefined`).
- [ ] 2.2 Rename the test to reflect the corrected contract (e.g., `scans the full chat list for membership`).

## 3. Verify

- [ ] 3.1 Run `bun run typecheck` — clean.
- [ ] 3.2 Run `bun test` — full suite green, baseline intact (no regressions beyond the updated test).
- [ ] 3.3 Run `bun test tests/services/profile-auth-manager.test.ts` — confirm the `findProfileForConversation` suite (which mocks `profileHasConversation`) is unaffected.

## 4. Spec sync

- [ ] 4.1 After implementation, run the openspec sync/archive flow to merge the `multi-profile-conversations` delta into the main spec.
