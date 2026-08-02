## Why

Four bugs cause the CLI to hang silently, lose error context, and misreport failures as empty results when dealing with unauthenticated profiles or API transport errors. Users on multi-profile setups experience 5-minute freezes with `list -i`, see misleading "No conversations found" when the API silently fails, and get raw errors with no indication of which profile failed. These degrade the CLI from feeling robust to feeling broken.

## What Changes

- **Filter unauthenticated profiles before querying** — `ListChatsQueryHandler` only queries profiles with valid cookies, preventing hangs from expired sessions
- **Use `Promise.allSettled` instead of `Promise.all`** — partial results are returned when some profiles fail; warnings are logged for the failed ones
- **Throw on null/undefined SDK returns** — `listChats()` in `GeminiClientService` throws a descriptive error instead of silently treating null as empty
- **Add timeout guard to `profileHasConversation`** — the per-profile lookup adds a reasonable limit and propagates errors instead of silently swallowing them
- **Add try/catch in `ListChatsQueryHandler`** — any unhandled error includes the profile name in the message
- **Inject `ProfileManager` into `ListChatsQueryHandler`** — the handler uses `hasValidCookies()` to gate profile queries (replaces the `listProfiles` callback)

## Capabilities

### New Capabilities

- `api-error-propagation`: Structured error handling for Gemini API calls — null-gating, meaningful error messages, and partial-result collection with profile-scoped warnings

### Modified Capabilities

- `gemini-client`: `listChats()` must throw when the SDK returns null/undefined instead of silently coalescing to empty array; `profileHasConversation()` must not silently swallow errors
- `multi-profile-conversations`: `list --all-profiles` and `list -i` must skip unauthenticated profiles and degrade gracefully when some profiles fail

## Impact

- **Affected code**: `src/core/query-handlers.ts` (`ListChatsQueryHandler`), `src/services/gemini-client-wrapper.ts` (`listChats`, `profileHasConversation`), `src/cli/index.ts` (handler wiring), `src/core/command-handlers.ts` (handler registration)
- **Test files**: `tests/core/query-handlers.test.ts`, `tests/services/gemini-client-wrapper.test.ts`, `tests/cli/list-command.test.ts`
- **Non-breaking**: All changes are internal; the CLI surface (`list`, `list -i`, `list --all-profiles`) is preserved. The only observable difference is graceful degradation instead of hangs or misleading empty results
