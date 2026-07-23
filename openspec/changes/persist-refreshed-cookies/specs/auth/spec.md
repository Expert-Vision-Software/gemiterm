## ADDED Requirements

### Requirement: CookieStorageService persists refreshed session cookies
`CookieStorageService` SHALL expose a save operation for a profile's cookie
list, and `GeminiClientService` SHALL persist `__Secure-1PSID` and
`__Secure-1PSIDTS` values refreshed by the Gemini client's response-cookie
merging back to the active profile's stored cookies after successful API
operations. Persisted entries SHALL preserve their existing
domain/path/httpOnly/secure/sameSite metadata and have their `expires`
refreshed. Persistence SHALL be skipped when no profile is active on the
service instance, when the live values are unchanged since construction, or
when the client jar holds no value for a tracked cookie. Persistence failures
SHALL NOT fail the triggering operation.

#### Scenario: Refreshed value is persisted with metadata preserved
- **WHEN** the Gemini client's cookie jar contains a new `__Secure-1PSID`
  value after a successful operation on a profile-scoped
  `GeminiClientService`
- **THEN** the profile's stored cookie list is saved with the new value, the
  entry's original domain/path/httpOnly/secure/sameSite metadata intact, a
  refreshed `expires`, and a subsequent load returns the refreshed value

#### Scenario: No write when nothing changed
- **WHEN** the client jar's tracked cookie values equal the values the
  service instance was constructed with
- **THEN** no storage save is invoked after the operation completes

#### Scenario: Persistence skipped without an active profile
- **WHEN** a `GeminiClientService` instance has no `profileName` (for
  example the CLI's empty factory client)
- **THEN** persistence is skipped regardless of jar contents

#### Scenario: Persistence failure is isolated from the operation
- **WHEN** saving the refreshed cookies throws
- **THEN** the triggering API operation's result is returned normally and
  the failure is logged at debug level
