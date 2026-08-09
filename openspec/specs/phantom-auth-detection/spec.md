## Purpose

Server-side phantom-auth detection for `gemiterm`. Detects when Google invalidates a session server-side (cookies remain locally valid but the server no longer recognizes them) by probing the Gemini API with the `models()` RPC. Owns the probe cache and classification logic that distinguishes valid sessions from stale ones.
## Requirements
### Requirement: ProfileAuthManager probes server-side session validity before declaring authenticated

When `ProfileAuthManager.ensureAuthenticated(profileName?)` is called and the profile's local cookies pass `profileManager.hasValidCookies(name)`, the method MUST consult a server-side probe before returning a successful result, AND it MUST attempt a cookie rotation via the injected `rotateCookies(name)` (the L1 `RotateCookies` POST) regardless of the probe outcome. The probe MUST call `geminiClient.models()` on a client scoped to the profile name. A process-level cache (default TTL 150_000 ms / 2.5 min, overridable via `GEMITERM_PROBE_TTL_MS` env var) MUST memoize the probe result per profile. The rotation is throttled by the 600 s disk-mtime guard inside `rotateCookies`, so an actual `RotateCookies` POST happens at most once per 600 s per profile; sub-threshold calls return early without network I/O.

The two recovery functions have distinct roles:

- `rotateCookies` (L1 POST only) — cheap, guarded, no browser. Used on the **probe-success** path for proactive `__Secure-1PSIDTS` freshness. Best-effort: a rotation failure (network error, non-200, or guard skip) MUST NOT throw.
- `silentRefresh` (L1 POST, then L2 headless browser) — used on the **probe-stale** path (`models()` threw), where the session is genuinely dead and may need the browser fallback.

The probe result classification MUST be:

- **RPC succeeds:** the session is usable for PSID-only calls, but a stale `__Secure-1PSIDTS` cannot be ruled out, so the method MUST call `rotateCookies(name)` to refresh the token. A rotation failure MUST NOT throw. After rotation, the method proceeds to the rotation-result handling described below. Log info, return `LoadedCookies` if the session is valid.
- **RPC throws:** server-side session invalidation. Log a warning, classify as "stale", call `silentRefresh(name)`. If `silentRefresh` returns `true`, return the refreshed `LoadedCookies`. If `silentRefresh` returns `false`, throw `AuthenticationError`.

On probe error, the method MUST log at debug level and classify as "stale".

**Rotation result handling (after probe success):**

- **`rotation.rotated === true`:** Fresh `__Secure-1PSIDTS` obtained. Session is fully usable. Return `LoadedCookies`.
- **`rotation.attempted === true` or `rotation.sessionInvalid === true`:** L1 reached Google but either the server declined to issue fresh PSIDTS (HTTP 200, no fresh PSIDTS in response) or the server rejected the request (401/403). In both cases, the session MAY still be usable via the Gemini API directly (RotateCookies is an `accounts.google.com` endpoint with different session validation behavior than the Gemini API). The method MUST run phantom-auth detection (`detectPhantomAuth`) — a `listChats({ limit: 1 })` call — to determine whether the session is functional. If phantom is detected (listChats returns empty), the method MUST attempt targeted L2 silent refresh (`silentRefresh(name, { mode: "targeted" })`). If targeted L2 fails, throw `AuthenticationError`. If phantom is NOT detected, the session is functional; log and return `LoadedCookies`.
- **Otherwise (`rotation.attempted === false` and `rotation.sessionInvalid` is falsy):** L1 was throttled, disabled, or unavailable. Cookies are likely still fresh. Log at debug level and return `LoadedCookies`.

#### Scenario: models() succeeds — L1 rotation returns 401, phantom detected, targeted L2 recovers

- **WHEN** `ensureAuthenticated("default")` is called and the default profile has locally-valid cookies
- **AND** `geminiClient.models()` returns successfully
- **AND** `rotateCookies("default")` returns `{ rotated: false, attempted: false, sessionInvalid: true }`
- **AND** `detectPhantomAuth("default")` returns `true`
- **AND** `silentRefresh("default", { mode: "targeted" })` returns `true`
- **THEN** the method returns `LoadedCookies` with refreshed values
- **AND** `AuthenticationError` is NOT thrown
- **AND** `silentRefresh` was called with `mode: "targeted"`

#### Scenario: models() succeeds — L1 rotation returns 401, phantom not detected, session still valid

- **WHEN** `ensureAuthenticated("default")` is called and the default profile has locally-valid cookies
- **AND** `geminiClient.models()` returns successfully
- **AND** `rotateCookies("default")` returns `{ rotated: false, attempted: false, sessionInvalid: true }`
- **AND** `detectPhantomAuth("default")` returns `false` (listChats returns ≥1 chat)
- **THEN** the method returns `LoadedCookies` with the stored values
- **AND** `AuthenticationError` is NOT thrown
- **AND** `silentRefresh` is NOT called

#### Scenario: models() succeeds — L1 rotation still attempted (stale 1PSIDTS detection)

- **WHEN** `ensureAuthenticated("default")` is called and the default profile has locally-valid cookies
- **AND** `geminiClient.models()` returns successfully
- **AND** `rotateCookies("default")` returns `{ rotated: true, attempted: true }` or `{ rotated: false, attempted: true }`
- **THEN** the method returns `LoadedCookies` with the stored values
- **AND** `silentRefresh` is NOT called on this path (L1 only; no browser)
- **AND** a rotation failure does NOT cause `AuthenticationError` to be thrown

#### Scenario: models() throws — session stale, triggers silent refresh ladder

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
- **AND** the 600 s disk-mtime guard inside `rotateCookies` prevents more than one actual `RotateCookies` POST within the window

#### Scenario: Profile with no valid cookies does not probe or rotate

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

