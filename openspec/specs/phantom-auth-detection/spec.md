## Purpose

Server-side phantom-auth detection for `gemiterm`. Detects when Google invalidates a session server-side (cookies remain locally valid but the server no longer recognizes them) by probing the Gemini API with the `models()` RPC. Owns the probe cache and classification logic that distinguishes valid sessions from stale ones.

## Requirements

### Requirement: ProfileAuthManager probes server-side session validity before declaring authenticated

When `ProfileAuthManager.ensureAuthenticated(profileName?)` is called and the profile's local cookies pass `profileManager.hasValidCookies(name)`, the method MUST consult a server-side probe before returning a successful result. The probe MUST call `geminiClient.models()` on a client scoped to the profile name. A process-level cache (default TTL 150_000 ms / 2.5 min, overridable via `GEMITERM_PROBE_TTL_MS` env var) MUST memoize the probe result per profile.

The probe result classification MUST be:

- **RPC succeeds:** session is valid. Cache "valid", log info, return `LoadedCookies`.
- **RPC throws:** server-side session invalidation. Log a warning, cache "stale", trigger `autoExtendSession`.

On probe error, the method MUST log at debug level and classify as "stale" (unlike the prior `listChats`-based probe which fell through to "ambiguous" — a failed RPC is definitive proof of session problems).

#### Scenario: models() succeeds — session valid, no refresh

- **WHEN** `ensureAuthenticated("default")` is called and the default profile has locally-valid cookies
- **AND** `geminiClient.models()` returns successfully
- **THEN** the method returns `LoadedCookies` with the stored values
- **AND** the method logs `Profile '<name>' is authenticated`
- **AND** `silentRefresh` is NOT called
- **AND** `AuthenticationError` is NOT thrown

#### Scenario: models() throws — session stale, triggers silent refresh

- **WHEN** `ensureAuthenticated("default")` is called and the default profile has locally-valid cookies
- **AND** `geminiClient.models()` throws
- **AND** `silentRefresh("default")` returns `true`
- **THEN** the method returns `LoadedCookies` reflecting the refreshed values
- **AND** `silentRefresh` was called exactly once

#### Scenario: models() throws + silent refresh fails — AuthenticationError

- **WHEN** `ensureAuthenticated("default")` is called and the default profile has locally-valid cookies
- **AND** `geminiClient.models()` throws
- **AND** `silentRefresh("default")` returns `false`
- **THEN** the method throws `AuthenticationError` whose message contains `No valid session` and references `gemiterm login`

#### Scenario: Probe budget — repeat ensureAuthenticated within TTL reuses cached result

- **WHEN** `ensureAuthenticated("default")` is called multiple times in rapid succession (e.g., 3 times)
- **AND** the local cookies are valid
- **THEN** `geminiClient.models()` is invoked at most once across the 3 calls
- **AND** every call returns the same `LoadedCookies`

#### Scenario: Profile with no valid cookies does not probe

- **WHEN** `ensureAuthenticated("default")` is called
- **AND** `profileManager.hasValidCookies("default")` returns `false`
- **THEN** `geminiClient.models()` is NOT called
- **AND** `autoExtendSession` is attempted instead

### Requirement: Probe cache TTL is configurable via environment variable

The probe cache TTL MUST default to 150_000 ms (2.5 minutes). The value MUST
be overridable via the `GEMITERM_PROBE_TTL_MS` environment variable. When
the env var is set to a value that parses as a positive integer, that value
(in milliseconds) MUST be used as the TTL. Invalid or non-positive values
MUST fall back to the default.

#### Scenario: Default TTL is 2.5 minutes

- **WHEN** `GEMITERM_PROBE_TTL_MS` is not set
- **THEN** the probe cache TTL is 150_000 ms

#### Scenario: TTL override via env var

- **WHEN** `GEMITERM_PROBE_TTL_MS` is set to `"60000"`
- **THEN** the probe cache TTL is 60_000 ms
