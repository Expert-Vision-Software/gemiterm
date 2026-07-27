# Fix: `gemiterm continue` creates new chats instead of continuing the existing one

## Why

`gemiterm continue <conversation_id> <message>` (and the interactive REPL form) does not actually continue the named conversation. Every message lands in a brand-new chat, and the user sees the model respond with no context from the prior turns. The reporter sees the same symptom in three shapes:

1. `gemiterm continue <cid> "follow up"` — model treats the message as a fresh prompt; the user's original chat history gets no new turn.
2. `gemiterm new` followed by two messages in the REPL — second message ignores the first; new conversation is started under the hood.
3. Following a fresh `gemiterm list` then `gemiterm continue <cid>` — the `continue` message creates a brand-new cid, the original cid's `chats()` listing is unchanged.

Root cause verified by the throwaway diagnostic at `tests/_diag-send-cid.test.ts` (captures the `chat.metadata` array the wrapper actually sends to `gemini-reverse`'s `StreamGenerate` endpoint). The wrapper:

```ts
const session = this.client!.newChat();
session.cid = conversationId;                              // sets only _meta[0]
const output = await session.generateContent({ prompt: message });
```

This sets `_meta[0]` (the `cid`) but leaves `_meta[1]` (`rid`) and `_meta[2]` (`rcid`) empty. The gemini-reverse wire format sends the full 10-element array as `inner[2]`, and the upstreamserver uses `[cid, rid, rcid, ...]` to thread onto an existing conversation turn. With `rid`/`rcid` empty, the server can't match the conversation: it creates a new chat and returns a fresh cid that overwrites the local one.

The `gemini-reverse` README documents this contract explicitly under "Continue Previous Conversations" ("`The metadata array contains [cid, rid, rcid, ...] which uniquely identifies the conversation turn. Storing and restoring it is enough to resume the exact conversation context.`"). The current wrapper meets it for `startNewChat` only by accident (a fresh server response that happens to include valid rid/rcid), and fails it for any `sendMessage` against a known cid.

Two factors compound it:

1. **Re-introduction in 2.1.0 upgrade.** The v2.4.0-rc.1 changelog migration note records `startChat({ cid }) -> newChat() + session.cid = cid`. In `gemini-reverse@1.x` the constructor copied `cid` straight into `_meta[0]` too, but the broader flow at the time was different (no per-process session handoff). The 2.1.0 surface is the first one where `session.cid = cid` is the *only* mechanism, and it's the first version where this wiring is visibly wrong against the README's documented contract.
2. **No regression test at the bug surface.** `tests/services/gemini-client-wrapper.test.ts` `describe("sendMessage")` only asserts on the returned text — never asserts on the wire-level metadata. The integration test at `tests/integration/commands/continue.test.ts` mocks the mediator at the boundary above the wrapper, so it can never catch this kind of cross-process regression.

## What Changes

- **Persist chat metadata per cid, per profile.** A new `src/services/chat-metadata-storage.ts` module loads, saves, and looks up the `(rid, rcid, ctx)` triple associated with each known `cid`, stored per-profile in the existing profile directory. The schema is additive: existing profile directories gain one new `chat-metadata.json` file; the existing `storage_state.json` is untouched.
- **Capture metadata on every successful turn.** After `GeminiClientService.startNewChat` and after `GeminiClientService.sendMessage`, the wrapper extracts `(cid, rid, rcid, ctx)` from `output.metadata` and writes it via the new storage. On failures, the cached value for that cid is untouched.
- **Restore metadata on `sendMessage`.** `sendMessage(cid, msg)` looks up the saved metadata for `cid`. When present, it constructs the session via `client.newChat({ metadata: savedMetadata })`. When absent (legacy chats from before this change, or chats whose metadata was somehow lost), it falls back to the existing `client.newChat() + session.cid = cid` path with a single debug-level log line — no exception, no user-visible change of behavior.
- **Look up is profile-scoped.** `sendMessage(cid)` already takes a `profileName` payload (the mediator forwards it from `ContinueCommand.resolveProfile`). The storage layer keys records by `${profileName}|${cid}` so two profiles that happen to share a cid (unusual but technically allowed) don't cross-contaminate.
- **Same-process in-memory cache.** Inside `GeminiClientService`, a `Map<string, ChatMetadata>` keyed by `${profileName}|${cid}` skips the on-disk read when the wrapper just produced the metadata itself in the same process. Disk I/O is bounded to first turn in a session and process-restart scenarios.

## Capabilities

### Modified Capabilities

- `conversations` — add a requirement on `GeminiClientService.sendMessage`: the request body sent to the upstream `StreamGenerate` endpoint MUST include `chat.metadata` with the `rid` and `rcid` slots populated from the same conversation's last successful response. When no prior response is known for the `(profile, cid)` pair, the wrapper falls back to a `cid`-only send and logs the fallback at debug level.
- `commands` — modify the `ContinueCommand` requirement so the contract on `gemiterm continue <cid> <msg>` is "appends to the conversation identified by `<cid>`", not "may create a new conversation". The interactive REPL form (`gemiterm continue <cid>` with no message) inherits the same requirement.
- `gemini-client` (new, scoped to the area previously called out as sensitive in `AGENTS.md`) — describe the `ChatMetadataStorage` contract: per-profile persistence keyed by cid, the in-memory cache layer, and the order of operations on the new wrapper methods.

## Impact

- **Code touched**
  - `src/services/chat-metadata-storage.ts` — new module. Class `ChatMetadataStorage` with methods `load(profileName)`, `lookup(profileName, cid)`, `save(profileName, cid, metadata)`, `delete(profileName, cid)`, `listAll(profileName)`. Files path: `<profileDir>/chat-metadata.json`. Backed by `infrastructure/io.ts` (read/write JSON) per the path-mediation rule.
  - `src/services/gemini-client-wrapper.ts` — `startNewChat` and `sendMessage` now (a) capture `output.metadata` after the inner `generateContent` resolves, (b) pass it to `ChatMetadataStorage.save`, (c) on `sendMessage`, call `storage.lookup` and pass the result via `client.newChat({ metadata })` when present. `readChat`, `listChats`, `deleteChat` unchanged.
  - `src/core/command-handlers.ts` — no signature change. The `SendMessageCommandPayload` already carries `conversationId` and optional `profileName`. The handler forwards them as before.
  - `src/cli/commands/continue-command.ts` and `src/cli/commands/new-command.ts` — no behavioral change. Existing dispatch remains; the wrapper is what changes.
  - `src/infrastructure/path-utils.ts` — new helper `getProfileChatMetadataPath(profileName: string): string` (or alternatively reuse `getProfilePath(profileName)` for the existing storage file plus a sibling `chat-metadata.json`); follows the path-mediation exemption list in `AGENTS.md`.
  - `scripts/lint-path-mediation.sh` and `.github/workflows/test.yml` — add the new service file to the exemption list (one-liner, with a comment explaining why).
- **APIs / public surface**
  - One new exported class `ChatMetadataStorage`, one new helper in `path-utils.ts`, no other surface changes. The `ChatInfo`, `Message`, command/query, and CLI types are unchanged.
- **Dependencies** — none. All work is in-tree.
- **Multi-profile** — covered: the storage layer keys records by `${profileName}|${cid}`. The existing `ContinueCommand.resolveProfile` already resolves the owning profile per cid before dispatch.
- **Conformance** — `startNewChat` behavior is unchanged (a brand-new chat still has no metadata to load; we just persist the response for the next turn). `deleteChat` does NOT delete the metadata cache (the cache will simply no longer match a fresh server-side cid when this matters; the next `listChats` rebuilds). The non-interactive `gemiterm list` output is unchanged.
- **Storage format** — additive. Existing profile directories gain one new file `chat-metadata.json`. The existing `storage_state.json` is not touched. The format is `{ "version": 1, "entries": { "<cid>": ["rid", "rcid", null] } }`, intentionally narrow (no full 10-element metadata; the upstream consumer needs only `rid` and `rcid` for thread matching, and `ctx` for index 9 — but on inspection the empty default works for continues, so the minimum is sufficient).

## Non-goals

- Calling Gemini to look up metadata. The fix relies on metadata we already receive in the response of every `generateContent`. No new RPC, no new polling, no new endpoint.
- Backfilling metadata for chats that existed before this change. A user who runs `gemiterm continue <legacy-cid> "msg"` against a conversation they created on 2.4.0-rc.2 will see the debug-level "no prior metadata" log and the message will still go through (just on the existing buggy fallback path). The fix takes effect from the first new turn onward.
- Cleaning up stale cache entries. `deleteChat` leaves the metadata file untouched. If a cid is deleted on the server side but still cached locally, the next `continue` would attempt to thread against a server-side-missing conversation and fall back gracefully. (Out of scope: a separate cache-eviction policy.)
- Persisting the full 10-element metadata. Tests show `rid` and `rcid` are the load-bearing slots. We persist only what's needed.
