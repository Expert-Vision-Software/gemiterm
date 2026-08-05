## Why

Several interactive CLI flows have diverged from their non-interactive counterparts, producing user-visible symptoms that don't reproduce on the canonical command path. The most recent example: the interactive `continue` REPL opened by the chat-list browser's "Continue conversation" action pre-fetched via `FETCH_CHAT` to print the last model message, and that pre-fetch failed to persist `rid/rcid/ctx` chat metadata when the SDK response omitted `lastModelTurn.rid`, leaving the subsequent `SEND_MESSAGE` to fall back to `cid`-only and the upstream server to treat the input as a fresh prompt. The non-interactive `gemiterm continue <cid> <msg>` path doesn't pre-fetch and is unaffected. The same shape of divergence exists in `AuthCommand` (which bypasses the mediator entirely and composes `AuthService` / `CookieMonitor` / `ProfileManager` directly because there is no non-interactive `auth` command to compare against). This change proposes the architectural refactor that makes interactive = non-interactive structurally true, not just empirically true.

## What Changes

- **Drop `printLastMessage` from `ContinueCommand.startInteractive`** ✅ landed in this release as the surgical fix for the reported bug. The REPL's first user message now flows through the same `SEND_MESSAGE` dispatch as the non-interactive path. No remaining interactive-only private logic in `ContinueCommand`.
- **Eliminate every interactive-only private code path** in the chat REPL and chat-list browser so the canonical handler is the only implementation. The chat-list browser already does this for `view`/`export`/`delete`/`copy-id`/`continue` (it dispatches via `CommandRegistry.getHandler(name).execute(...)`); the `ContinueCommand` private pre-fetch was the lone outlier.
- **Wire `AuthenticateCommandHandler` with a real `IProfileService`** so `AuthCommand` can route through the mediator instead of composing services directly. Today `cli/index.ts:126` registers the handler with `null as any` — placeholder, never dispatched. Replace with a real `ProfileService` adapter that wraps `AuthService` + `ProfileManager` and is consumable from the mediator.
- **Route `AuthCommand`'s `showProfileMenu` interactive flow** through `AUTHENTICATE`, `DELETE_PROFILE`, `RENAME_PROFILE`, `SET_DEFAULT_PROFILE`, `RENEW_PROFILE` commands instead of composing `authService.authenticate/renew`, `profileManager.delete/rename/setDefault` inline. The interactive menu becomes a thin TTY wrapper around mediator dispatch, mirroring the chat REPL pattern.
- **Lock interactive = non-interactive parity in tests** with a single parity harness: for each command that has both modes, run both modes against the same mediator + handler + spy `clientService` and assert the dispatched payloads are byte-identical.
- **Update the `chat-list-browser` spec** to enumerate the `continue` action (currently missing — `openspec/specs/chat-list-browser/spec.md:240-253` lists seven options, the code has eight).
- No public CLI surface change. No new dependencies. No data or config migration.

## Capabilities

### New Capabilities

- `interactive-non-interactive-parity`: the cross-cutting property that every interactive flow dispatches through the mediator and produces the same handler payloads as its non-interactive counterpart. One `specs/<name>/spec.md`.

### Modified Capabilities

- `commands`: `ContinueCommand` requirement gains an explicit assertion that interactive mode's first `SEND_MESSAGE` dispatch carries the same payload shape as the non-interactive path. The `chat-list-browser` action menu enumeration gains the `continue` action (was missing). The `AuthCommand` requirement gains a statement that the interactive menu routes through the mediator.
- `interactive-prompt-loop`: gains an assertion that the REPL's `messageHandler` is constructed from a single canonical source (the same `SendMessageCommandHandler.handle` that the non-interactive path uses), so the two paths cannot diverge.
- `auth`: gains a requirement that `AuthCommand`'s profile-management menu dispatches `AUTHENTICATE` / `DELETE_PROFILE` / `RENAME_PROFILE` / `SET_DEFAULT_PROFILE` / `RENEW_PROFILE` commands through the mediator instead of composing `AuthService` and `ProfileManager` directly.
- `chat-list-browser`: gains an `ADDED Requirements` block for the `continue` action.

## Impact

- **Source files touched** (incremental commits):
  1. `src/cli/commands/continue-command.ts` — drop `printLastMessage`. ✅ landed.
  2. `src/core/command-handlers.ts` — implement `AuthenticateCommandHandler` with `IProfileService`. Replace `src/cli/index.ts:126` `null as any` with a real instance.
  3. `src/services/profile-service.ts` (new) — adapter wrapping `AuthService` + `ProfileManager` for the mediator.
  4. `src/cli/commands/auth-command.ts` — `showProfileMenu` becomes a thin TTY wrapper around the mediator; `authenticateToProfile`/`addProfile`/`deleteProfile`/`renameProfile`/`setDefaultProfile`/`renewProfile` private methods become argv parsers.
  5. `src/cli/utils/reauth.ts` — move into `AuthenticateCommandHandler.handle` (or a thin prompt runner), so the reauth flow is the same code in interactive and non-interactive modes.
  6. `tests/cli/{continue,new,auth}-command.test.ts` — refactor around new mediator dispatch.
  7. `tests/cli/utils/chat-list-browser.test.ts` — add an `executeAction → continue` dispatch test.
  8. `openspec/specs/{commands,interactive-prompt-loop,auth,chat-list-browser}/spec.md` — delta entries.
- **Public CLI surface:** unchanged.
- **Performance:** negligible. The interactive menu's per-action mediator dispatch adds one round-trip through the mediator that today is a direct service call. Each round-trip is in-process, microseconds.
- **Backward compatibility:** every flow that currently works continues to work; the refactor changes *how* the work is dispatched, not what it produces. The `AuthenticateCommandHandler`-as-`null` placeholder is replaced by a real handler, so the registered handlers count goes from 9 to 12 (the four profile-mutating handlers plus renew). No command-line observable changes.

## Out of scope

- **`commandClientService.profileHasConversation(name, id)` at `src/cli/client-services.ts:41-43`** has the same "factory called with no arg" defect as the `list -p <name>` bug. Already flagged in the open `profile-aware-factory-wiring` change. Fixing it is a one-line follow-up; deferred because it does not affect the user's reported interactive-vs-non-interactive symptom.
- **`chat-list-bulk-actions` and `list-interactive-action-profile-coverage` changes** are independent and orthogonal. Both benefit from this refactor but neither depends on it.
- **A `MessageService.send` extraction (Shape (b) from the investigation)** was considered and rejected: it would be a big-bang refactor that pulls metadata threading out of `GeminiClientService` and re-implements it in two places. The mediator-routing refactor (Shape (a)) is sufficient and incremental.