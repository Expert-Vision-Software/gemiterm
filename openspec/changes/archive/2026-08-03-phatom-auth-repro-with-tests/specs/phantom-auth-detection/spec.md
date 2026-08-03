## ADDED Requirements

### Requirement: ProfileAuthManager probes server-side session validity before declaring authenticated

When `ProfileAuthManager.ensureAuthenticated(profileName?)` is called and the
profile's local cookies pass `profileManager.hasValidCookies(name)` (i.e., the
cookie file is structurally valid AND the freshness check
`checkCookieFreshness(cookies)` returns true), the method MUST consult a
server-side probe before returning a successful result. The probe MUST call
`geminiClient.listChats({ limit: 1 })` (or an equivalent lightweight API call
that exercises the session). An empty probe result MUST be classified as a
server-side session invalidation and MUST trigger the same auto-extend /
silent-refresh path that the 1-hour freshness grace window uses today. A
process-level cache (TTL, configurable; default 5 minutes) MUST memoize the
probe result so the additional round-trip is not paid on every command
invocation.

The contract below is the **regression contract** for the phantom-auth bug.
Each scenario is implemented as a failing test in
`tests/services/phantom-auth.test.ts` and goes red on the pre-fix code and
green once the sibling `phantom-auth-ultimate-fix` change lands.

#### Scenario: Locally-valid cookies + server returns [] triggers silent refresh, not silent success

- **WHEN** `ensureAuthenticated("default")` is called and the default profile
  has locally-valid cookies (`hasValidCookies("default")` returns `true`)
- **AND** the server-side probe (`geminiClient.listChats({ limit: 1 })`)
  returns an empty array
- **THEN** the method MUST call `autoExtendSession("default")` (which in turn
  invokes `silentRefresh("default")`)
- **AND** the method MUST log a warning indicating the server-side session
  was detected as stale (e.g., `Server-side session for 'default' appears
  stale; forcing refresh`)
- **AND** the returned `LoadedCookies` MUST reflect the refreshed values
  written to disk by `silentRefresh`, not the originally-loaded values
- **AND** `AuthenticationError` MUST NOT be thrown in this case
  (the silent refresh is the expected recovery path; only a *failed* silent
  refresh surfaces an error — see Scenario 2)

#### Scenario: listChats([]) followed by a failed silent refresh surfaces AuthenticationError

- **WHEN** `ensureAuthenticated("default")` is called and the default profile
  has locally-valid cookies
- **AND** the server-side probe returns an empty array
- **AND** the injected `silentRefresh("default")` returns `false` (silent
  refresh failed — Google's auth UI appeared instead of the app, or the
  monitor timed out)
- **THEN** the method MUST throw `AuthenticationError` whose message
  contains the substring `No valid session` and references `gemiterm login`
- **AND** the method MUST have called `silentRefresh("default")` exactly
  once (verified by a mock spy)
- **AND** `AuthenticationError` MUST be rethrown by the existing reauth
  prompt layer in `src/cli/index.ts:91-96` when the user declines the
  reauth confirm

#### Scenario: listChats(non-empty) means session is valid; no silent refresh spent

- **WHEN** `ensureAuthenticated("default")` is called and the default profile
  has locally-valid cookies
- **AND** the server-side probe (`geminiClient.listChats({ limit: 1 })`)
  returns a non-empty array (e.g., `[{ id: "c1", title: "t", ... }]`)
- **THEN** the method MUST return `LoadedCookies` whose values match the
  stored cookies
- **AND** the method MUST log `Profile 'default' is authenticated`
- **AND** `autoExtendSession` MUST NOT be called
- **AND** `silentRefresh` MUST NOT be called
- **AND** the underlying `listChats` call MUST be made exactly once per
  process per profile (process-level cache with TTL ≥ 5 minutes; see
  Open Question A)

#### Scenario: Probe budget — repeat ensureAuthenticated within TTL reuses the cached result

- **WHEN** `ensureAuthenticated("default")` is called multiple times in
  rapid succession (e.g., 3 times within the same process)
- **AND** the local cookies are valid
- **THEN** the server-side probe (`geminiClient.listChats`) MUST be invoked
  at most once across the 3 calls (process-level memoization with TTL)
- **AND** every call MUST return the same `LoadedCookies`
- **AND** every call MUST log `Profile 'default' is authenticated`

### Requirement: GeminiClientService.persistRefreshedCookies merges by (name, domain)

`GeminiClientService.persistRefreshedCookies` MUST match stored cookies by
both `name` AND `domain` when deciding which entries to overwrite with the
SDK's in-memory value. The current implementation matches by `name` only,
which causes silent overwrites when the storage file contains duplicate
cookie names across domains (the user's `evs-diegohb` profile has both
`.youtube.com` and `.google.com` pairs for `__Secure-1PSID` /
`__Secure-1PSIDTS`).

#### Scenario: SDK rotation overwrites only the matching domain entry

- **WHEN** the profile's storage contains two `__Secure-1PSID` cookies — one
  scoped to `.youtube.com` (value `yt-psid`) and one scoped to `.google.com`
  (value `g-psid`)
- **AND** the SDK jar contains a new `__Secure-1PSID` value `NEW-g-psid`
  whose only scope is `.google.com`
- **AND** `persistRefreshedCookies` is called
- **THEN** the `.google.com` `__Secure-1PSID` entry's value MUST become
  `NEW-g-psid`
- **AND** the `.youtube.com` `__Secure-1PSID` entry's value MUST remain
  `yt-psid` (unchanged)
- **AND** the file's other cookies MUST be preserved (other domain/path/httpOnly
  /secure/sameSite metadata, expires field)

### Requirement: Silent refresh is not a no-op

`AuthService.silentRefresh(profileName)` MUST NOT return `true` simply
because the loaded cookies are still locally valid. The monitor's success
condition MUST distinguish "cookies returned by `cookieListFromState` are
byte-identical to what was loaded" from "cookies have actually been
refreshed by Google". When the loaded cookies are still valid and Google
does not rotate them within the timeout window, the silent refresh MUST
fail and the caller MUST fall through to the reauth prompt.

#### Scenario: Loaded cookies still valid; silent refresh fails

- **WHEN** `silentRefresh("default")` is called
- **AND** the loaded cookies are locally valid
- **AND** Google's auth UI does NOT appear within the 30-second timeout
  (because the loaded cookies are good enough to render the logged-in
  page, but Google does not rotate `__Secure-1PSIDTS` during a passive
  page load)
- **THEN** the method MUST return `false` after the timeout (NOT `true`
  with the same cookies re-saved to disk)
- **AND** `autoExtendSession` MUST propagate the `false` to
  `ensureAuthenticated`, which MUST throw `AuthenticationError` /
  trigger the reauth prompt