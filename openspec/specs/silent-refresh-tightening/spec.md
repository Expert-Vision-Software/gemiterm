## Purpose

Silent session refresh tightening for `gemiterm`. Introduces L1 cookie rotation via Google's RotateCookies endpoint and tightens the L2 headless browser fallback to require actual cookie rotation (not just byte-identical re-persistence). Prevents the silent-refresh no-op that allowed phantom-auth to go undetected.

## Requirements

### Requirement: Cookie rotation via accounts.google.com/RotateCookies (L1)

The system MUST provide a `rotateCookies(profileName: string): Promise<boolean>`
function in `src/services/cookie-rotation.ts` that refreshes the
`__Secure-1PSIDTS` session cookie by POSTing to Google's identity rotation
endpoint. The function MUST:

1. Load the full cookie jar for the profile via `CookieStorageService.loadAllCookiesForProfile`.
2. Filter cookies to `.google.com` domain entries (the rotation endpoint
   operates on Google identity cookies scoped to the `.google.com` parent domain).
3. Build a `Cookie` header string from the filtered cookies.
4. POST the body `[000,"-0000000000000000000"]` (JSON array with sentinel for
   "no prior PSIDTS") to `https://accounts.google.com/RotateCookies` with
   headers `Content-Type: application/json` and `Origin: https://accounts.google.com`.
5. On a 200 response: parse `set-cookie` headers for `__Secure-1PSIDTS`,
   `__Secure-3PSIDTS`, and `SIDCC`. Compare the new `__Secure-1PSIDTS` value
   against the stored value. If different, merge into stored cookies, save via
   `saveCookiesForProfile`, and return `true`. If identical, return `false`.
6. On any non-200 response or network error: return `false`.

The function MUST be rate-limited by two guards:
- **Disk-mtime guard:** skip rotation if `storage_state.json` was last modified
  within the last 600 seconds (Google's recommended rotation interval).
- **In-process throttle:** deduplicate concurrent calls for the same profile
  using a module-level `Map<string, Promise<boolean>>` in-flight tracker.

The function MUST be skippable via the `GEMITERM_SKIP_ROTATE_COOKIES`
environment variable (any truthy value disables L1; falls through to L2).

#### Scenario: RotateCookies succeeds with fresh PSIDTS

- **WHEN** `rotateCookies("default")` is called
- **AND** the profile's stored cookies include valid `__Secure-1PSID` and
  `__Secure-1PSIDTS` scoped to `.google.com`
- **AND** the RotateCookies endpoint returns 200 with a `Set-Cookie` header
  containing a new `__Secure-1PSIDTS` value different from the stored one
- **THEN** the function returns `true`
- **AND** the stored `__Secure-1PSIDTS` value is updated to the new value
- **AND** other cookie metadata (domain, path, httpOnly, secure, sameSite) is
  preserved

#### Scenario: RotateCookies returns 401 (session fully dead)

- **WHEN** `rotateCookies("default")` is called
- **AND** the RotateCookies endpoint returns HTTP 401
- **THEN** the function returns `false`
- **AND** no cookie writes occur

#### Scenario: RotateCookies returns same PSIDTS (no rotation needed)

- **WHEN** `rotateCookies("default")` is called
- **AND** the endpoint returns 200 but the `__Secure-1PSIDTS` value is
  identical to the stored value
- **THEN** the function returns `false`
- **AND** no cookie writes occur

#### Scenario: RotateCookies is skipped when GEMITERM_SKIP_ROTATE_COOKIES is set

- **WHEN** `GEMITERM_SKIP_ROTATE_COOKIES=1` is set
- **AND** `rotateCookies("default")` is called
- **THEN** the function returns `false` without making any HTTP request

#### Scenario: Disk-mtime guard prevents rotation within 600 seconds

- **WHEN** `rotateCookies("default")` is called
- **AND** `storage_state.json` was last modified less than 600 seconds ago
- **THEN** the function returns `false` without making an HTTP request

#### Scenario: In-process throttle deduplicates concurrent calls

- **WHEN** two concurrent `rotateCookies("default")` calls are made
- **THEN** only one HTTP request is sent
- **AND** both calls return the same result

### Requirement: AuthService.silentRefresh uses multi-layer recovery ladder

The `AuthService.silentRefresh(profileName)` method MUST attempt session
recovery in a ladder, escalating from the cheapest mechanism to the heaviest:

1. **L1:** Call `rotateCookies(name)`. If it returns `true`, return `true`.
2. **L2 (fallback):** Launch headless browser via
   `PlaywrightCliDriver.openHeadless`, load cookies via `stateLoad`, start
   `CookieMonitor` with `requireRotation` set to the snapshot of active cookie
   values. If the monitor fires with different values, save via `extractCookies`
   and return `true`. If the monitor times out or cookies are identical, return
   `false`.
3. The caller (`ProfileAuthManager.autoExtendSession`) receives the boolean
   result; a `false` from `silentRefresh` propagates to
   `ensureAuthenticated`, which throws `AuthenticationError` triggering L3
   (interactive reauth prompt).

The method MUST NOT produce console output (silent operation). The method MUST
still close the browser session in a `finally` block when L2 is reached.

#### Scenario: L1 RotateCookies succeeds, no browser launched

- **WHEN** `silentRefresh("default")` is called
- **AND** `rotateCookies("default")` returns `true`
- **THEN** `silentRefresh` returns `true`
- **AND** no browser is launched (no `openHeadless` call)

#### Scenario: L1 fails, L2 headless browser succeeds

- **WHEN** `silentRefresh("default")` is called
- **AND** `rotateCookies("default")` returns `false` (network error or 401)
- **AND** the headless browser flow detects rotated cookies within 30s
- **THEN** `silentRefresh` returns `true`
- **AND** the browser session is closed

#### Scenario: Both L1 and L2 fail

- **WHEN** `silentRefresh("default")` is called
- **AND** `rotateCookies("default")` returns `false`
- **AND** the headless browser times out without rotation
- **THEN** `silentRefresh` returns `false`
