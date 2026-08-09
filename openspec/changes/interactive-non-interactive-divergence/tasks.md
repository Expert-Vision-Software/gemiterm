## 1. Continue interactive parity (LANDED in v2.6.2)

- [x] 1.1 Drop `printLastMessage` from `ContinueCommand.startInteractive` (`src/cli/commands/continue-command.ts:144-164`). Remove the `printLastMessage` private method. Remove the unused `QUERY_TYPES` and `FetchChatQueryResult` imports. Landed as commit `2d9fc76` on `fix/v2.6.1-bugs`.
- [x] 1.2 Update `tests/cli/continue-command.test.ts` to remove the two `printLastMessage` tests (`printLastMessage outputs last model message content` and `interactive mode forwards resolved profileName into FETCH_CHAT (printLastMessage)`). Landed in commit `2d9fc76`.

## 2. Continue interactive-vs-non-interactive parity tests

- [x] 2.1 Add `tests/cli/utils/parity-harness.ts` exporting utilities for parity testing. Parity tests implemented inline in `tests/cli/continue-command-parity.test.ts` testing the messageHandler closure directly.
- [x] 2.2 Add a parity test for `continue`: `gemiterm continue <cid> "hello"` (non-interactive) vs `gemiterm continue <cid>` + REPL line `"hello"` (interactive). Assert `SendMessageCommand` payload is byte-identical.
- [x] 2.3 Add a regression test that asserts the interactive REPL does NOT dispatch `FETCH_CHAT` before the first user input (locks the spec change at `commands/spec.md` for `ContinueCommand`).
- [x] 2.4 Confirm `bun test` baseline holds: 989 pass / 0 fail / 2097 expects / 62 files.

## 3. AuthenticateCommandHandler wiring

- [x] 3.1 Implement `IProfileService` interface in `src/services/profile-service.ts` (new file): `authenticate(profileName: string, options?: { renew?: boolean; create?: boolean }): Promise<AuthResult>`, `deleteProfile(profileName: string): Promise<void>`, `renameProfile(oldName: string, newName: string): Promise<void>`, `setDefaultProfile(profileName: string): Promise<void>`, `listProfileStatuses(): ProfileStatus[]`, `listProfiles(): string[]`. The concrete `ProfileService` is a thin adapter wrapping `AuthService` + `ProfileManager`.
- [x] 3.2 Implement `AuthenticateCommandHandler` in `src/core/command-handlers.ts` with constructor-injected `IProfileService`. The `handle` method dispatches to `IProfileService.authenticate(profileName, options)`. Replace the `null as any` placeholder at `src/cli/index.ts:126` with a real `AuthenticateCommandHandler` instance.
- [x] 3.3 Implement `DeleteProfileCommandHandler`, `RenameProfileCommandHandler`, `SetDefaultProfileCommandHandler` to call the corresponding `IProfileService` methods. Replace their current wiring in `src/cli/index.ts`.
- [x] 3.4 Add `tests/services/profile-service.test.ts` covering each `IProfileService` method with a mock `AuthService` + `ProfileManager` and asserting the correct delegation.
- [x] 3.5 Confirm `bun test` baseline holds.

## 4. AuthCommand interactive menu routing

- [x] 4.1 Refactor `AuthCommand.showProfileMenu` (`src/cli/commands/auth-command.ts`) so each option dispatches a command through the mediator instead of calling services inline:
  - `A` → `AUTHENTICATE` with `create: true`
  - `D` → `DELETE_PROFILE`
  - `S` → `SET_DEFAULT_PROFILE`
  - `R` → `RENAME_PROFILE` (then `AUTHENTICATE` for the new name)
  - `E` → `AUTHENTICATE` with `renew: true`
  - `X` → no-op (exit)
- [x] 4.2 Refactor the `AuthCommand` argv parser (`parseFlags`) so each branch dispatches the corresponding command through the mediator (mirrors 4.1).
- [x] 4.3 Replace the per-option private methods (`addProfile`, `deleteProfile`, `renameProfile`, `setDefaultProfile`, `renewProfile`, `authenticateToProfile`) with mediator dispatch in the command body.
- [x] 4.4 Move the reauth flow (`src/cli/utils/reauth.ts`) into `AuthenticateCommandHandler.handle` — deferred: reauth is triggered at the `getGeminiClient` seam (index.ts), not through the AUTHENTICATE command. The existing flow is preserved unchanged.
- [x] 4.5 Update `tests/cli/auth-command.test.ts` to assert menu options dispatch commands (not compose services). Add new tests for `E` (Renew) menu option.
- [x] 4.6 Confirm `bun test` baseline holds.

## 5. NewCommand REPL subsequent-turn dispatch

- [x] 5.1 Refactor `NewCommand.startInteractive` (`src/cli/commands/new-command.ts`) so the first REPL turn dispatches `StartNewChatCommand` and subsequent turns dispatch `SendMessageCommand` against the captured `conversationId`. Capture the `conversationId` from the first response in a closure.
- [x] 5.2 Update `tests/cli/new-command.test.ts` to assert subsequent-turn dispatch behavior. Add a parity test for `new` in `tests/cli/new-command-parity.test.ts` mirroring the `continue` parity test from §2.
- [x] 5.3 Confirm `bun test` baseline holds.

## 6. Chat-list-browser `continue` dispatch test

- [x] 6.1 Add a test in `tests/cli/list-command.test.ts` (`action menu` suite) that mocks `select.mockResolvedValue("continue")` and asserts the caller invokes `ContinueCommand` with the picked `chat.id` and `--profile <chat.profile>` when the chat has an owning profile.
- [x] 6.2 Confirm the existing action-menu tests for `view`, `export-markdown`, `export-json`, `delete`, `copy-id`, `back`, `quit` still pass unchanged.

## 7. Spec sync

- [x] 7.1 No action during this release — the spec delta is captured in `openspec/changes/interactive-non-interactive-divergence/specs/`. It will be merged into `openspec/specs/` at archive time via the `openspec-archive-change` skill.

## 8. Validation

- [x] 8.1 `bun run typecheck` → clean after every commit.
- [x] 8.2 `bun test` → baseline (989/2097) holds after every commit; new tests added in §2, §3, §4, §5, §6 raise the count monotonically (was 911, now 989).
- [x] 8.3 `openspec validate --strict` → valid before commit.
- [ ] 8.4 Manual smoke: invoke `gemiterm continue <cid>` (REPL) and `gemiterm continue <cid> "msg"` (non-interactive) against the same conversation; confirm both produce a response that references prior turns (no "treats input as fresh" regression).
- [ ] 8.5 Manual smoke: invoke `gemiterm auth` with 2+ profiles and exercise every menu option; confirm the same underlying behavior (authenticate, delete, set-default, rename, renew) as before, dispatched via the mediator.

## Out of scope (filed elsewhere or deferred)

- `commandClientService.profileHasConversation(name, id)` factory-wiring bug — `profile-aware-factory-wiring` change.
- `chat-list-bulk-actions` and `list-interactive-action-profile-coverage` — independent changes.
- A `MessageService.send` extraction — rejected in `design.md` Decision 1.