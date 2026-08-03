## Purpose

Server-side phantom-auth detection for `gemiterm`. Detects when Google invalidates a session server-side (cookies remain locally valid but the server no longer recognizes them) by probing the Gemini API. Owns the per-profile has-chats marker, probe cache, and the classification logic that distinguishes stale sessions from genuinely empty profiles.

## Requirements

### Requirement: ProfileAuthManager probes server-side session validity before declaring authenticated

When `ProfileAuthManager.ensureAuthenticated(profileName?)` is called and the
profile's local cookies pass `profileManager.hasValidCookies(name)` (i.e., the
cookie file is structurally valid AND `checkCookieFreshness(cookies)` returns
true), the method MUST consult a server-side probe before returning a
successful result. The probe MUST call `geminiClient.listChats({ limit: 1 })`
on a client scoped to the profile name. A process-level cache (default TTL
150_000 ms / 2.5 min, overridable via `GEMITERM_PROBE_TTL_MS` env var) MUST
memoize the probe result per profile.

The probe result classification MUST be:

- **Non-empty:** session is valid. Write the per-profile has-chats marker,
  cache "valid", return.
- **Empty + has-chats flag exists:** server-side session invalidation.
  Log a warning, cache "stale", trigger `autoExtendSession`.
- **Empty + has-chats flag absent:** genuinely empty profile (fresh auth,
  zero chats). Log debug, cache "ambiguous", trust local freshness.

On probe error (SDK throw, network failure), the method MUST log at debug
level and fall through to the "ambiguous" path (trust local freshness).

#### Scenario: Locally-valid cookies + server returns [] triggers silent refresh, not silent success

- **WHEN** `ensureAuthenticated("default")` is called and the default profile
  has locally-valid cookies (`hasValidCookies("default")` returns `true`)
- **AND** the server-side probe (`geminiClient.listChats({ limit: 1 })`)
  returns an empty array
- **AND** the per-profile has-chats marker exists on disk
- **THEN** the method MUST call `autoExtendSession("default")` (which in turn
  invokes `silentRefresh("default")`)
- **AND** the method MUST log a warning indicating the server-side session
  was detected as stale
- **AND** the returned `LoadedCookies` MUST reflect the refreshed values
  written to disk by `silentRefresh`, not the originally-loaded values
- **AND** `AuthenticationError` MUST NOT be thrown in this case

#### Scenario: listChats([]) followed by a failed silent refresh surfaces AuthenticationError

- **WHEN** `ensureAuthenticated("default")` is called and the default profile
  has locally-valid cookies
- **AND** the server-side probe returns an empty array
- **AND** the has-chats flag exists
- **AND** the injected `silentRefresh("default")` returns `false`
- **THEN** the method MUST throw `AuthenticationError` whose message
  contains `No valid session` and references `gemiterm login`
- **AND** the method MUST have called `silentRefresh("default")` exactly
  once

#### Scenario: listChats(non-empty) means session is valid; no silent refresh spent

- **WHEN** `ensureAuthenticated("default")` is called and the default profile
  has locally-valid cookies
- **AND** the server-side probe returns a non-empty array
- **THEN** the method MUST return `LoadedCookies` whose values match the
  stored cookies
- **AND** the method MUST log `Profile '<name>' is authenticated`
- **AND** `autoExtendSession` MUST NOT be called
- **AND** `silentRefresh` MUST NOT be called
- **AND** the per-profile has-chats marker MUST be written to disk
- **AND** the underlying `listChats` call MUST be made exactly once for
  subsequent calls within the TTL window (process-level cache)

#### Scenario: Probe budget -- repeat ensureAuthenticated within TTL reuses the cached result

- **WHEN** `ensureAuthenticated("default")` is called multiple times in
  rapid succession (e.g., 3 times within the same process)
- **AND** the local cookies are valid
- **THEN** the server-side probe (`geminiClient.listChats`) MUST be invoked
  at most once across the 3 calls (process-level memoization with TTL)
- **AND** every call MUST return the same `LoadedCookies`

#### Scenario: Genuinely empty profile (no has-chats flag) does not trigger recovery

- **WHEN** `ensureAuthenticated("default")` is called on a freshly
  authenticated profile with zero chats
- **AND** the server-side probe returns an empty array
- **AND** the per-profile has-chats marker does NOT exist on disk
- **THEN** the method MUST return `LoadedCookies` with the stored values
- **AND** the method MUST log at debug level indicating no server chat
  history was found
- **AND** `autoExtendSession` MUST NOT be called

#### Scenario: Probe error falls through to local freshness trust

- **WHEN** `ensureAuthenticated("default")` is called
- **AND** `geminiClient.listChats({ limit: 1 })` throws a `GeminiAPIError`
- **THEN** the method MUST return `LoadedCookies` with the stored values
- **AND** the method MUST log the probe failure at debug level
- **AND** `AuthenticationError` MUST NOT be thrown

### Requirement: Per-profile has-chats marker persists across process restarts

A per-profile `profile-has-chats` marker file MUST be stored at
`<profileDir>/profile-has-chats` (resolved via
`src/infrastructure/path-utils.ts:getProfileHasChatsPath`). The file MUST be
empty (zero bytes). Its existence indicates the profile has previously returned
at least one chat from a `listChats` call.

The marker MUST be written when a server-side probe (or any real `listChats`
response) returns a non-empty chat array for that profile. The marker MUST be
read via the existing `existsFile` helper from `src/infrastructure/io.ts`.

#### Scenario: Marker is created after non-empty probe

- **WHEN** `ensureAuthenticated("default")` runs a probe that returns
  `[{ id: "c1", ... }]`
- **THEN** the marker file at `<profileDir>/profile-has-chats` exists

#### Scenario: Marker absence indicates never-had-chats profile

- **WHEN** a profile has been freshly authenticated and no API calls have
  returned non-empty chat lists
- **THEN** `readProfileHasChats(profileName)` returns `false`

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
