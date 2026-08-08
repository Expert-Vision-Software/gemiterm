## Why

The CLI's query/command client-service objects (`clientService` / `commandClientService`, built in `src/cli/index.ts` and now extracted to `src/cli/client-services.ts`) expose a `forProfile(name)` method that reads a module-level singleton populated only by a prior `getGeminiClient()` call. When `fetch`/`export`/`continue`/`delete` is the first data operation in a process (with or without `--profile`), the singleton is still `null` and `forProfile` throws a bare `AuthenticationError("Not authenticated. Please run 'gemiterm login' first.")`. This breaks every profile-scoped data command whenever it runs before a `list`/`new`/`models` call. The auto-discovery path is also hit: `findProfileForConversation` resolves the owning profile, then `clientService.forProfile(owner)` throws on the very next call.

## What Changes

- Make `forProfile(name)` on the CLI's `clientService` and `commandClientService` (`src/cli/client-services.ts`) **async** and have it `await getGeminiClient(name)` to lazily initialize the singleton before delegating to `GeminiClientService.forProfile(name)`, instead of throwing when the singleton is null.
- **BREAKING (internal interface)**: `IGeminiClientService.forProfile` and `IGeminiClientQueryService.forProfile` (`src/core/command-handlers.ts`, `src/core/query-handlers.ts`) change from returning `Self` to returning `Promise<Self>`. The concrete `GeminiClientService.forProfile` becomes `async`.
- Audit and update every `forProfile` call site to `await` the result: `FetchChatQueryHandler` and `ListChatsQueryHandler` (`src/core/query-handlers.ts`), `ListCommand` interactive path (`src/cli/commands/list-command.ts`), and any handler that chains `.forProfile(name).<method>()`.
- Update test doubles that return `this` synchronously from `forProfile` (e.g. the `gimme` helper in `tests/services/phantom-auth.test.ts` and the inline stubs in `tests/services/profile-auth-manager.test.ts`) to return a `Promise`.

## Capabilities

### New Capabilities
<!-- none -->

### Modified Capabilities
- `auth`: Add a requirement that the CLI client-service `forProfile(name)` MUST lazily initialize the profile client via `getGeminiClient(name)` (which runs `ensureAuthenticated` and the reauth prompt path) and MUST be awaitable. It MUST NOT throw "not authenticated" solely because no prior call cached the singleton.

## Impact

- **Code**: `src/cli/client-services.ts` (the extracted factory), `src/cli/index.ts` (unchanged wiring, now consumes the async factory), `src/services/gemini-client-wrapper.ts` (`forProfile` becomes async), `src/core/command-handlers.ts` and `src/core/query-handlers.ts` (interface signatures), `src/core/query-handlers.ts` call sites (`:98`, `:114`, `:148`), `src/cli/commands/list-command.ts` (`:236-254`).
- **Tests**: `tests/cli/client-services.test.ts` (the red test, turns green), `tests/services/phantom-auth.test.ts` and `tests/services/profile-auth-manager.test.ts` (`gimme`/stub `forProfile` doubles), any handler test that invokes `forProfile`.
- **Behavior**: profile-scoped data commands work as the first operation in a process. No change to the reauth prompt flow (still driven by `getGeminiClient`).
- **Risk**: medium — the interface change touches every `forProfile` caller; a missed `await` would surface as a runtime `Promise` misuse. Covered by `bun run typecheck` (TS flags missing await on the typed interface) and the full suite.
