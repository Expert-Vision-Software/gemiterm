## 1. Factory characterization tests

- [ ] 1.1 Read `src/cli/index.ts` lines 38-202 to understand the factory wiring
- [ ] 1.2 Create `tests/cli/get-gemini-client.test.ts` with profile-forwarding tests
- [ ] 1.3 Test: `ListChatsQueryHandler` with `profile` field calls `forProfile(name)` on the client
- [ ] 1.4 Test: `DeleteConversationCommandHandler` with `profileName` calls `forProfile(name)`
- [ ] 1.5 Test: `SendMessageCommandHandler` with `profileName` calls `forProfile(name)`
- [ ] 1.6 Test: `StartNewChatCommandHandler` with `profileName` calls `forProfile(name)`
- [ ] 1.7 Test: handler without profile field calls `listChats` on the base client (no `forProfile`)
- [ ] 1.8 Test: `AuthenticationError` from client factory propagates

## 2. OpenSpec delta

- [ ] 2.1 Add factory contract requirement to `specs/cli/spec.md`
- [ ] 2.2 Run `bun run typecheck` and confirm clean
- [ ] 2.3 Run `bun test tests/cli/get-gemini-client.test.ts` and confirm tests run
- [ ] 2.4 Commit

## 3. Verification

- [ ] 3.1 `bun run typecheck` — clean
- [ ] 3.2 `bun test tests/cli/get-gemini-client.test.ts` — all tests run
- [ ] 3.3 `bun test` full suite — existing tests unaffected
