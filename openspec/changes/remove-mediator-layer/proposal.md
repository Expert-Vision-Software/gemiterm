## Why

A CQRS mediator with 12 handler classes, ~20 payload/result interfaces, and ~93 lines of wiring serves a CLI of 13 commands. `Mediator.send()` has no middleware pipeline, no logging, and no multiple transports — it is a synchronous in-process map lookup. Four command handlers (authenticate, delete-profile, rename-profile, set-default-profile) are registered with `null as any` service dependencies, so they are broken and unreachable; `auth` and `status` already bypass the mediator and instantiate their services directly. The abstraction earns no leverage: it adds 8 hops to a single method call and forces every command to depend on `Mediator` plus `ProfileAuthManager`.

## What Changes

- **BREAKING** Remove the mediator layer: delete `src/core/mediator.ts`, `src/core/command-handlers.ts`, and `src/core/query-handlers.ts` (query/command message types, `COMMAND_TYPES`/`QUERY_TYPES` constants, and all 12 handler classes).
- Commands call `GeminiClientService` (via a lazy `getGeminiClient()` factory in the context) and `ProfileAuthManager` directly.
- Replace `CliCommandContext`'s `mediator` field with `getGeminiClient: () => GeminiClientService` and `listProfiles: () => string[]`; keep `verbose` and `profileAuthManager`.
- Move the `listChats` profile/all-profiles fan-out logic (currently in `ListChatsQueryHandler`) into a shared helper consumed by `list` and `export-all`.
- Narrow `ProfileAuthManager`'s `geminiClient` dependency to the single method it uses (`profileHasConversation`), removing its import of the deleted `IGeminiClientService` interface.
- Delete the four dead `null as any` command handlers and their payload/result interfaces.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mediator`: The entire capability is removed — the mediator, its handler interfaces, and message types no longer exist. Every requirement is deleted.
- `commands`: The `CommandRegistry` requirement's `CliCommandContext` shape changes (drop `mediator`, add `getGeminiClient` and `listProfiles`). Dispatch references in command requirements change from "sends X to the mediator" to "calls the `GeminiClientService` directly"; all user-visible flags and output remain byte-equivalent.

## Impact

- **Code:** delete 3 files in `src/core/` (~470 lines), rewrite `src/cli/index.ts` (drop `setupMediator` → `setupContext`), rewrite `src/cli/command-registry.ts`, touch 8 command files, `src/services/gemini-client-wrapper.ts` and `src/services/profile-auth-manager.ts`.
- **Tests:** delete `tests/unit/mediator.test.ts` and `tests/core/query-handlers.test.ts`; rewrite `tests/cli/*.test.ts` (list, fetch, new, continue, delete, export, export-all, models) and `tests/integration/commands/*` to inject a mock `GeminiClientService` instead of registering mediator handlers.
- **Dependencies:** none changed.
