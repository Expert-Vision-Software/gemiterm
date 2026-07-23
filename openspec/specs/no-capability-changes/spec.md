# no-capability-changes Specification

## Purpose
TBD - created by archiving change upgrade-gemini-reverse-2-1-0. Update Purpose after archive.
## Requirements
### Requirement: This change introduces no new requirements
This change upgrades the npm `gemini-reverse` dependency from `~1.0.12` to
exactly `2.1.0` and rewrites the internals of the single integration point
(`src/services/gemini-client-wrapper.ts`) onto the 2.1.0 API. The public
contracts — `IGeminiClientService`, `IGeminiClientQueryService`, and the
`GeminiClientService` class signature — SHALL be preserved bit-identical. No
new user-visible capability is added, and no existing requirement in
`openspec/specs/conversations/spec.md`,
`openspec/specs/multi-profile-conversations/spec.md`,
`openspec/specs/commands/`, or `openspec/specs/auth/spec.md` is modified. All
other capabilities in `openspec/specs/` are likewise unaffected.

#### Scenario: Public contract preserved
- **WHEN** a caller imports `GeminiClientService`,
  `IGeminiClientService`, or `IGeminiClientQueryService` and uses the
  existing methods (`listChats`, `fetchChat`, `sendMessage`, `startNewChat`,
  `deleteChat`, `listModels`, `forProfile`, `profileHasConversation`)
- **THEN** signatures, return types, and thrown error types are identical to
  the pre-change implementation; the 11 CLI commands, the
  `ProfileAuthManager`, and all command/query handlers compile and run
  without source edits

#### Scenario: Per-profile sessions preserved
- **WHEN** a caller invokes `geminiClient.forProfile("work")` and then
  `listChats()` on the returned instance
- **THEN** the `ChatInfo[]` results are scoped to the "work" profile's
  Google account and carry `profile: "work"` on each entry, matching the
  pre-change behavior

#### Scenario: Domain mapping preserved across renamed upstream fields
- **WHEN** the upstream 2.1.0 client returns chat rows shaped
  `{ cid, title, pinned, timestamp }` from `chats()` and turn arrays shaped
  `[{ role, text, ... }]` from `readChat(cid)`
- **THEN** `listChats()` still yields domain `ChatInfo` entries with
  `id`, `title`, `isPinned`, and millisecond `timestamp`, and `fetchChat()`
  still yields `Message[]` with `role` narrowed to `"user" | "model"`,
  matching the pre-change domain output

#### Scenario: Error contract preserved
- **WHEN** the upstream 2.1.0 client throws `AuthError`,
  `UsageLimitExceeded`, `ModelInvalid`, `TemporarilyBlocked`, `APIError`,
  `GeminiError`, or an axios-style timeout error (`ECONNABORTED` or a
  stalled/timed-out stream error)
- **THEN** the wrapper translates them to the same
  `AuthenticationError`/`GeminiAPIError` instances with the same messages as
  the pre-change implementation, including "Request to Gemini timed out" for
  timeout shapes formerly covered by the removed upstream `TimeoutError`

