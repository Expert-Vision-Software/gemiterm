## Context

`GeminiClientService.sendMessage(conversationId, message)` does not continue the named conversation — every call creates a new chat. The throwaway diagnostic at `tests/_diag-send-cid.test.ts` proves the cause by capturing the wire-level `chat.metadata` array the wrapper sends to `gemini-reverse`'s `StreamGenerate` endpoint:

```
metadata = ["existing-conv-xyz", "", "", null, null, null, null, null, null, ""]
            ^^^ cid              ^^^ rid = ""       ^^^ rcid = ""
```

`gemini-reverse` source (`src/gemini.js:323`): `inner[2] = chat ? chat.metadata : [...DEFAULT_METADATA]`. The full 10-slot metadata array is sent on every `StreamGenerate` POST. The upstream server threads onto an existing conversation using `[cid, rid, rcid, ...]` — setting only `cid` (slot 0) leaves slots 1 and 2 empty, so the server can't thread and falls back to creating a new chat. The new cid is returned in `output.metadata[0]` and overwrites the local one.

The `gemini-reverse` README documents this contract: "The `metadata` array contains `[cid, rid, rcid, ...]` which uniquely identifies the conversation turn. Storing and restoring it is enough to resume the exact conversation context." The current wrapper only persists that array implicitly (in the live `ChatSession` object), which dies when the session goes out of scope. `startNewChat` works only because a fresh server response always populates the new session's metadata; `sendMessage` against a known cid fails because the new session has no prior metadata to thread onto.

The 2.1.0 migration note in `CHANGELOG.md` records: "`startChat({ cid })` → `newChat() + session.cid = cid`". Both versions set only `_meta[0]`. The 2.1.0 surface is the first one where this wiring is the *only* mechanism, and it's where the diagnostic test would have caught it (had the test existed). The integration test at `tests/integration/commands/continue.test.ts` mocks the mediator above the wrapper, so it can't catch cross-process wire regressions.

The fix captures and restores the full metadata. Storage is per-profile to align with the existing `cookie-storage-service.ts` pattern (one `CookieStorage` per profile, files in `<profileDir>`); the storage key is the profile name plus the conversation id.

## Goals / Non-Goals

**Goals**

- `sendMessage(cid, msg)` sends the full `chat.metadata` (cid + rid + rcid + ctx) when prior metadata is known, falling back gracefully when not.
- Per-profile, per-cid persistence of `(rid, rcid, ctx)`. Survives process restarts. Bounded keyspace (`Map<string, ChatMetadata>`).
- Existing same-process REPL semantics preserved: a chat started in `gemiterm new` can be continued in subsequent REPL turns without hitting the disk on every turn.
- Add a regression test at the bug surface — wire-level metadata capture via a `gemini-reverse` mock that follows the real `ChatSession` getter/setter semantics, asserted inline.
- Preserve the path-mediation rule from `AGENTS.md`: every new file in `src/services/` goes through `infrastructure/io.ts` for fs access.

**Non-Goals**

- Persisting the *full* 10-element metadata array. Tests + source confirm only `rid`/`rcid`/`ctx` are meaningful for thread matching, and `ctx` (slot 9) is set by the server on the *final* chunk of a streamed response — meaning it isn't fully populated by the time `startNewChat` returns from its first call. We persist only the slots we can read reliably.
- Calling any read-only endpoint (`readChat`, `chats`) to backfill metadata for legacy cids. The fallback path (`cid`-only with debug log) handles them.
- Refactoring `GeminiClientService.sendMessage` / `startNewChat` signatures. The new return type for `startNewChat` adds metadata alongside `conversationId` and `response`; `sendMessage` returns the same string. Mediators, command handlers, and CLI commands are untouched.
- Real-time cache eviction on `deleteChat`. Out of scope; the fallback path handles it.

## Decisions

### D1. Storage module lives in `src/services/chat-metadata-storage.ts`

