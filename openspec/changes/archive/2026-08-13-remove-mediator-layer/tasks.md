## 1. New context and helpers

- [ ] 1.1 Rewrite `src/cli/command-registry.ts`'s `CliCommandContext` to `{ verbose, profileAuthManager, getGeminiClient: () => GeminiClientService, listProfiles: () => string[] }`, dropping `mediator`.
- [ ] 1.2 Add `src/cli/utils/gemini-queries.ts` with `listChatsForRequest(...)` and `fetchChatForRequest(...)`.
- [ ] 1.3 Narrow `src/services/profile-auth-manager.ts`'s `geminiClient` dependency to a minimal `profileHasConversation` interface; drop the `IGeminiClientService` import.
- [ ] 1.4 In `src/services/gemini-client-wrapper.ts`, drop the `implements IGeminiClientService, IGeminiClientQueryService` clause and the imports of the deleted interfaces.

## 2. Rewire the entrypoint

- [ ] 2.1 Replace `setupMediator(mediator)` with `setupContext()` in `src/cli/index.ts`, returning `{ profileAuthManager, getGeminiClient, listProfiles }`.
- [ ] 2.2 Update `main()` to pass the new context to `handler.execute(args, context)`.

## 3. Rewire the commands

- [ ] 3.1 `list-command.ts` → `listChatsForRequest`; keep sort/date-filter/limit slicing.
- [ ] 3.2 `fetch-command.ts` → `fetchChatForRequest`.
- [ ] 3.3 `new-command.ts` → `getGeminiClient().startNewChat` / `forProfile`.
- [ ] 3.4 `continue-command.ts` → `sendMessage` / `fetchChatForRequest`.
- [ ] 3.5 `delete-command.ts` → `deleteChat` with `forProfile` routing.
- [ ] 3.6 `export-command.ts` → `fetchChatForRequest`.
- [ ] 3.7 `export-all-command.ts` → `listChatsForRequest` + per-chat `fetchChatForRequest`.
- [ ] 3.8 `models-command.ts` → `getGeminiClient().listModels()`.

## 4. Delete the mediator layer

- [ ] 4.1 Delete `src/core/mediator.ts`, `src/core/command-handlers.ts`, `src/core/query-handlers.ts`.
- [ ] 4.2 Delete `tests/unit/mediator.test.ts` and `tests/core/query-handlers.test.ts`.

## 5. Tests

- [ ] 5.1 Rewrite `tests/cli/*.test.ts` (list, fetch, new, continue, delete, export, export-all, models, status, auth) to inject a mock `GeminiClientService` and `ProfileAuthManager` instead of registering mediator handlers.
- [ ] 5.2 Update `tests/cli/command-registry.test.ts` for the new context shape.
- [ ] 5.3 Update `tests/integration/commands/*` that reference the mediator.

## 6. Verify

- [ ] 6.1 `bun run typecheck` clean.
- [ ] 6.2 `bun test` full suite green (baseline 820 pass, 0 fail; count shifts as mediator/query-handler tests are removed and new command tests added).
- [ ] 6.3 `bash scripts/lint-path-mediation.sh` clean.
