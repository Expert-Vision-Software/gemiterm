## ADDED Requirements

### Requirement: GeminiClientService persists refreshed cookies through CookieSession

`GeminiClientService` MUST persist `__Secure-1PSID` and `__Secure-1PSIDTS` values refreshed by the Gemini client's response-cookie merging exclusively through `CookieSession.commit(profileName, liveJar)` — the single transactional persistence path. Persisted entries SHALL preserve their existing domain/path/httpOnly/secure/sameSite metadata and have their `expires` refreshed by the commit boundary. Persistence SHALL be skipped when no profile is active on the service instance or when the live values are unchanged since the last commit for that instance. Persistence failures SHALL NOT fail the triggering operation. The wrapper MUST NOT define its own freshness threshold constant, expiry computation, or merge-and-save logic.

#### Scenario: Refreshed value is persisted through the session boundary
- **WHEN** the Gemini client's cookie jar contains a new `__Secure-1PSID` value after a successful operation on a profile-scoped `GeminiClientService`
- **THEN** `CookieSession.commit` is invoked with the live jar and the profile name, and a subsequent load returns the refreshed value with the entry's original metadata intact and a refreshed `expires`

#### Scenario: No commit when nothing changed
- **WHEN** the client jar's tracked cookie values equal the values already committed for this service instance
- **THEN** no `commit` call and no storage write occurs after the operation completes

#### Scenario: Persistence skipped without an active profile
- **WHEN** a `GeminiClientService` instance has no `profileName` (for example the CLI's empty factory client)
- **THEN** persistence is skipped regardless of jar contents

#### Scenario: Persistence failure is isolated from the operation
- **WHEN** `CookieSession.commit` throws during a post-operation persist
- **THEN** the triggering API operation's result is returned normally and the failure is logged at debug level