```ts
// src/services/chat-metadata-storage.ts (interface sketch)
export interface ChatMetadata {
  rid: string;
  rcid: string;
  ctx: string | null;
}

export class ChatMetadataStorage {
  constructor(private readonly logger: Logger) {}

  load(profileName: string): Record<string, ChatMetadata>;
  lookup(profileName: string, cid: string): ChatMetadata | null;
  save(profileName: string, cid: string, metadata: ChatMetadata): void;
  delete(profileName: string, cid: string): void;
  listCids(profileName: string): string[];
}
```

`load()` is called once per profile at client construction time and feeds an in-memory `Map<profileName, Map<cid, ChatMetadata>>` populated lazily. `lookup()` consults the in-memory map first, falls back to a profile-scoped disk read, and hydrates the in-memory map. `save()` updates the in-memory map and writes through to disk via `infrastructure/io.ts`. Every disk write goes through `writeJsonFile` (path mediation rule).

The on-disk format:

```json
{
  "version": 1,
  "entries": {
    "<cid>": { "rid": "<rid>", "rcid": "<rcid>", "ctx": null }
  }
}
```

Pinned to `version: 1` so a future shape change can migrate explicitly. The file path is `<profileDir>/chat-metadata.json`, sibling to the existing `<profileDir>/storage_state.json`. A new helper `getProfileChatMetadataPath(profileName: string): string` in `infrastructure/path-utils.ts` returns the path; `ChatMetadataStorage` consumes the helper rather than recomputing it.

### D2. `GeminiClientService` holds the storage and the in-memory cache

```ts
// src/services/gemini-client-wrapper.ts (sketch — additions only)
export class GeminiClientService implements IGeminiClientService, IGeminiClientQueryService {
  // ... existing fields ...
  private chatMetadata: ChatMetadataStorage;
  private metadataCache = new Map<string /* profileName */, Map<string /* cid */, ChatMetadata>>();

  constructor(/* ... */, chatMetadata?: ChatMetadataStorage) {
    this.chatMetadata = chatMetadata ?? new ChatMetadataStorage(logger);
  }

  // ForProfile() now also creates a fresh wrapper instance per profile,
  // sharing the storage — see D3.
}
```

The `logger` is the existing instance passed at construction. The new `ChatMetadataStorage` constructor takes only `logger`; the new `getProfileChatMetadataPath` from `path-utils.ts` resolves all file paths.

### D3. `forProfile` clones with shared storage and per-instance cache

The existing `forProfile` at `src/services/gemini-client-wrapper.ts:188-200` already returns a new `GeminiClientService` per profile. The change is one line: pass the shared `ChatMetadataStorage` to the new instance:

```ts
forProfile(profileName: string): GeminiClientService {
  // ...
  return new GeminiClientService(
    { secure1psid: cookies.secure_1psid, secure1psidts: cookies.secure_1psidts },
    this.logger,
    this.cookieStorageService,
    profileName,
    this.deps,
    this.chatMetadata, // <-- shared across profile instances
  );
}
```

`forProfile` is called once per profile during command setup (`src/cli/index.ts`); the underlying storage is a single point of disk I/O.

### D4. Wire metadata restoration in `sendMessage`

```ts
async sendMessage(conversationId: string, message: string): Promise<string> {
  await this.init();
  if (!this.profileName) throw new Error("sendMessage called without a profile");
  const stored = this.chatMetadata.lookup(this.profileName, conversationId);

  let session;
  if (stored) {
    const metadata: (string | null)[] = [
      conversationId, stored.rid, stored.rcid, null, null, null, null, null, null,
      stored.ctx ?? "",
    ];
    session = this.client!.newChat({ metadata });
  } else {
    this.logger.debug(
      `sendMessage: no prior metadata for cid='${conversationId}' on profile='${this.profileName}'; falling back to cid-only send.`,
    );
    session = this.client!.newChat();
    session.cid = conversationId;
  }

  try {
    const output = await session.generateContent({ prompt: message });
    const captured = extractChatMetadata(output.metadata);
    if (captured) this.chatMetadata.save(this.profileName, conversationId, captured);
    this.persistRefreshedCookies();
    return output.text.toString();
  } catch (e) {
    // ... existing translateError / rethrow path ...
  }
}
```

