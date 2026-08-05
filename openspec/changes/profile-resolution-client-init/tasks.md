# Tasks: profile-resolution-client-init

## 1. Make forProfile async and lazy

- [ ] 1.1 In `src/core/command-handlers.ts`, change `IGeminiClientService.forProfile` to return `Promise<IGeminiClientService>`.
- [ ] 1.2 In `src/core/query-handlers.ts`, change `IGeminiClientQueryService.forProfile` to return `Promise<IGeminiClientQueryService>`.
- [ ] 1.3 In `src/services/gemini-client-wrapper.ts`, make `GeminiClientService.forProfile` `async` (body unchanged; wrap in async).
- [ ] 1.4 In `src/cli/client-services.ts`, change both `forProfile` methods to `async forProfile(name) { const c = await getGeminiClient(name); return c.forProfile(name); }` and remove the now-unused `getCachedClient` parameter and `AuthenticationError` import.

## 2. Green the red test

- [ ] 2.1 Run `bun test tests/cli/client-services.test.ts` — confirm both `forProfile` tests pass (green).
- [ ] 2.2 Update `src/cli/index.ts` to stop passing the `() => geminiClient` accessor to `createClientServices` (signature changed in 1.4).

## 3. Audit and fix call sites (typecheck-driven)

- [ ] 3.1 Run `bun run typecheck` and collect every error referencing `forProfile` (missing await / Promise misuse).
- [ ] 3.2 In `src/core/query-handlers.ts`, await `forProfile` at `ListChatsQueryHandler` (`:98`, `:114`) and `FetchChatQueryHandler` (`:148`).
- [ ] 3.3 In `src/cli/commands/list-command.ts`, await `forProfile` on the interactive path (`:236-254`).
- [ ] 3.4 Fix any remaining call sites surfaced by typecheck.
- [ ] 3.5 Re-run `bun run typecheck` — clean.

## 4. Update test doubles

- [ ] 4.1 In `tests/services/phantom-auth.test.ts`, change the `gimme` helper's `forProfile() { return this }` to `async forProfile() { return this }` (return a Promise).
- [ ] 4.2 In `tests/services/profile-auth-manager.test.ts`, update the inline `forProfile() { return this as ... }` stubs (in `createManager` and the `server-side probe` `gimme`) to return a Promise.
- [ ] 4.3 Fix any other test stub flagged by the suite.

## 5. Verify

- [ ] 5.1 Run `bun test` — full suite green, baseline intact.
- [ ] 5.2 Run `bun test tests/services/phantom-auth.test.ts` and `tests/services/profile-auth-manager.test.ts` — probe/refresh assertions unchanged.

## 6. Spec sync

- [ ] 6.1 After implementation, sync/archive the `auth` delta into the main spec.
