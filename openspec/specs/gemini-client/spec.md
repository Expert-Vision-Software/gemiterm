## Purpose

The Gemini API client wrapper internals — specifically the `ChatMetadataStorage` service that persists per-profile, per-conversation `rid`/`rcid`/`ctx` triples, and the wiring in `GeminiClientService` that captures metadata from upstream responses and restores it on conversation resume.

## Requirements

### Requirement: ChatMetadataStorage persists per-(profile, cid) chat metadata

A new `ChatMetadataStorage` class in `src/services/chat-metadata-storage.ts`
MUST persist per-profile, per-conversation chat metadata that the wrapper
needs to thread `sendMessage` onto existing conversations. The class MUST
expose:

- `load(profileName: string): Record<string, ChatMetadata>` — read the full
  per-profile file via `infrastructure/io.ts:readJsonFile`. A missing file
  MUST resolve to an empty record; a malformed file MUST be logged at debug
  level and treated as empty.
- `lookup(profileName: string, cid: string): ChatMetadata | null` — return
  the persisted metadata for `(profile, cid)`, hydrating an in-memory
  cache on first access. Returns `null` when no record exists.
- `save(profileName: string, cid: string, metadata: ChatMetadata): void`
  — update the in-memory cache and write through to disk via
  `infrastructure/io.ts:writeJsonFile`. Disk failures MUST be logged at
  debug level; the in-memory state MUST be updated regardless.
- `delete(profileName: string, cid: string): void` — remove a single
  entry; the rest of the record is preserved.
- `listCids(profileName: string): string[]` — return all known cids for a
  profile.

`ChatMetadata` is the narrow shape needed to thread a continuation:
`{ rid: string; rcid: string; ctx: string | null }`.

The on-disk file MUST be `<profileDir>/chat-metadata.json` resolved via a
new `infrastructure/path-utils.ts: getProfileChatMetadataPath(profileName)`
helper. The JSON shape MUST be `{ version: 1, entries: { [cid]: ChatMetadata } }`.

The class MUST NOT import `node:fs`, `node:path`, or `node:os` (the
path-mediation rule from `AGENTS.md`). All fs access MUST go through
`infrastructure/io.ts`.

#### Scenario: save then lookup round-trips per (profile, cid)
- **WHEN** `save("work", "conv-1", { rid: "r", rcid: "rc", ctx: null })`
  has resolved
- **THEN** `lookup("work", "conv-1")` resolves to
  `{ rid: "r", rcid: "rc", ctx: null }`
- **AND** `lookup("personal", "conv-1")` resolves to `null`
- **AND** `lookup("work", "conv-2")` resolves to `null`

#### Scenario: lookup after process restart hydrates from disk
- **WHEN** `save` has resolved and the in-memory cache has been cleared
  (simulating a process restart)
- **THEN** the next `lookup` for that `(profile, cid)` resolves to the
  same value via a disk read

#### Scenario: Corrupt chat-metadata.json is treated as empty
- **WHEN** the underlying file contains malformed JSON
- **THEN** `load` resolves to `{}` and logs the parse failure at debug
  level
- **AND** subsequent `save` calls rewrite the file in valid form

#### Scenario: save is failure-isolated from the wrapper's sendMessage call
- **WHEN** the underlying `writeJsonFile` throws an `IOError`
- **THEN** `save` logs the failure at debug level and resolves normally
  (the in-memory cache is still updated; the caller — the wrapper — does
  not see the error)

### Requirement: GeminiClientService uses ChatMetadataStorage to thread conversations

`GeminiClientService` MUST hold a `ChatMetadataStorage` instance (shared
across the profile-scoped and factory instances of the service via
`forProfile`). On every successful `startNewChat` call, the wrapper MUST
extract `rid`/`rcid`/`ctx` from the response's `output.metadata` and call
`storage.save(profileName, conversationId, ...)`. On every successful
`sendMessage` call, the wrapper MUST do the same, AND it MUST call
`storage.lookup` first to read prior metadata so the upstream request
threads onto the existing conversation. The fallback path
(`newChat() + session.cid = cid` with no metadata lookup) MUST remain
implemented for `(profile, cid)` pairs with no prior metadata, and the
fallback MUST log at debug level.

The wrapper's `metadataCache` is a `Map<profileName, Map<cid, ChatMetadata>>`
that is built lazily by `lookup` and updated by `save`; the cache lives
inside `GeminiClientService` and is process-local. Disk reads are limited
to first access after process start; subsequent reads in the same process
are served from the cache.

#### Scenario: sendMessage on the factory client bypasses the storage layer
- **WHEN** `sendMessage` is called on a `GeminiClientService` instance
  without a `profileName`
- **THEN** the storage layer is not consulted (no `lookup`, no `save`);
  the call falls through to the existing factory-client path

#### Scenario: forProfile shares storage across instances
- **WHEN** the CLI constructs one `GeminiClientService` per profile via
  `forProfile`
- **THEN** every profile-scoped instance holds a reference to the same
  `ChatMetadataStorage`
- **AND** `save` from one profile's instance is visible to `lookup` on
  the same profile's instance (and only that profile)