`extractChatMetadata(metadata: (string | null)[] | undefined): ChatMetadata | null` is a small private helper that maps the gemini-reverse wire shape into our `ChatMetadata` interface. It returns `null` when the array is missing or when `rid`/`rcid` are both empty strings (no useful metadata to persist).

### D5. Wire metadata capture in `startNewChat`

```ts
async startNewChat(message: string): Promise<{ response: string; conversationId: string }> {
  await this.init();
  try {
    const session = this.client!.newChat();
    const output = await session.generateContent({ prompt: message });
    const response = output.text.toString();
    const conversationId = output.cid;
    if (this.profileName) {
      const captured = extractChatMetadata(output.metadata);
      if (captured) this.chatMetadata.save(this.profileName, conversationId, captured);
    }
    this.persistRefreshedCookies();
    return { response, conversationId };
  } catch (e) {
    // ... existing translateError / rethrow path ...
  }
}
```

Note that `startNewChat` does NOT have a known cid at construction time — the new cid is taken from the response. The metadata on the *new* session's first response is the authoritative source of `rid`/`rcid` for the conversation going forward.

### D6. Fallback path behavior

When `lookup` returns `null`:

- The wrapper falls back to `client.newChat() + session.cid = cid`.
- The debug log line documents the fallback (no user-visible output, no exception).
- If the user is in an interactive REPL and the first turn triggers the fallback, the *second* turn will succeed — because the second turn's response populates the cache via `save()`.

This guarantees the existing CLI behavior is preserved exactly when metadata is unavailable.

### D7. Wire-level regression test at the bug surface

A new test block in `tests/services/gemini-client-wrapper.test.ts` (added to the existing `describe("sendMessage")` block) exercises the full wrapper path through a session mock that follows `gemini-reverse`'s real `ChatSession` getter/setter semantics:

```ts
test("sendMessage restores chat.metadata from storage when prior metadata exists", async () => {
  // 1. Pre-populate the in-memory + on-disk cache with prior metadata
  // 2. Stub the gemini-reverse session to capture chat.metadata at generateContent time
  // 3. Assert that metadata[1] (rid) and metadata[2] (rcid) are non-empty,
  //    and match the values we pre-populated
});

test("sendMessage falls back to cid-only send when no prior metadata exists", async () => {
  // 1. Do NOT pre-populate the cache
  // 2. Stub the gemini-reverse session to capture chat.metadata
  // 3. Assert that metadata[1] and metadata[2] are empty strings
  //    (matching the existing behavior — preserves byte-equivalence for legacy cids)
});

test("sendMessage captures new rid/rcid into storage after a successful turn", async () => {
  // 1. Stub the gemini-reverse session to expose a server response with new rid/rcid
  // 2. After sendMessage, call ChatMetadataStorage.lookup and assert the saved
  //    rid/rcid match what the server returned
});
```

Three corresponding tests in `describe("startNewChat")`. Both blocks run through the same `installGeminiReverseMock` factory the file already uses; the only new code is the session mock with the explicit `get rid/set rid/get rcid/set rcid/get metadata/set metadata` accessors that mirror the real `ChatSession`.

### D8. New `ChatMetadataStorage` tests

A new file `tests/services/chat-metadata-storage.test.ts` covers:

- `save` then `lookup` round-trips `(rid, rcid, ctx)` per cid, per profile
- `lookup` returns `null` for unknown cid
- `lookup` for `profileA/cidX` does not return a value saved under `profileB/cidX`
- `load` returns the full record map for a profile
- `delete` removes the cid entry but leaves other entries intact
- Persistence works across simulated process restarts (in-memory cleared, disk read on demand): `save`, clear the in-memory map, `lookup` returns the same value after a disk read
- A corrupt `chat-metadata.json` (malformed JSON, missing `version`, wrong shape) is logged and treated as empty — never throws to the caller
- `save` is failure-isolated: an `IOError` from disk write is logged at debug level, the in-memory state is still updated, and the wrapper's `sendMessage` / `startNewChat` still resolves normally (matches the cookie-persistence failure-isolation rule from the 2.4.0-rc.2 fix)

