## Context

The `getGeminiClient` function in `src/cli/index.ts` is a module-level closure that (a) creates and caches a `GeminiClientService`, (b) runs `ensureAuthenticated` against a profile to get cookies, (c) catches `AuthenticationError` and triggers reauth via `promptAndReauth`, and (d) is wired into `ListChatsQueryHandler` and 3 command handlers. The function is NOT exported — it is only accessible through the handlers that consume it.

The profile-aware-factory-wiring bug (`gemiterm list -p <name>` authenticates the default profile) is caused by `ListChatsQueryHandler` being wired with `getGeminiClient()` (no profile arg at `cli/index.ts:119`), so `ensureAuthenticated` uses the default profile for auth/rotation while `forProfile(name)` loads the named profile's cookies directly.

This change adds characterization tests that verify the profile-forwarding contract at the handler level (the highest testable seam without exporting `getGeminiClient`).

## Goals / Non-Goals

**Goals:**
- Test that `ListChatsQueryHandler` forwards the `profile` field to `IGeminiClientService.forProfile(name)`.
- Test that command handlers (`DeleteConversationCommandHandler`, `SendMessageCommandHandler`, `StartNewChatCommandHandler`) forward `profileName` to `forProfile(name)`.
- Test that `AuthenticationError` thrown by the client factory surfaces through the handler.
- Test multi-profile independence.

**Non-Goals:**
- Test the cache-hit/cache-miss behavior of the `getGeminiClient` closure (not accessible without exporting the function — deferred to Candidate A).
- Test the `promptAndReauth` flow end-to-end (already tested in `tests/cli/index.test.ts` via `runReauthFlow`).
- Test non-TTY behavior (requires `@inquirer/testing` — already covered by existing prompt-layer tests).

## Decisions

### D1. Test at the handler seam

**Choice:** Test `ListChatsQueryHandler` and the three command handlers directly by constructing them with a spy `getGeminiClient` factory and asserting on `forProfile` calls.

**Rationale:** The handlers are exported and accept their dependencies via constructor injection. The `getGeminiClient` factory is injectable as a constructor parameter. This is the highest testable seam without modifying `src/`.

**Alternatives considered:** Export `setupMediator` and test through mediator dispatch (requires a `src/` change — not allowed in Phase 0), test `getGeminiClient` directly (not exported).

### D2. Stub `igeminiClientService` with Bun.mock

**Choice:** Create a `createMockClient()` factory using `Bun.mock()` for each method, with a `_forProfileCalls: string[]` array to track which profiles were requested.

**Rationale:** The existing test patterns use `mock()` for assertion tracking (see `gimme` pattern in `tests/services/phantom-auth.test.ts`). Adding a call tracker is the simplest way to assert profile forwarding.

## Risks / Trade-offs

- **[Risk]** The handler-level tests don't exercise the real `getGeminiClient` closure, so they can't catch bugs in the closure's caching or reauth logic. → **Mitigation:** The profile-forwarding contract IS testable at the handler level, and that's the primary bug Phase 0 needs to catch. The closure's internal behavior is a Candidate A concern.
- **[Risk]** `tests/cli/index.test.ts` is already misnamed (tests `reauth.ts`). → **Mitigation:** Defer renaming — the new file uses a distinct name (`get-gemini-client.test.ts`).

## Migration Plan

N/A — Phase 0 is test-only.

## Open Questions

- Whether `tests/cli/index.test.ts` should be renamed to `reauth.test.ts`. Defer until the Phase 0 PR review.
