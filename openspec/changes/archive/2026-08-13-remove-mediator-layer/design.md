## Context

The CLI dispatches a subcommand to a `CliCommand.execute(args, context)`. Today `context` carries `{ verbose, mediator, profileAuthManager }`, and 8 of 13 commands reach services only through `mediator.send({ type, payload })`. The mediator maps a string `type` to a handler object; the handlers are thin 1:1 adapters over `GeminiClientService` and `ProfileManager`. This design duplicates a method call as a message object + a registered adapter.

## Goals / Non-Goals

Goals:

- Delete the mediator, its 12 handlers, and ~20 message/result interfaces.
- Commands obtain the resolved `GeminiClientService` and call it directly.
- Preserve every user-visible behavior byte-for-byte: flags, exit codes, output formatting, error messages.
- Keep the existing lazy-client seam (construct the `GeminiClientService` from cookies only on first use) so commands that don't need the API (e.g. `status`, `auth`) never hit `AuthenticationError`.

Non-goals:

- Do NOT change cookie/auth behavior, output formats, or flag semantics.
- Do NOT fold `GeminiClientService` construction into the commands (construction stays in the entrypoint; a future change — `#5` — may extract a factory).

## Decisions

### 1. Context shape

```ts
export interface CliCommandContext {
  verbose: boolean;
  profileAuthManager: ProfileAuthManager;
  getGeminiClient: () => GeminiClientService;
  listProfiles: () => string[];
}
```

`getGeminiClient` preserves the lazy factory from the old `setupMediator`: it caches a single `GeminiClientService` built from the default profile's cookies and throws `AuthenticationError` when no profiles exist. `listProfiles` is passed through the context (rather than imported directly by commands) so the `list --all-profiles` fan-out stays mockable in unit tests without `mock.module`.

### 2. Shared fan-out helper

The `ListChatsQueryHandler` fan-out logic moves to `src/cli/utils/gemini-queries.ts`:

```ts
export interface ListChatsRequest { limit?; offset?; search?; profile?; allProfiles?: boolean; }
export async function listChatsForRequest(getGeminiClient, listProfiles, request): Promise<ChatInfo[]>;
export async function fetchChatForRequest(getGeminiClient, conversationId, profileName?): Promise<Message[]>;
```

`listChatsForRequest` routes to `forProfile(profile)`, fans out over `listProfiles()` for `allProfiles` (flattening + sorting by `timestamp` desc), or calls `listChats` on the default client. `fetchChatForRequest` picks `forProfile(profileName)` vs. the default client. Both `list` and `export-all` use `listChatsForRequest`; `fetch`, `export`, `continue`, and `export-all` use `fetchChatForRequest`.

### 3. Per-command changes

- `list`: `context.getGeminiClient()` → `listChatsForRequest(...)`. Keeps `applySort`, `applyDateFilter`, and local limit/offset slicing unchanged.
- `fetch`: `fetchChatForRequest(...)`.
- `new` / `continue`: `getGeminiClient().startNewChat(message)` / `.sendMessage(id, message)`; route via `forProfile` when a profile is resolved. `continue`'s `printLastMessage` uses `fetchChatForRequest`.
- `delete`: `(profile ? client.forProfile(profile) : client).deleteChat(id)`.
- `export`: `fetchChatForRequest(...)`.
- `export-all`: `listChatsForRequest(... allProfiles ...)` then per-chat `fetchChatForRequest(chat.id, chat.profile)`.
- `models`: `getGeminiClient().listModels()`.

### 4. ProfileAuthManager dependency

Change `ProfileAuthManagerDeps.geminiClient` from `IGeminiClientService` to a minimal structural interface declared inline:

```ts
interface ProfileConversationLookup {
  profileHasConversation(profileName: string, conversationId: string): Promise<boolean>;
}
```

`GeminiClientService` already satisfies this. This removes the last import of `command-handlers.ts` from the services layer.

### 5. GeminiClientService interface removal

`GeminiClientService` drops `implements IGeminiClientService, IGeminiClientQueryService` (both interfaces deleted). Its public methods (`listChats`, `fetchChat`, `deleteChat`, `sendMessage`, `startNewChat`, `listModels`, `forProfile`, `profileHasConversation`) are unchanged.

## Risks

- The lazy factory throws `AuthenticationError` when no profile exists. The old mediator `GetProfileStatusesQueryHandler`/`GetAuthStatusQueryHandler` were only reachable by `status`/`auth`, which already bypass the mediator — so no path loses a working query. Confirmed: no command other than `auth`/`status` calls those two handlers.
- Test churn is high; the mitigation is to keep the mock seam identical (a `GeminiClientService`-shaped mock object) so each test changes its injection point, not its assertions.

## Files

- Delete: `src/core/mediator.ts`, `src/core/command-handlers.ts`, `src/core/query-handlers.ts`, `tests/unit/mediator.test.ts`, `tests/core/query-handlers.test.ts`.
- Rewrite: `src/cli/index.ts`, `src/cli/command-registry.ts`, `src/services/profile-auth-manager.ts`.
- Edit: `src/services/gemini-client-wrapper.ts`, `src/cli/commands/{list,fetch,new,continue,delete,export,export-all,models}-command.ts`, all affected tests.
- New: `src/cli/utils/gemini-queries.ts`.