### D9. Path mediation exemption update

`scripts/lint-path-mediation.sh`, `scripts/lint-path-mediation.ps1` (the `if` block at line ~30), and `.github/workflows/test.yml` each gain one line: `src/services/chat-metadata-storage.ts`. The accompanying comment names the reason (`consumes infrastructure/io.ts; no direct node:fs`), mirroring the existing `install-browser-service.ts` entry. Without this update, CI fails on the path-mediation gate.

## Risks / Trade-offs

- **[Risk]** The first `continue <legacy-cid>` after this change still falls into the cid-only fallback path (no prior metadata exists) — and thus still creates a new chat in *that* specific call. The fix takes effect from the second turn onward (which captures metadata). **Mitigation:** the proposal calls this out explicitly in the Non-goals section. The docs for the next minor release note "legacy cids created before 2.4.x need one fresh turn before `continue` resumes threading" so users aren't surprised.
- **[Risk]** `chat-metadata.json` could grow unbounded over months of heavy usage. **Mitigation:** one entry per cid per profile, max ~1 KB each. A profile that has created 1000 chats costs ~1 MB on disk. No mitigations are necessary at the current scale; document the size invariant and revisit if a profile exceeds 10k entries.
- **[Risk]** Concurrent writes from two `gemiterm` instances touching the same profile race on the JSON file. **Mitigation:** the same `CookieStorage.save` already has this property (single CLI process per profile in practice; the cookie file is also unprotected). Match the existing pattern; do not introduce a file lock.
- **[Risk]** The disk read on every cold `sendMessage` against an unknown cid (first call after profile load, every call against a legacy cid) adds network-equivalent latency. **Mitigation:** `chat-metadata.json` is small (tens of KB) and the read is amortized over the lookup. If the read becomes a hot path (unlikely; measurements can be added in a follow-up), we'd cache per-profile on first access.
- **[Risk]** A user with `chmod`-protected profile directories could break `chat-metadata.json` writes. **Mitigation:** same pattern as `CookieStorage` — log at debug, never throw, the operation still succeeds against the upstream API. This is non-recoverable for the affected `continue` call; documented behavior matches the cookie-persistence failure-isolation rule.
- **[Risk]** The proposed storage keyspace overlaps `cid` namespaces across profiles. **Mitigation:** keys are `${profileName}|${cid}` in the in-memory map; the on-disk file is per-profile, so the JSON only ever contains cids scoped to a single profile. There is no cross-profile leakage.

## Migration Plan

Additive. No schema change to existing profile directories beyond the new `chat-metadata.json` file (created on first save).

- **Backward compatibility** — every existing `gemiterm continue <cid> <msg>` invocation continues to work, even when no prior metadata exists. The fallback path matches the pre-change byte-level output.
- **Rollout** — single release. No flags are deprecated, no commands are renamed, no mediator contracts change.
- **Rollback** — revert the commit. `chat-metadata.json` files written by the new code are inert: without the new wrapper, the file is unread and harmless. No data migrations, no schema changes.
- **User-visible behavior change** — from the *second* turn of any chat created after this change, `gemiterm continue <cid> <msg>` (and the same-cid REPL second message) threads onto the existing chat. From the *first* turn onward, the REPL form (single process, multiple turns) threads correctly. Legacy cids (created before this change) require one extra turn to start threading.

## Open Questions

None at write time. The diagnostic test confirms the wire-level contract; the README of `gemini-reverse` confirms the upstream contract; the existing cookie-storage pattern confirms the storage-shape precedent.
