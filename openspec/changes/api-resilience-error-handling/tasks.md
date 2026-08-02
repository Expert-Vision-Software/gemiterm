## Implementation Notes

- **Commit points**: Each task group that ends with a `[COMMIT]` marker is a natural commit boundary. Commit after completing all tasks in the group and verifying tests pass.
- **Keep tasks.md in sync**: After completing each task group, mark completed tasks as `[x]` and record the current task count and test pass/fail status.
- **After implementation**: Run the `code-review` skill and address findings before declaring the change complete.

---

## 1. Fix `listChats()` null-coalescing bug (gemini-client-wrapper.ts)

- [ ] 1.1 In `src/services/gemini-client-wrapper.ts`, modify `listChats()` (line ~241-242): replace `(raw ?? [])` with an explicit null check that throws `GemitermError` containing `"Gemini returned no data"` and `"session may be expired"` when `raw` is `null` or `undefined`
- [ ] 1.2 Update existing tests in `tests/services/gemini-client-wrapper.test.ts` that mock `chats()` returning `null` — they should now expect a throw, not an empty array
- [ ] 1.3 Run `bun test tests/services/gemini-client-wrapper.test.ts` — confirm all tests pass

**[COMMIT]**

## 2. Fix `profileHasConversation()` error swallowing (gemini-client-wrapper.ts)

- [ ] 2.1 In `src/services/gemini-client-wrapper.ts`, modify `profileHasConversation()` (lines 224-232): remove the `try/catch` that returns `false` on error; instead, let errors propagate to the caller
- [ ] 2.2 Add `{ limit: 50 }` to the `listChats()` call inside `profileHasConversation()` to avoid fetching all conversations when only checking for existence
- [ ] 2.3 Update the `IGeminiClientService` interface in `src/core/command-handlers.ts` if the method signature changed (it didn't, but verify the declaration is present)
- [ ] 2.4 Update tests in `tests/services/gemini-client-wrapper.test.ts` — add a scenario where `listChats()` throws and `profileHasConversation()` propagates the error
- [ ] 2.5 Run `bun test tests/services/gemini-client-wrapper.test.ts` — confirm all tests pass

**[COMMIT]**

## 3. Add authenticated-profile filtering to `ListChatsQueryHandler` (query-handlers.ts)

- [ ] 3.1 Change the `ListChatsQueryHandler` constructor in `src/core/query-handlers.ts`: replace `listProfiles: () => string[]` parameter with `profileManager: { hasValidCookies(name: string): boolean; list(): string[] }` — extract a minimal interface type `ProfileManagerForQuery` with those two methods
- [ ] 3.2 In `handle()`, when `allProfiles` is true: filter `profileManager.list()` to only profiles with `profileManager.hasValidCookies()` returning `true`; log a warning via the logger for each skipped profile: `"Skipping unauthenticated profile '<name>'"`
- [ ] 3.3 Add a `logger` parameter to the handler constructor (type `import('../infrastructure/logger.js').Logger`) so warnings can be emitted for skipped and failed profiles
- [ ] 3.4 Import `QUERY_TYPES`, `Query`, `QueryHandler`, `extractPayload`, and related types — verify no new imports are needed beyond the logger type

**[COMMIT]**

## 4. Replace `Promise.all` with `Promise.allSettled` (query-handlers.ts)

- [ ] 4.1 In `handle()`, replace the `Promise.all(...)` block (lines 93-95) with `Promise.allSettled(...)`
- [ ] 4.2 Iterate results: collect `ChatInfo[]` from fulfilled promises; log warnings with profile name and error message for rejected promises: `"Failed to list chats for profile '<name>': <error.message>"`
- [ ] 4.3 Add a try/catch around the entire `handle()` body to catch unexpected errors (e.g., type errors in result processing); re-throw with profile context when available
- [ ] 4.4 Run `bun run typecheck` to verify types

**[COMMIT]**

## 5. Update CLI wiring (cli/index.ts)

- [ ] 5.1 In `src/cli/index.ts`, update line 83: replace `new ListChatsQueryHandler(getGeminiClient, listProfiles)` with `new ListChatsQueryHandler(getGeminiClient, profileManager, logger)`
- [ ] 5.2 Remove the unused `listProfiles` import from `../infrastructure/config.ts` if it was only used for this handler (check: `getDefaultProfileName` is still used in the same file, so keep it; `listProfiles` at line 10 is imported with `getDefaultProfileName` — check if `listProfiles` has other uses in this file)
- [ ] 5.3 Run `bun run typecheck` to verify the wiring compiles

**[COMMIT]**

## 6. Update and extend tests

- [ ] 6.1 Update `tests/core/query-handlers.test.ts`:
  - Update `ListChatsQueryHandler` constructor calls: replace `listProfiles` mock with `profileManager` mock
  - Add mock logger with `warn` spy
  - Add scenario: `allProfiles` filters out unauthenticated profiles (mock returns 3 profiles, 2 authenticated)
  - Add scenario: `allProfiles` with `allSettled` — one profile rejects, partial results returned
  - Add scenario: `allProfiles` with no authenticated profiles returns empty chats
  - Add scenario: single profile query (not `allProfiles`) bypasses auth check and propagates errors
  - Add scenario: `allProfiles` where all profiles reject — returns empty chats with warnings logged
  - Verify `logger.warn` was called with expected messages containing profile name
- [ ] 6.2 Update `tests/services/gemini-client-wrapper.test.ts`:
  - Update existing `listChats()` tests that mock SDK returning `null` — expect throw
  - Add scenario: `listChats()` SDK returns `undefined` — expect throw
  - Add scenario: `profileHasConversation()` propagates errors from `listChats()`
- [ ] 6.3 Review `tests/cli/list-command.test.ts` — ensure interactive mode tests still pass with the new behavior (unauthenticated profiles should produce warnings, not hangs)
- [ ] 6.4 Run `bun test` full suite — confirm baseline is intact (818+ pass, 0 fail) and any test count changes are documented

**[COMMIT]**

## 7. Verification and code review

- [ ] 7.1 Run `bun test` and record final test count in this tasks.md
- [ ] 7.2 Run `bun run typecheck` — confirm clean
- [ ] 7.3 Run `bash scripts/lint-path-mediation.sh` — confirm clean (no new direct imports of fs/path/os)
- [ ] 7.4 Run `code-review` skill on the diff, address all findings
- [ ] 7.5 Final `bun test` after review fixes, confirm baseline

**[COMMIT]**

---

## Test files to update

| File | Changes |
|------|---------|
| `tests/core/query-handlers.test.ts` | Constructor mock changes, new allProfiles scenarios |
| `tests/services/gemini-client-wrapper.test.ts` | Null-check throw tests, error propagation tests |
| `tests/cli/list-command.test.ts` | Verify interactive mode warnings for unauthenticated profiles |
