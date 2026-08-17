# Delta: multi-profile-conversations (fix-5-audit-remediations)

Truth-syncs the two profile-ownership routing requirements onto the `CookieSession` facade and the shared `resolveProfile` helper. Routing behavior, error contracts, and single-profile semantics are unchanged.

## MODIFIED Requirements

### Requirement: continue-command targets the profile that owns a conversation
The system MUST look up the profile that owns the conversation via the auth facade (`CookieSession.findProfileForConversation`, reached through the shared `resolveProfile` helper in `src/cli/utils/profile-resolution.ts`) before dispatching the continuation. The system MUST route the message to that profile's `GeminiClientService` instance. When no profile owns the conversation, the system MUST throw `AuthenticationError` with a remediation message and exit non-zero. In a single-profile setup (only the default profile is active), the behavior MUST be unchanged: the default profile is used without a lookup.

#### Scenario: Multi-profile continuation routes to the owning profile
- **WHEN** two profiles are active and profile `work` owns `<cid>`
- **THEN** `resolveProfile` returns `work` via `cookieSession.findProfileForConversation(<cid>)` and the continuation dispatches against `work`'s client

#### Scenario: Single-profile setup skips the lookup
- **WHEN** only the default profile is active
- **THEN** `resolveProfile` returns `null` without calling `findProfileForConversation` and the default profile is used

### Requirement: delete-command targets the profile that owns a conversation
The system MUST look up the profile that owns the conversation via the auth facade (`CookieSession.findProfileForConversation`, reached through the shared `resolveProfile` helper) before dispatching the delete. The system MUST route the delete to that profile's `GeminiClientService` instance. When no profile owns the conversation, the system MUST throw `AuthenticationError` with the same remediation message used by `continue` and exit non-zero. In a single-profile setup, the behavior MUST be unchanged.

#### Scenario: Multi-profile delete routes to the owning profile
- **WHEN** two profiles are active and profile `work` owns `<cid>`
- **THEN** the delete dispatches against `work`'s client resolved via the auth facade

#### Scenario: Explicit profile with no valid session fails with renewal hint
- **WHEN** `--profile stale` is passed and `stale` has no active session
- **THEN** `AuthenticationError` suggests `gemiterm auth --renew stale` and the delete does not run
