## ADDED Requirements

### Requirement: This change introduces no new requirements
This change is a pure implementation swap of the in-tree Gemini HTTP client
(`src/services/gemini-client-wrapper.ts`) for the npm `gemini-reverse`
library. The public contracts — `IGeminiClientService`,
`IGeminiClientQueryService`, and the `GeminiClientService` class signature —
are preserved bit-identical. No new user-visible capability is added, and no
existing requirement in `openspec/specs/conversations/spec.md`,
`openspec/specs/multi-profile-conversations/spec.md`, `openspec/specs/commands/`,
or `openspec/specs/auth/spec.md` is modified. All other capabilities in
`openspec/specs/` are likewise unaffected.

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
  existing behavior of the placeholder
