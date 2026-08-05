## Context

`GeminiClientService.profileHasConversation` (`src/services/gemini-client-wrapper.ts:221-225`) checks profile ownership of a conversation:

```ts
async profileHasConversation(profileName, conversationId) {
  const profileClient = this.forProfile(profileName);
  const chats = await profileClient.listChats({ limit: 1 });
  return chats.some((chat) => chat.id === conversationId);
}
```

`listChats` (`:227-261`) fetches the full chat list, sorts it DESC by timestamp, and **only then** slices to `limit`. So `limit: 1` yields just the newest chat. Any non-newest conversation is invisible to the membership check.

The sole caller is `ProfileAuthManager.findProfileForConversation` (`src/services/profile-auth-manager.ts:110-124`), which iterates active profiles and returns the first whose `profileHasConversation` is `true`. When the target conversation is not a profile's newest chat, no profile matches, and `fetch`/`export`/`continue`/`delete` throw "Could not find a profile that owns conversation".

Constraints:
- Path/IO mediation (AGENTS.md) — not relevant here; no fs/path changes.
- The `profileHasConversation(profileName, conversationId): Promise<boolean>` signature MUST NOT change (handlers and the `IGeminiClientService` interface depend on it).
- Errors from a profile's lookup MUST still propagate to `findProfileForConversation`'s `try/catch`, which `continue`s on error (graceful skip of stale/broken profiles).

## Goals / Non-Goals

**Goals**
- `profileHasConversation` reports `true` for **any** conversation in the profile's chat list, regardless of recency.
- Surgical change: confined to `profileHasConversation`; no interface change; no new dependencies.

**Non-Goals**
- Caching the chat list across calls within a process (considered, deferred — see Decisions).
- Changing `findProfileForConversation`'s iteration order or contract.
- Changing `listChats`'s sort/slice semantics (used correctly elsewhere).

## Decisions

### Decision 1: Use an unbounded `listChats()` membership scan

Replace `listChats({ limit: 1 })` with `listChats()` (no limit), then `chats.some(c => c.id === conversationId)`.

**Rationale**: This is unambiguously correct — the full list contains every conversation, so membership is exact. It is a one-line, low-risk change confined to the buggy method. The per-call cost is one `chats()` RPC returning the profile's full history, the same RPC the `list` command issues per profile.

**Alternatives considered**:
- **(a) `readChat(conversationId)` try/catch** — a single targeted RPC, cheaper than a full scan. Rejected for this bugfix because the SDK's `readChat` behavior for an unknown conversation id is not confirmed (the wrapper treats the result as `null | RawChatTurn[]` at `:266-267`, suggesting it may return empty rather than throw, but it may also raise `AuthError`/`APIError` for unknown ids, conflating "unknown" with "session failure"). Confirming this requires upstream verification (`deepwiki` on `gemini-web-sdk`); the correctness risk is not worth it for a surgical fix. Can be revisited as a follow-up optimization.
- **(c) Cache the full chat list per profile per process** — turns repeat lookups into O(1). Rejected as in-scope because it adds cache-invalidation complexity (new chats created mid-session, deletes, cross-process) for a benefit that only materializes when multiple operations resolve profiles in one process. Tracked as a future optimization.

### Decision 2: Keep the `profileClient = this.forProfile(profileName)` indirection

The method continues to derive a profile-scoped client via `forProfile` so the lookup runs against the named profile's cookies and attaches the correct `profile` tag. Unchanged.

## Risks / Trade-offs

- **[Performance] Each `findProfileForConversation` may issue up to N full-list RPCs (one per active profile)** → acceptable for the typical 1–3 profile, tens-to-hundreds-of-chats case; identical cost to `list --all-profiles`. If histories grow large, the deferred caching option (c) addresses it.
- **[Stale profile] A profile whose `listChats` throws is skipped by `findProfileForConversation`'s `try/catch`** → unchanged behavior; the error path already handles this gracefully.
- **[Test drift] The existing `passes limit:1 to listChats for targeted lookup` test encodes the bug** → it is updated in the same change to assert the corrected (unbounded) lookup.

## Migration Plan

Single-PR, backwards-compatible. No data migration, no config change, no interface change. Deploy and ship in the next patch release.

## Open Questions

None. (The `readChat` semantics question is tracked as a possible follow-up optimization, not a blocker.)
