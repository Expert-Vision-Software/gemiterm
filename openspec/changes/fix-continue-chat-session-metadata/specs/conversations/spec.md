## MODIFIED Requirements

### Requirement: GeminiClientService.sendMessage restores chat metadata for thread continuity

The `sendMessage(conversationId, message)` method MUST thread the
`SendMessageCommand` onto the named conversation rather than creating a new
one. To do so it MUST look up per-profile persisted chat metadata for
`conversationId` and, when found, construct the underlying
`gemini-reverse` `ChatSession` via `client.newChat({ metadata })` with the
persisted metadata's `rid`, `rcid`, and `ctx` slots restored; the
`gemini-reverse` README documents the wire contract (`[cid, rid, rcid, ...]`
uniquely identifies the conversation turn, and storing and restoring the
metadata is what allows `continue` to resume the exact conversation context).

When no persisted metadata exists for `(profile, conversationId)`, the
method MUST fall back to the existing `newChat() + session.cid = cid` path
and log the fallback at debug level; the call still resolves normally and
the response text is still returned. The fallback preserves byte-level
equivalence with the pre-fix behavior for any cid whose first metadata
write has not yet happened (legacy chats and the first turn of any new
chat).

After every successful `sendMessage` call, the method MUST extract the
returned `output.metadata` array and persist `rid`, `rcid`, and `ctx` (slot
9) under the key `(profileName, conversationId)` so the next turn of the
same conversation threads without a re-fetch. The extraction step MUST be
failure-isolated: a malformed or empty metadata array MUST NOT cause the
user's `sendMessage` call to throw; the persistence call's own failures
MUST also be isolated (logged at debug level, in-memory cache updated
regardless).

#### Scenario: sendMessage with persisted metadata threads onto the existing conversation
- **WHEN** `sendMessage("conv-xyz", "msg")` is called on a profile whose
  persisted metadata for `conv-xyz` is `{ rid: "rid-1", rcid: "rcid-1", ctx: null }`
- **THEN** the request body the wrapper sends to the upstream
  `StreamGenerate` endpoint carries `chat.metadata = ["conv-xyz", "rid-1", "rcid-1", null, null, null, null, null, null, ""]`
- **AND** the model response references the conversation's prior turns

#### Scenario: sendMessage with no persisted metadata falls back to cid-only
- **WHEN** `sendMessage("conv-legacy", "msg")` is called on a profile
  whose persisted-metadata store has no entry for `conv-legacy`
- **THEN** the wrapper logs at debug level naming the profile and the cid
- **AND** the request body the wrapper sends to upstream carries
  `chat.metadata = ["conv-legacy", "", "", null, null, null, null, null, null, ""]`
- **AND** `sendMessage` resolves normally with the response text
- **AND** the byte-level output to the user matches the pre-fix behavior

#### Scenario: sendMessage captures new rid/rcid into the persisted store
- **WHEN** `sendMessage("conv-xyz", "msg")` returns successfully and the
  upstream response's `metadata` array is
  `["conv-xyz", "rid-new", "rcid-new", null, null, null, null, null, null, ""]`
- **THEN** the persisted store for `(profile, "conv-xyz")` is updated to
  `{ rid: "rid-new", rcid: "rcid-new", ctx: null }`
- **AND** a subsequent `sendMessage("conv-xyz", "next")` on the same
  process reads the updated store and threads with `rid-new` / `rcid-new`

#### Scenario: Persistence is skipped on the factory-client path
- **WHEN** `sendMessage` is called on a `GeminiClientService` instance
  constructed without a `profileName` (the CLI factory instance used when
  no profile lookup happened)
- **THEN** the persistence call is skipped (no write, no `lookup`)

#### Scenario: Persistence failure does not fail the send
- **WHEN** the underlying `chat-metadata.json` write throws an `IOError`
- **THEN** `sendMessage` resolves normally with the response text
- **AND** the failure is logged at debug level
