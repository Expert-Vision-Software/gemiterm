## Context

GemiTerm's `ListChatsQueryHandler` queries Gemini's chat API across multiple profiles. When `--all-profiles` or `--interactive` is used, it calls `listProfiles()` (which returns directory names, not just authenticated profiles) and fans out with `Promise.all`. The Gemini SDK's `init()` has a 5-minute timeout, so an unauthenticated profile blocks the entire command. No try/catch, no progress indicators, no partial results.

Similarly, `GeminiClientService.listChats()` silently treats `null` SDK returns as empty arrays, and `profileHasConversation()` silently swallows all errors. Users see "No conversations found" or a hung terminal with no explanation.

The code paths affected are in two files: `src/core/query-handlers.ts:83-102` and `src/services/gemini-client-wrapper.ts:224-254`.

## Goals / Non-Goals

**Goals:**
- Prevent 5-minute hangs from unauthenticated profiles in multi-profile queries
- Surface meaningful errors when SDK calls fail or return null
- Return partial results when some profiles fail and others succeed
- Add profile name context to error messages for debuggability
- Make `profileHasConversation` propagate errors instead of silently returning false

**Non-Goals:**
- Changing the Gemini SDK timeout behavior (that's upstream)
- Adding retry logic for transient API failures
- Modifying single-profile code paths (no `--all-profiles`)
- Changing the CLI output format (text/JSON) for successful results

## Decisions

### 1. Filter unauthenticated profiles via `ProfileManager.hasValidCookies()` instead of a pre-flight API call

**Alternatives considered:**
- Pre-flight API call per profile (slow, defeats the purpose — the bug is that API calls hang)
- Catch-and-skip in `Promise.allSettled` (still triggers the 5-min timeout, just doesn't block)

**Decision:** Use `ProfileManager.hasValidCookies()` — a local, synchronous check on cookie freshness. This is the same check used by `authenticate()` to gate profile usage and is already the canonical "is this profile usable?" gate. Injects `ProfileManager` into `ListChatsQueryHandler`'s constructor, replacing the `listProfiles` callback.

### 2. `Promise.allSettled` + logger.warn for partial failure in all-profiles queries

**Alternatives considered:**
- `Promise.all` with try/catch around each profile (same effect, more code)
- AbortController with timeout per profile (adds complexity; upstream timeout is the real issue)

**Decision:** `Promise.allSettled` processes all profiles concurrently. Fulfilled results are collected; rejected results log a warning with the profile name and error message. The handler returns partial results. This degrades gracefully — the user sees conversations from working profiles and warnings about broken ones.

### 3. Throw custom `GeminiClientError` on null/undefined SDK returns instead of coalescing to empty

**Alternatives considered:**
- Return empty array and log debug (current behavior — silent failure)
- Return empty array and log warning (still misleading)

**Decision:** Throw `GemitermError` with message "Gemini returned no data — session may be expired" (or a more specific sub-type). The null state means the SDK completed its call but returned nothing, which is categorically different from "no conversations exist." The caller's try/catch or `allSettled` wrapper will surface this as a profile-level error.

### 4. `profileHasConversation` throws on API errors instead of swallowing them

**Alternatives considered:**
- Keep the silent catch but log a warning (still hides errors from callers like `resolveProfile`)
- Add a limit to `listChats()` call in `profileHasConversation` (partial; the real issue is silent swallowing)

**Decision:** Remove the `try/catch` that returns `false` on any error. The caller (`findProfileForConversation` in `ProfileAuthManager`) already handles errors from `profileHasConversation`; the current behavior masks legitimate failures as "conversation not found." Add the `limit: 1` option to `listChats()` inside `profileHasConversation` to make the query faster (we only need to check existence, not fetch all chats).

### 5. Handler constructor change: inject `ProfileManager` instead of `listProfiles` callback

**Alternatives considered:**
- Add a separate `getAuthenticatedProfiles` callback (two callbacks, more wiring)
- Pass `hasValidCookies` function directly (tight coupling)

**Decision:** Replace the `listProfiles: () => string[]` callback with a `profileManager: { hasValidCookies(name: string): boolean; list(): string[] }` reference (the `IProfileManager` interface or an extracted sub-interface). This gives the handler both `list()` and `hasValidCookies()` without adding new wiring in `cli/index.ts`. The mediator wiring in `src/cli/index.ts` already has a `ProfileAuthManager` reference that can provide this.

## Risks / Trade-offs

- [Legitimate profile with cookies that pass freshness check but fail API call] → Still triggers the bug, but the `allSettled` change limits damage to a warning + skip instead of a global hang
- [Cookie freshness check may be stale] → Profile cookies are checked on load; the 7-day window is generous. A profile that passes freshness but has revoked cookies will be caught by `allSettled` and reported as a warning
- [Additional dependency in handler constructor] → Slight increase in wiring complexity; handler signature changes from 2 params to 2 params (listProfiles is replaced, not added to)
- [`profileHasConversation` now throws] → Callers that expected `false` on error may break. Audit of call sites (`findProfileForConversation` in `profile-auth-manager.ts`) confirms they already handle errors; no other call sites exist
