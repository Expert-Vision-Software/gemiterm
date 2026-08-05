## MODIFIED Requirements

### Requirement: ProfileAuthManager probes server-side session validity before declaring authenticated

When `ProfileAuthManager.ensureAuthenticated(profileName?)` is called and the profile's local cookies pass `profileManager.hasValidCookies(name)`, the method MUST consult a server-side probe before returning a successful result, AND it MUST attempt a cookie rotation via `silentRefresh(name)` regardless of the probe outcome. The probe MUST call `geminiClient.models()` on a client scoped to the profile name. A process-level cache (default TTL 150_000 ms / 2.5 min, overridable via `GEMITERM_PROBE_TTL_MS` env var) MUST memoize the probe result per profile. The rotation is throttled independently by the 600 s disk-mtime guard inside `silentRefresh`/`rotateCookies`, so `silentRefresh` is invoked on every valid-cookie `ensureAuthenticated` call but performs an actual `RotateCookies` POST at most once per 600 s per profile.

The probe result classification MUST be:

- **RPC succeeds:** the session is usable for PSID-only calls, but a stale `__Secure-1PSIDTS` cannot be ruled out, so the method MUST still call `silentRefresh(name)` to refresh the token. The rotation is best-effort: a rotation failure (network error or guard skip) MUST NOT throw. Log info, return `LoadedCookies`.
- **RPC throws:** server-side session invalidation. Log a warning, classify as "stale", call `silentRefresh(name)`. If `silentRefresh` returns `true`, return the refreshed `LoadedCookies`. If `silentRefresh` returns `false`, throw `AuthenticationError`.

On probe error, the method MUST log at debug level and classify as "stale".

#### Scenario: models() succeeds — rotation still attempted (stale 1PSIDTS detection)

- **WHEN** `ensureAuthenticated("default")` is called and the default profile has locally-valid cookies
- **AND** `geminiClient.models()` returns successfully
- **THEN** the method returns `LoadedCookies` with the stored values
- **AND** `silentRefresh("default")` IS called (to refresh a possibly-stale `__Secure-1PSIDTS`)
- **AND** a rotation failure does NOT cause `AuthenticationError` to be thrown

#### Scenario: models() throws — session stale, triggers silent refresh

- **WHEN** `ensureAuthenticated("default")` is called and the default profile has locally-valid cookies
- **AND** `geminiClient.models()` throws
- **AND** `silentRefresh("default")` returns `true`
- **THEN** the method returns `LoadedCookies` reflecting the refreshed values
- **AND** `silentRefresh` was called

#### Scenario: models() throws + silent refresh fails — AuthenticationError

- **WHEN** `ensureAuthenticated("default")` is called and the default profile has locally-valid cookies
- **AND** `geminiClient.models()` throws
- **AND** `silentRefresh("default")` returns `false`
- **THEN** the method throws `AuthenticationError` whose message contains `No valid session` and references `gemiterm login`

#### Scenario: Probe budget — repeat ensureAuthenticated within TTL reuses cached probe result

- **WHEN** `ensureAuthenticated("default")` is called multiple times in rapid succession (e.g., 3 times)
- **AND** the local cookies are valid
- **THEN** `geminiClient.models()` is invoked at most once across the 3 calls (probe cache)
- **AND** every call returns the same `LoadedCookies`
- **AND** the 600 s disk-mtime guard inside `silentRefresh` prevents more than one actual `RotateCookies` POST within the window

#### Scenario: Profile with no valid cookies does not probe or rotate

- **WHEN** `ensureAuthenticated("default")` is called
- **AND** `profileManager.hasValidCookies("default")` returns `false`
- **THEN** `geminiClient.models()` is NOT called
- **AND** `autoExtendSession` is attempted instead
