## 1. Handler refactor

- [ ] 1.1 Change `ListChatsQueryHandler` constructor (`src/core/query-handlers.ts:85-89`) to accept `clientService: IGeminiClientQueryService` instead of `getGeminiClient: () => Promise<IGeminiClientService>`. Store it on a new private field.
- [ ] 1.2 Update `ListChatsQueryHandler.handle()` (`src/core/query-handlers.ts:91-133`) to route all three branches through `clientService`:
  - `profile` set → `await this.clientService.forProfile(profile).listChats(options)` (one call).
  - `allProfiles` set → iterate `profileManager.list()` filtered by `hasStoredCookies`; for each active profile, `await this.clientService.forProfile(name).listChats(options)` via `Promise.allSettled`. Preserve the existing `Promise.allSettled` aggregation and per-profile warning log on failure (`Failed to list chats for profile '<name>': <err>`).
  - Neither set → `await this.clientService.listChats(options)`.
- [ ] 1.3 Remove the unused `getGeminiClient` private field from the handler.

## 2. Factory wiring

- [ ] 2.1 Update `src/cli/index.ts:119` to pass `clientService` instead of the raw `getGeminiClient` factory: `new ListChatsQueryHandler(clientService, profileManager, logger)`. Use the `clientService` returned by the existing `createClientServices(getGeminiClient)` call at `src/cli/index.ts:121`. (Reordering may be required so the `ListChatsQueryHandler` registration sees the same `clientService` instance.)
- [ ] 2.2 Confirm no other call sites reference the removed handler constructor signature (`grep` for `new ListChatsQueryHandler`).

## 3. Tests

- [ ] 3.1 Update `tests/core/query-handlers.test.ts` mocks: every `ListChatsQueryHandler` test that currently passes `getGeminiClient` must now pass a `clientService` stub with `listChats`, `forProfile`, `listModels`, `fetchChat` methods matching `IGeminiClientQueryService` (`src/core/query-handlers.ts:60-65`).
- [ ] 3.2 Add `tests/core/query-handlers.test.ts` regression: a test that wires a `clientService` with a spy `forProfile` and asserts it is invoked with `"work"` (not `undefined`/`"default"`) when the `ListChatsQueryPayload.profile` is `"work"`. Mirror the assertion shape used for `FetchChatQueryHandler` in the same file.
- [ ] 3.3 Add `tests/core/query-handlers.test.ts` regression: a test asserting that when `allProfiles: true` and two profiles `work` and `personal` are active, `forProfile` is called once per profile with the correct name; and that per-profile failures are isolated via `Promise.allSettled`.
- [ ] 3.4 Add `tests/integration/commands/list.test.ts` regression: wire the real `ListChatsQueryHandler` against a spy `clientService`; run `gemiterm list -p work` through the command pipeline; assert `clientService.forProfile` is called with `"work"`. (Today this test mocks `mediator.send` and bypasses the handler — augment, don't replace.)
- [ ] 3.5 Confirm `tests/cli/client-services.test.ts` still passes unchanged. Drop any redundant arguments if a stale two-arg fixture from `commit 5f2442c` is still present (subagent finding: pre-`profile-resolution-client-init` shape lingered in the test).

## 4. Validation

- [ ] 4.1 `bun run typecheck` → clean (no diagnostics).
- [ ] 4.2 `bun test` → **913 pass / 0 fail / 1909 expects / 56 files** baseline intact (or higher if the new regression tests added expects; record the new baseline in `openspec/changes/profile-aware-factory-wiring/proposal.md`'s commit message).
- [ ] 4.3 Manual: against a chat-bearing `GEMITERM_CONFIG_DIR` (machine `%APPDATA%\gemiterm`), run `bun run dev list -p <name>` for each active profile; confirm the rotation/auth log lines name the requested profile, not the default. Run `bun run dev list -i -p <name>` to confirm the TUI path is also routed correctly (same handler).
- [ ] 4.4 Manual: confirm `bun run dev list` (no `--profile`, no `--all-profiles`) is byte-equivalent to the pre-change baseline output (4-column text table).

## 5. Spec sync

- [ ] 5.1 No action — the spec delta is already captured at `openspec/changes/profile-aware-factory-wiring/specs/commands/spec.md`. It will be merged into `openspec/specs/commands/spec.md` at archive time via the `openspec-archive-change` skill.