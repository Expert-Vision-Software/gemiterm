## Purpose

The interactive authentication capability for `gemiterm`. It owns the end-to-end login flow (launching a headed Chromium via `playwright-cli`, polling a running browser session for Google's sign-out indicator, capturing the `__Secure-1PSID` and `__Secure-1PSIDTS` cookies, persisting them to the profile storage, and closing the browser). It also owns the multi-profile management CLI surface (`auth` command) and the `playwright-cli` driver abstraction that auto-detects the local install (direct binary or `bunx @playwright/cli`).
## Requirements
### Requirement: AuthService.authenticate orchestrates the full login flow
The `AuthService.authenticate(profileName?)` method MUST be the single entry point for the login flow. When called, it MUST resolve the profile name (using the provided name, or the configured default), validate it, log an info-level "Starting authentication" message, and then in order: print a one-shot headed-browser notification, launch the browser via `PlaywrightCliDriver.openHeaded("https://gemini.google.com/app", profileName, profileName)`, wait up to 300000 ms (5 minutes) for the cookie monitor to report auth cookies, save the captured cookies via the cookie storage, compute the session expiry from `__Secure-1PSIDTS.expires`, and print a confirmation message containing the cookie count and the expiration date (when known). The browser session MUST always be closed in a `finally` block, even if the wait or save step throws.

#### Scenario: Successful authentication returns cookies and expiry
- **WHEN** `authenticate("test-profile")` is called and the cookie monitor reports both `__Secure-1PSID` and `__Secure-1PSIDTS` before the timeout
- **THEN** the method resolves with an `AuthResult` whose `cookies` array has length 2, whose `expiresAt` is a `Date` derived from `__Secure-1PSIDTS.expires * 1000`, the driver `openHeaded` is called exactly once with the Gemini app URL, the cookie monitor `start` is called exactly once, the cookie storage `save` is called exactly once, and the driver `closeSession` is called exactly once with the profile name

#### Scenario: Driver is opened with the Gemini app URL and the profile as session
- **WHEN** `launchBrowser("my-profile")` is called via the public flow
- **THEN** the driver `openHeaded` is invoked with `"https://gemini.google.com/app"` as the URL, `"my-profile"` as the profile, and `"my-profile"` as the session identifier

#### Scenario: Browser is closed in a finally block on error
- **WHEN** `authenticate("test-profile")` is called and `waitForLogin` throws (e.g. timeout)
- **THEN** the driver `closeSession` is still invoked with the profile name (verified by `expect(driver.closeSession).toHaveBeenCalledWith("test-profile")`)

#### Scenario: Invalid profile name is rejected
- **WHEN** `authenticate("bad name!")` is called
- **THEN** the method rejects with an error whose message contains `invalid characters`

#### Scenario: Authentication timeout is surfaced as AuthServiceTimeoutError
- **WHEN** `waitForLogin` is called and the cookie monitor never invokes its callback before the timeout fires
- **THEN** the method rejects with an `AuthServiceTimeoutError` whose message contains the configured timeout in milliseconds and the substring `No auth cookies detected`, and the cookie monitor `stop` has been called

### Requirement: AuthService prints headed-browser notification (no Enter-block)
The `AuthService.notifyUser(profileName)` method MUST print a one-shot UI message to the console before launching the browser. The message MUST contain the substring `Opening headed browser`, the Gemini app URL `https://gemini.google.com/app`, and the substring `auto-detect`. The method MUST NOT block on an Enter key press — once the messages are printed, the call MUST return and the caller MUST proceed directly to launch the browser. The single-line "Press Enter to launch browser" prompt described in earlier design notes is not implemented; the current flow runs the launch immediately after the notification.

#### Scenario: Notification includes URL and auto-detect hint
- **WHEN** `notifyUser("default")` is called
- **THEN** the combined console output contains the substrings `Opening headed browser`, `https://gemini.google.com/app`, and `auto-detect`

#### Scenario: Notification does not block waiting for input
- **WHEN** the auth flow calls `notifyUser` followed by `launchBrowser`
- **THEN** `launchBrowser` runs without the user pressing Enter (no `readline` or stdin reader is involved in the path)

### Requirement: AuthService prints a confirmation with cookie count and expiry
The `AuthService.confirmAuthSuccess(cookieCount, expiresAt, cookies)` method MUST print a success block to the console. The block MUST contain the substrings `Login auto-detected`, `Authentication successful`, and `<cookieCount> cookies`. When `expiresAt` is a `Date`, the block MUST additionally contain the substring `Session expires` followed by the localized date. The block MUST also report the presence of `__Secure-1PSID` in the supplied cookies with a `✅` (present) or `❌` (absent) marker.

#### Scenario: Success block with expiry
- **WHEN** `confirmAuthSuccess(2, new Date("2026-12-31T00:00:00Z"), makeAuthCookies())` is called
- **THEN** the combined output contains `Login auto-detected`, `Authentication successful`, `2 cookies`, `Session expires`, `__Secure-1PSID`, and the `✅` marker

#### Scenario: Success block without expiry
- **WHEN** `confirmAuthSuccess(1, null, [])` is called
- **THEN** the combined output contains `Authentication successful` and `1 cookies` but does NOT contain the substring `Session expires`

#### Scenario: Success block with missing __Secure-1PSID
- **WHEN** `confirmAuthSuccess(0, null, [])` is called
- **THEN** the combined output contains `__Secure-1PSID` and the `❌` marker

### Requirement: CookieMonitor polls every 2 seconds using a sign-out-link JS probe
The `CookieMonitor.start(session, onCookiesFound, timeoutMs?)` method MUST begin polling the browser session identified by `session` for the presence of the auth cookies. The poll cadence MUST be a 2-second interval (`POLL_INTERVAL_MS = 2000`). On each tick the monitor MUST run a JavaScript probe that detects a logged-in state by checking for the presence of `a[href^="https://accounts.google.com/SignOutOptions"]`; the probe expression MUST be exactly `document.querySelector('a[href^="https://accounts.google.com/SignOutOptions"]') !== null`. Only when the probe returns `true` (matched as a trimmed string `"true"`) MUST the monitor then read the cookie list and require BOTH `__Secure-1PSID` and `__Secure-1PSIDTS` to be present before invoking the `onCookiesFound` callback. The monitor MUST also accept a `timeoutMs` parameter (default 300000 ms / 5 minutes) and MUST apply `.unref()` to the timeout handle so it does not block CLI process exit.

#### Scenario: Monitor fires callback on first tick where probe and cookies are both ready
- **WHEN** `start("sess1", cb, 10000)` is called and every 2-second tick returns `true` from the probe and returns both required cookies from `cookieList`
- **THEN** `cb` is invoked exactly once with the auth cookies, `isRunning` is `false`, and the interval has been cleared

#### Scenario: Monitor does not call driver immediately on start
- **WHEN** `start("sess1", cb, 10000)` is called
- **THEN** `driver.evalJs` is NOT called synchronously — the first eval call is scheduled by the interval and only happens after the 2-second delay

#### Scenario: Monitor does not call callback when probe returns false
- **WHEN** `start("sess1", cb, 10000)` is called and every tick returns `false` from the probe
- **THEN** `cb` is never invoked and `isRunning` is `false` after `stop()`

#### Scenario: Monitor swallows repeated eval throws
- **WHEN** `start("sess1", cb, 10000)` is called and every tick's `evalJs` rejects
- **THEN** `start` resolves successfully, `cb` is never invoked, and the monitor continues running (does not reject)

#### Scenario: Timeout handle is unref'd so CLI can exit
- **WHEN** `start("sess1", cb, 10000)` is called
- **THEN** the `setTimeout` handle used for the hard timeout has `unref()` called on it (the monitor must not keep the event loop alive past the timeout)

### Requirement: CookieMonitor exposes checkLoggedIn and checkCookies helpers
The `CookieMonitor.checkLoggedIn(session)` method MUST return `true` when the sign-out-link probe evaluates to the string `"true"` (with surrounding whitespace allowed) and MUST return `false` for any other return value, including probe errors. The `CookieMonitor.checkCookies(session)` method MUST call `driver.cookieList(session)`, filter the result to entries whose `name` is `__Secure-1PSID` or `__Secure-1PSIDTS`, and return the filtered list when both required cookies are present; otherwise it MUST return an empty array. Both helpers MUST swallow driver errors and return `false` / `[]` respectively.

#### Scenario: checkLoggedIn returns true on probe success
- **WHEN** `driver.evalJs` returns the string `"true"`
- **THEN** `checkLoggedIn("sess1")` resolves with `true`

#### Scenario: checkLoggedIn returns false on whitespace-padded true
- **WHEN** `driver.evalJs` returns the string `"  true  \n"`
- **THEN** `checkLoggedIn("sess1")` resolves with `true` (whitespace is trimmed)

#### Scenario: checkLoggedIn returns false on probe throw
- **WHEN** `driver.evalJs` rejects
- **THEN** `checkLoggedIn("sess1")` resolves with `false` (does not throw)

#### Scenario: checkCookies returns required cookies when both present
- **WHEN** `driver.cookieList` returns an array containing both `__Secure-1PSID` and `__Secure-1PSIDTS`
- **THEN** `checkCookies("sess1")` resolves with a length-2 array containing both required cookie names

#### Scenario: checkCookies returns empty when only one required cookie present
- **WHEN** `driver.cookieList` returns only `__Secure-1PSID`
- **THEN** `checkCookies("sess1")` resolves with `[]`

### Requirement: CookieMonitor.stop is idempotent and clears the interval
The `CookieMonitor.stop()` method MUST clear the active polling interval and timeout handle, set the internal `_stopped` flag, and log a `Cookie monitor stopped` info message. Subsequent calls to `stop()` MUST be no-ops (verified by the `stop is idempotent` test). After `stop()` is called, `isRunning` MUST be `false`.

#### Scenario: stop prevents further polling
- **WHEN** `start` is called and then `stop` is called before the first tick fires
- **THEN** the callback is never invoked and `isRunning` is `false`

#### Scenario: stop is idempotent
- **WHEN** `stop()` is called three consecutive times on a monitor that was never started
- **THEN** none of the calls throw and `isRunning` is `false`

### Requirement: CookieStorageService loads and validates per-profile cookies

The `CookieStorageService.loadCookiesForProfile(profileName)` method MUST return a `LoadedCookies` object with two fields: `secure_1psid: string` and `secure_1psidts: string | null`. The method MUST read cookies from the underlying `CookieStorage.load(profileName)`. The method MUST resolve `__Secure-1PSID` and `__Secure-1PSIDTS` from stored cookies by preferring `.google.com` domain entries. When multiple cookies share the same name across different domains, the method MUST select the `.google.com` entry. If no `.google.com` entry exists for a required name, the method MUST fall back to the first matching cookie by name. If `__Secure-1PSID` is missing, the method MUST throw an `Error` whose message contains `Missing required cookie __Secure-1PSID` and mentions the profile name and `gemiterm auth`. The `secure_1psidts` field MUST be `null` when the cookie is absent.

#### Scenario: Load returns both cookie values

- **WHEN** the profile's storage contains both `__Secure-1PSID` and `__Secure-1PSIDTS`
- **THEN** `loadCookiesForProfile("default")` returns `{ secure_1psid: "<psid value>", secure_1psidts: "<psidts value>" }`

#### Scenario: Load returns null for missing 1PSIDTS

- **WHEN** the profile's storage contains only `__Secure-1PSID`
- **THEN** `loadCookiesForProfile("default")` returns `{ secure_1psid: "<psid value>", secure_1psidts: null }`

#### Scenario: Load throws when __Secure-1PSID is missing

- **WHEN** the profile's storage contains only `__Secure-1PSIDTS`
- **THEN** `loadCookiesForProfile("default")` throws an error whose message contains `Missing required cookie`

#### Scenario: Prefers .google.com domain PSIDTS when both .youtube.com and .google.com exist

- **WHEN** `loadCookiesForProfile("default")` is called
- **AND** the stored cookies include `__Secure-1PSIDTS` on `.youtube.com` with value `"yt-psidts"` and `__Secure-1PSIDTS` on `.google.com` with value `"g-psidts"`
- **THEN** the returned `LoadedCookies.secure_1psidts` is `"g-psidts"`

#### Scenario: Falls back to first match when no .google.com entry exists

- **WHEN** `loadCookiesForProfile("default")` is called
- **AND** the stored cookies include `__Secure-1PSIDTS` only on `.youtube.com` (no `.google.com` entry)
- **THEN** the returned `LoadedCookies.secure_1psidts` is the `.youtube.com` value

#### Scenario: Prefers .google.com domain PSID when both .youtube.com and .google.com exist

- **WHEN** `loadCookiesForProfile("default")` is called
- **AND** the stored cookies include `__Secure-1PSID` on `.youtube.com` with value `"yt-psid"` and `__Secure-1PSID` on `.google.com` with value `"g-psid"`
- **THEN** the returned `LoadedCookies.secure_1psid` is `"g-psid"`

### Requirement: CookieStorageService validates and computes cookie freshness
The `CookieStorageService.validateCookies(cookies)` method MUST return `true` when the cookie array contains entries for BOTH `__Secure-1PSID` and `__Secure-1PSIDTS`, and MUST return `false` for any other case (including empty arrays). The `CookieStorageService.checkCookieFreshness(cookies)` method MUST return `true` only when `__Secure-1PSIDTS.expires` is a positive number AND the resulting expiry is more than 7 days (604800000 ms) in the future; it MUST return `false` for expired cookies, cookies expiring within 7 days, and cookies with no expiry timestamp.

#### Scenario: validateCookies returns true when both required cookies are present
- **WHEN** `validateCookies` is called with an array containing both `__Secure-1PSID` and `__Secure-1PSIDTS`
- **THEN** it returns `true`

#### Scenario: validateCookies returns false when 1PSIDTS is missing
- **WHEN** `validateCookies` is called with an array containing only `__Secure-1PSID`
- **THEN** it returns `false`

#### Scenario: checkCookieFreshness returns true for cookies expiring far in the future
- **WHEN** `checkCookieFreshness` is called with cookies whose `__Secure-1PSIDTS.expires` is more than 7 days from now
- **THEN** it returns `true`

#### Scenario: checkCookieFreshness returns false for cookies expiring within 7 days
- **WHEN** `checkCookieFreshness` is called with cookies whose `__Secure-1PSIDTS.expires` is 3 days from now
- **THEN** it returns `false`

#### Scenario: checkCookieFreshness returns false for expired cookies
- **WHEN** `checkCookieFreshness` is called with cookies whose `__Secure-1PSIDTS.expires` is in the past
- **THEN** it returns `false`

### Requirement: CookieStorageService computes cookie expiry
The `CookieStorageService.getCookieExpiry(cookies)` method MUST return a `Date` derived from `__Secure-1PSIDTS.expires * 1000` (Unix seconds to JS ms) when the cookie has a positive `expires` value. The method MUST return `null` when the cookie array is empty or when no cookie has a positive `expires` value.

#### Scenario: getCookieExpiry returns Date for valid expiry
- **WHEN** `getCookieExpiry` is called with cookies that include `__Secure-1PSIDTS` having a positive `expires`
- **THEN** it returns a `Date` whose time is greater than the current time

#### Scenario: getCookieExpiry returns null when 1PSIDTS has no positive expires
- **WHEN** `getCookieExpiry` is called with cookies that include `__Secure-1PSIDTS` having `expires <= 0`
- **THEN** it returns `null`

#### Scenario: getCookieExpiry returns null for empty cookies
- **WHEN** `getCookieExpiry([])` is called
- **THEN** it returns `null`

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

### Requirement: ProfileAuthManager.ensureAuthenticated probes server before returning cookies
The `ProfileAuthManager.ensureAuthenticated(profileName?)` method MUST resolve the profile name (provided value, or the configured default), validate it, and check that the profile has valid cookies. If `profileManager.hasValidCookies(name)` returns `false`, the method MUST first attempt `autoExtendSession(name)`. If auto-extend succeeds (returns `true`), the method MUST log an info-level `"Session auto-refreshed for profile '<name>'"` message and return the result of `cookieStorageService.loadCookiesForProfile(name)`. If auto-extend fails (returns `false`), the method MUST throw an `AuthenticationError` whose message contains `No valid session for profile '<name>'` and the substring `gemiterm login`. When `profileManager.hasValidCookies(name)` returns `true`, the method MUST consult a server-side validity probe (calling `geminiClient.models()`) before returning the loaded cookies. The probe result semantics are defined in the `phantom-auth-detection` capability spec. The probe is memoized with a process-level cache (default TTL 150_000 ms, overridable via `GEMITERM_PROBE_TTL_MS`).

#### Scenario: Returns cookies for a profile with valid session (MODIFIED — models() probe)

- **WHEN** `ensureAuthenticated("default")` is called and the default profile has locally-valid cookies AND the server-side `models()` probe succeeds
- **THEN** it returns a `LoadedCookies` object whose `secure_1psid` and `secure_1psidts` match the stored values

#### Scenario: Auto-extends session before throwing AuthenticationError
- **WHEN** `ensureAuthenticated("default")` is called and the profile's cookies are within the 1-hour grace window, but auto-extend succeeds
- **THEN** the method logs `"Session auto-refreshed for profile 'default'"` and returns the `LoadedCookies`
- **AND** `AuthenticationError` is NOT thrown

#### Scenario: Throws AuthenticationError when auto-extend fails on expired cookies
- **WHEN** `ensureAuthenticated("default")` is called and the profile's cookies are expired (or near-expiry) and auto-extend returns `false`
- **THEN** it throws an `AuthenticationError` whose message contains `No valid session`

#### Scenario: Throws AuthenticationError when no cookies exist and auto-extend fails
- **WHEN** `ensureAuthenticated("default")` is called and the profile has no cookies
- **THEN** it throws an `AuthenticationError` whose message contains `No valid session`

#### Scenario: Uses default profile when none specified
- **WHEN** `ensureAuthenticated()` is called with no argument and the configured default profile has valid cookies
- **THEN** it returns the loaded cookies for the default profile

#### Scenario: Throws on invalid profile name
- **WHEN** `ensureAuthenticated("bad name!")` is called
- **THEN** it throws an error whose message contains `invalid characters`

### Requirement: ProfileAuthManager.getActiveProfiles filters to valid sessions
The `ProfileAuthManager.getActiveProfiles()` method MUST return the names of all profiles that have valid cookies. The method MUST return `string[]`, MUST be empty when no profiles exist, and MUST NOT include profiles whose cookies are expired or invalid.

#### Scenario: Returns only profiles with valid cookies
- **WHEN** two profiles exist, one with fresh cookies and one with expired cookies
- **THEN** `getActiveProfiles()` returns a list containing the fresh profile and not the expired one

#### Scenario: Returns empty array when no profiles have valid cookies
- **WHEN** profiles exist but all have expired cookies
- **THEN** `getActiveProfiles()` returns `[]`

#### Scenario: Returns empty array when no profiles exist
- **WHEN** no profiles are configured
- **THEN** `getActiveProfiles()` returns `[]`

### Requirement: ProfileAuthManager.findProfileForConversation returns the profile that owns the conversation

The `ProfileAuthManager.findProfileForConversation(conversationId)` method MUST iterate over all profiles in `profileManager.list()` order and, for each, call `geminiClient.profileHasConversation(name, conversationId)` to check whether the conversation appears in that profile's chat list. It MUST return the name of the first profile whose helper returns `true`. When no profile owns the conversation, the method MUST return `null`. The `conversationId` argument MUST be passed to the lookup helper; it MUST NOT be ignored. The method MUST NOT throw on a missing or unknown conversation id.

#### Scenario: Returns the profile that owns the conversation
- **WHEN** `findProfileForConversation("conv-123")` is called and conversation `conv-123` exists in profile `work` but not in profile `personal`
- **THEN** the method returns the string `"work"`

#### Scenario: Returns null when conversation is not in any profile
- **WHEN** `findProfileForConversation("conv-456")` is called and conversation `conv-456` does not exist in any profile's chat list
- **THEN** the method returns `null`

#### Scenario: Returns null when no profiles exist
- **WHEN** `findProfileForConversation("conv-789")` is called and no profiles are configured
- **THEN** the method returns `null`

#### Scenario: Returns first profile in list order when multiple profiles report ownership
- **WHEN** `findProfileForConversation("conv-shared")` is called and conversation `conv-shared` exists in both profile `profile1` and profile `profile3`, and `profileManager.list()` returns `["profile1", "profile2", "profile3"]` in that order
- **THEN** the method returns the string `"profile1"` (the first profile in list order that reports ownership)

### Requirement: PlaywrightCliDriver auto-detects between direct and bunx strategies
The `PlaywrightCliDriver` constructor MUST default the underlying `PlaywrightRunner` to a `BunPlaywrightRunner` with strategy `"direct"` (invoking the `playwright-cli` binary directly). The first time `runCli` is needed, the driver MUST probe the available install: it MUST first try `playwright-cli --version`; if that exits with code 0, the strategy is `direct`. If the direct probe fails, the driver MUST try `bunx @playwright/cli --version`; on success, the strategy is `bunx`. If both probes fail, the driver MUST emit a warning and `runCli` MUST continue to throw `PlaywrightCliError` on any call. The probe MUST time out after 5000 ms (`PROBE_TIMEOUT_MS`) per attempt.

#### Scenario: Strategy exposes the runner's resolved strategy
- **WHEN** the driver is constructed with a runner of strategy `"direct"`
- **THEN** `driver.strategy` returns `"direct"`; the same holds for strategy `"bunx"`

#### Scenario: Driver picks up the direct runner when probe succeeds
- **WHEN** the constructor is given no runner and the live probe of `playwright-cli --version` returns exit code 0
- **THEN** `driver.strategy` is `"direct"`

### Requirement: PlaywrightCliDriver exposes the standard browser-driver methods
The `PlaywrightCliDriver` class MUST expose the following async methods, each of which MUST construct its argument array with `withSession(session, [...])` (which prepends `-s=<session>`) for the session-scoped methods:
- `runCli(args)` returns the trimmed `stdout` string on success, or throws `PlaywrightCliError(command, exitCode, stderr)` on non-zero exit codes.
- `openHeaded(url, profile, session?)` builds the args `["open", "--browser=chromium", "--headed", "--persistent", "--profile=<profileDir>", url]`, prepending `-s=<session>` when supplied, and resolves the profile dir through the injected `profileDirResolver` (defaulting to `getProfileDir(profile)`).
- `evalJs(session, expression)` invokes `playwright-cli eval <expression> --raw` and returns the raw output string.
- `cookieList(session)` invokes `playwright-cli cookie-list --json` and returns a parsed `Cookie[]` (the JSON-array path is preferred; a non-JSON, non-array response yields `[]`).
- `stateSave(session, path)` and `stateLoad(session, path)` invoke `playwright-cli state-save <path>` and `state-load <path>` respectively.
- `closeSession(session)` invokes `playwright-cli close`; if the error is a `PlaywrightCliError` whose message contains `not found` (case-insensitive), the call resolves successfully instead of throwing.
- `closeAll()` invokes `playwright-cli close-all` with no session flag.

#### Scenario: runCli resolves with stdout on success
- **WHEN** `runCli(["--version"])` is called and the underlying runner returns exit code 0 with stdout `v1.2.3`
- **THEN** the method resolves with the string `v1.2.3`

#### Scenario: runCli throws PlaywrightCliError on non-zero exit
- **WHEN** `runCli(["nonexistent-command"])` is called and the underlying runner returns exit code 1
- **THEN** the method rejects with a `PlaywrightCliError` whose message contains the command name and the stderr text

#### Scenario: openHeaded builds expected args with the session flag
- **WHEN** `openHeaded("https://gemini.google.com/app", "p1", "s1")` is called
- **THEN** the runner is invoked once with args beginning with `-s=s1`, containing `open`, `https://gemini.google.com/app`, `--browser=chromium`, `--headed`, `--persistent`, and `--profile=<dir>/p1` as the last few flags

#### Scenario: evalJs includes --raw and returns stdout
- **WHEN** `evalJs("test-session", "() => document.title")` is called
- **THEN** the runner is invoked with `["-s=test-session", "eval", "() => document.title", "--raw"]` and the result is the runner's stdout

#### Scenario: cookieList parses JSON array output
- **WHEN** `cookieList("sess1")` is called and the runner returns a JSON array of cookie objects
- **THEN** the method resolves with a `Cookie[]` whose length and fields match the input

#### Scenario: cookieList returns empty array for non-JSON output
- **WHEN** `cookieList("sess1")` is called and the runner returns the string `not-json`
- **THEN** the method resolves with `[]`

#### Scenario: closeSession swallows "not found" errors
- **WHEN** `closeSession("sess1")` is called and the runner returns exit code 1 with stderr `session not found`
- **THEN** the method resolves successfully (does not throw)

#### Scenario: closeSession propagates other PlaywrightCliError failures
- **WHEN** `closeSession("sess1")` is called and the runner returns exit code 1 with stderr `something else failed`
- **THEN** the method rejects with a `PlaywrightCliError`

#### Scenario: closeAll runs without a session flag
- **WHEN** `closeAll()` is called
- **THEN** the runner is invoked exactly once with args equal to `["close-all"]` and no `-s=` flag

### Requirement: AuthCommand is registered as the "auth" command
The `AuthCommand` class MUST be registered with the CLI as the command named `"auth"`. Its `description` field MUST be the string `"Authenticate with Google Gemini"`. The `name` and `description` properties are part of the public `CliCommand` contract.

#### Scenario: AuthCommand metadata
- **WHEN** an `AuthCommand` instance is constructed
- **THEN** `command.name === "auth"` and `command.description === "Authenticate with Google Gemini"`

### Requirement: AuthCommand shows usage on --help
When the `auth` command is invoked with `--help` or `-h` as any argument, the command MUST print a usage block to the console containing the substring `gemiterm auth`, the description `Authenticate with Google Gemini.`, and the option row `  -h, --help    Show this help message`. The command MUST NOT proceed to the authentication flow when help is requested.

#### Scenario: --help shows usage and skips auth
- **WHEN** the user invokes `gemiterm auth --help`
- **THEN** the console output contains the substrings `gemiterm auth`, `Authenticate with Google Gemini.`, and `-h, --help`, and the auth flow is not entered (no driver or monitor interactions)

#### Scenario: -h shows usage and skips auth
- **WHEN** the user invokes `gemiterm auth -h`
- **THEN** the same usage block is printed and the auth flow is not entered

### Requirement: AuthCommand auto-creates the default profile on first run
When `AuthCommand.execute` is called and `listProfiles()` returns zero profiles, the command MUST create the default profile (using `getDefaultProfileName()`) and call `authenticateWithProfile` with `createFirst=true`. When exactly one profile exists, the command MUST authenticate that profile with `createFirst=false`.

#### Scenario: First run authenticates the default profile and creates it
- **WHEN** `auth` is invoked and no profiles exist
- **THEN** `authenticateWithProfile` is called with the default profile name and `createFirst=true`

#### Scenario: Single-profile setup authenticates that profile without creating
- **WHEN** `auth` is invoked and only one profile exists
- **THEN** `authenticateWithProfile` is called with that profile's name and `createFirst=false`

### Requirement: AuthCommand shows the multi-profile management menu when 2+ profiles exist
When `AuthCommand.execute` is called and `listProfiles()` returns 2 or more profile names, the command MUST render a `Profile Management` section that includes:
- A profile table rendered by `formatProfileTable` containing the statuses of the existing profiles.
- A list of options, each formatted as `  [X] <label>`, with keys and labels: `[A] Add new profile`, `[D] Delete profile`, `[S] Set default`, `[R] Rename profile`, `[X] Exit and continue with current default`.

The command MUST prompt the user with the text `Select an option` and route the response (case-insensitive, trimmed) to the matching handler. Any unrecognized key (or `X`) MUST be treated as `Exit` and the command MUST print the substring `Continuing with current default profile.` and return without invoking the auth flow.

#### Scenario: Multi-profile run opens the menu
- **WHEN** `auth` is invoked and multiple profiles exist
- **THEN** `showProfileMenu` is called with the list of profile names and a `ProfileManager` instance

#### Scenario: Menu renders all five options
- **WHEN** the menu is rendered for any 2+ profile setup
- **THEN** the combined output contains the substrings `[A] Add new profile`, `[D] Delete profile`, `[S] Set default`, `[R] Rename profile`, and `[X] Exit`

#### Scenario: Unknown option exits to default
- **WHEN** the user enters `Z` (or any non-matching key) at the menu prompt
- **THEN** the command prints `Continuing with current default profile.` and returns without calling `authenticateWithProfile`

#### Scenario: X option exits to default
- **WHEN** the user enters `X` at the menu prompt
- **THEN** the command prints `Continuing with current default profile.` and returns without calling `authenticateWithProfile`

### Requirement: AuthCommand "Add new profile" menu option
When the user selects `A` at the menu prompt, the command MUST prompt for a profile name, validate it via `validateProfileName`, reject duplicates with a `GemitermError` whose message contains `already exists`, create the profile with `profileManager.create(name)`, and return the new profile name to the caller (which triggers `authenticateWithProfile` for that name).

#### Scenario: Adding a new profile triggers auth with the new name
- **WHEN** the user selects `A` and enters a fresh profile name
- **THEN** the new profile is created and `authenticateWithProfile` is called with the new name

#### Scenario: Duplicate profile name is rejected
- **WHEN** the user selects `A` and enters a name that already exists
- **THEN** the command throws a `GemitermError` whose message contains `already exists`

#### Scenario: Invalid profile name is rejected
- **WHEN** the user selects `A` and enters a name with invalid characters (e.g. `bad name!!`)
- **THEN** the command throws an error whose message contains `invalid characters`

### Requirement: AuthCommand "Delete profile" menu option
When the user selects `D` at the menu prompt, the command MUST prompt for the profile name to delete, reject unknown profiles with a `GemitermError` whose message contains `does not exist`, then prompt `Delete profile '<name>'? [y/N]` and only delete the profile (via `profileManager.delete`) when the answer starts with `y` (case-insensitive). Any other answer MUST cancel the delete (printing `Cancelled.`) and return without invoking the auth flow.

#### Scenario: Deleting an existing profile removes it
- **WHEN** the user selects `D`, enters an existing profile name, and confirms with a `y`-prefixed answer
- **THEN** `profileManager.delete(name)` is called and the command returns without authenticating

#### Scenario: Deleting a non-existent profile throws
- **WHEN** the user selects `D` and enters a profile name not in `listProfiles()`
- **THEN** the command throws a `GemitermError` whose message contains `does not exist`

#### Scenario: Cancelling the delete confirmation preserves the profile
- **WHEN** the user selects `D`, enters an existing profile name, and answers the confirmation with `n` (or anything not starting with `y`)
- **THEN** the delete is not performed and the command returns without authenticating

### Requirement: AuthCommand "Set default" menu option
When the user selects `S` at the menu prompt, the command MUST prompt for a profile name, reject unknown profiles with a `GemitermError` whose message contains `does not exist`, then call BOTH `profileManager.setDefault(name)` and `setDefaultProfileName(name)`, print the substring `Default profile set to '<name>'.`, and return without invoking the auth flow.

#### Scenario: Setting default updates both the manager and the global marker
- **WHEN** the user selects `S` and enters a valid existing profile name
- **THEN** `profileManager.setDefault(name)` and `setDefaultProfileName(name)` are both called with the same name

#### Scenario: Setting default for unknown profile throws
- **WHEN** the user selects `S` and enters a profile name not in `listProfiles()`
- **THEN** the command throws a `GemitermError` whose message contains `does not exist`

### Requirement: AuthCommand "Rename profile" menu option
When the user selects `R` at the menu prompt, the command MUST prompt for the current profile name (rejecting unknown names with a `GemitermError` whose message contains `does not exist`), then prompt for the new name, validate the new name via `validateProfileName`, call `profileManager.rename(oldName, newName)`, and return the new name to the caller (which triggers `authenticateWithProfile` for the new name).

#### Scenario: Renaming a profile triggers auth with the new name
- **WHEN** the user selects `R` and enters a valid existing old name and a valid new name
- **THEN** `profileManager.rename(oldName, newName)` is called and `authenticateWithProfile` is called with the new name

#### Scenario: Renaming with invalid new name throws
- **WHEN** the user selects `R` and enters a new name that fails `validateProfileName`
- **THEN** the command throws an error whose message contains `invalid characters`

#### Scenario: Renaming an unknown profile throws
- **WHEN** the user selects `R` and enters an old name not in `listProfiles()`
- **THEN** the command throws a `GemitermError` whose message contains `does not exist`

### Requirement: AuthCommand propagates authentication errors
When `AuthCommand.authenticateWithProfile` (or its delegates) throws, the command MUST propagate the error to the caller so the process exits non-zero. The error message is the original error's message (e.g. `Browser launch failed` from the integration test fixture).

#### Scenario: Auth flow errors are propagated
- **WHEN** the auth flow rejects with an error whose message is `Browser launch failed`
- **THEN** `execute` rejects with an error whose message contains `Browser launch failed`

### Requirement: AuthService.silentRefresh is a multi-layer recovery ladder

The `AuthService.silentRefresh(profileName)` method MUST attempt session recovery in a ladder, escalating from the cheapest mechanism to the heaviest:

1. **L1 -- RotateCookies POST:** Call `rotateCookies(profileName)`. If `true`, return `true` immediately. No browser launch. No polling.
2. **L2 -- Headless browser (fallback):** Only reached when L1 returns `false`. Launch headless Chromium via `openHeadless`, load cookies via `stateLoad`, start `CookieMonitor` with `requireRotation` baseline. Return `true` only when the monitor returns values that differ from the snapshot. The method MUST persist polled cookies via an upsert merge by `(name, domain, path)` key rather than wholesale overwrite: load the existing jar via `cookieStorageService.loadAllCookiesForProfile(name)`, upsert each polled cookie by matching `(name, domain, path)` tuple, and save the merged list via `cookieStorageService.saveCookiesForProfile(name, merged)`. A polled entry with the same `(name, domain, path)` SHALL overwrite the existing entry; an entry present only in the existing jar SHALL be preserved. Close browser in `finally`.
3. Return `false` when both L1 and L2 fail.

The method MUST NOT produce console output (silent operation). The method MUST NOT throw on any error (driver failure, timeout, missing profile) — all failures return `false`.

#### Scenario: L1 RotateCookies succeeds, returns true immediately

- **WHEN** `silentRefresh("test-profile")` is called
- **AND** `rotateCookies("test-profile")` returns `true` (fresh PSIDTS)
- **THEN** the method returns `true` without launching a browser

#### Scenario: L1 fails, L2 headless browser succeeds with rotated cookies

- **WHEN** `silentRefresh("test-profile")` is called
- **AND** `rotateCookies` returns `false`
- **AND** the headless browser flow detects rotated cookies within 30s
- **THEN** the method returns `true` and the browser is closed

#### Scenario: Both L1 and L2 fail, returns false

- **WHEN** `silentRefresh("test-profile")` is called
- **AND** `rotateCookies` returns `false`
- **AND** the headless browser times out without rotation
- **THEN** the method returns `false`

#### Scenario: Silent refresh returns false on timeout

- **WHEN** `silentRefresh("test-profile")` is called and the `CookieMonitor` does not detect auth cookies within 30s
- **THEN** the monitor times out, `closeSession` is called, and the method returns `false`

#### Scenario: Silent refresh returns false on driver failure

- **WHEN** `silentRefresh("test-profile")` is called and `openHeadless` throws
- **THEN** the method catches the error, attempts `closeSession` in `finally`, and returns `false`

#### Scenario: Silent refresh does not print to stdout

- **WHEN** `silentRefresh("test-profile")` is called and succeeds
- **THEN** no console output is produced (no `console.log` or `console.error` calls from the method itself)

#### Scenario: Silent refresh uses 30-second timeout

- **WHEN** `silentRefresh("test-profile")` is called
- **THEN** `CookieMonitor.start` is invoked with `timeoutMs` of `30_000` (30 seconds)

#### Scenario: Polled 3-cookie set does not evict .google.com PSIDTS

- **WHEN** `silentRefresh("default")` is called
- **AND** the existing jar contains 4 cookies (PSID + PSIDTS on `.youtube.com`, PSID + PSIDTS on `.google.com`)
- **AND** the polled set after L2 contains 3 cookies (PSID + PSIDTS on `.youtube.com`, PSID on `.google.com` — `.google.com` PSIDTS absent)
- **THEN** the persisted jar contains all 4 cookies (existing `.google.com` PSIDTS preserved via merge)
- **AND** the polled entries overwrite their matching `(name, domain, path)` counterparts in the existing jar

#### Scenario: Polled cookie with same key replaces existing entry

- **WHEN** `silentRefresh("default")` is called
- **AND** the existing jar contains `__Secure-1PSID` on `.google.com` with value `"old-value"`
- **AND** the polled set contains `__Secure-1PSID` on `.google.com` with value `"new-value"`
- **THEN** the persisted jar contains `__Secure-1PSID` on `.google.com` with value `"new-value"`

### Requirement: PlaywrightCliDriver.openHeadless launches a headless browser
The `PlaywrightCliDriver` class MUST expose an `openHeadless(url, profile, session?)` method. The method MUST build the same argument array as `buildOpenHeadedArgs` but without the `--headed` flag and without the `--persistent` flag. The method MUST resolve when the browser launches successfully and MUST throw `PlaywrightCliError` on failure.

#### Scenario: openHeadless builds args without --headed and without --persistent
- **WHEN** `openHeadless("https://gemini.google.com/app", "p1", "s1")` is called
- **THEN** the runner is invoked with args containing `-s=s1`, `open`, `https://gemini.google.com/app`, `--browser=chromium`, and `--profile=<dir>/p1`
- **AND** the args do NOT contain `--headed`
- **AND** the args do NOT contain `--persistent`

#### Scenario: openHeadless without session works
- **WHEN** `openHeadless("https://example.com", "p1")` is called with no session argument
- **THEN** the args do NOT contain `-s=` and the method resolves successfully

### Requirement: CLI intercepts AuthenticationError and prompts for reauth
When the `getGeminiClient()` factory in `src/cli/index.ts` encounters an `AuthenticationError` (either from `loadCookiesForApi` throwing or from `ProfileAuthManager.ensureAuthenticated` throwing), the factory MUST catch the error and, before propagating it, attempt to present a re-authentication prompt. The prompt MUST use the `confirm` function from the prompt facade (`src/cli/utils/prompts.ts`). The prompt message MUST contain the substring `Session for profile` and the profile name, and MUST contain the substring `Would you like to launch browser to re-authenticate?`.

#### Scenario: User confirms reauth, browser launches, and operation retries
- **WHEN** `getGeminiClient()` encounters an `AuthenticationError` for profile `"default"`, the user answers `y` to the confirm prompt, and the headed auth flow succeeds
- **THEN** the factory calls `authService.authenticate("default")` (or equivalent auth flow), saves the resulting cookies, calls `profileManager.loadCookiesForApi("default")` again, constructs a new `GeminiClientService` with fresh cookie values, and returns it
- **AND** the original caller (command handler) receives a working client and proceeds with the operation

#### Scenario: User declines reauth, error propagates
- **WHEN** `getGeminiClient()` encounters an `AuthenticationError` and the user answers `n` (or any non-y response) to the confirm prompt
- **THEN** the factory re-throws the original `AuthenticationError`
- **AND** the CLI error handler catches it and prints the error message, exiting with code 1

#### Scenario: Non-TTY mode skips prompt and propagates error
- **WHEN** `getGeminiClient()` encounters an `AuthenticationError` and `process.stdin.isTTY` is `false`
- **THEN** the `confirm` call throws `NonInteractiveError`, which the factory catches and re-throws the original `AuthenticationError`
- **AND** the behavior matches today's error path (error message printed, exit code 1)

#### Scenario: Reauth retry fails, error propagates
- **WHEN** `getGeminiClient()` encounters an `AuthenticationError`, the user confirms reauth, the auth flow succeeds, but the retry `loadCookiesForApi` still throws (e.g., cookies not saved correctly)
- **THEN** the factory throws the second `AuthenticationError` without presenting another prompt (single retry only)
- **AND** the CLI error handler catches it and exits with code 1

### Requirement: Reauth prompt respects --profile flag
When the CLI was invoked with `--profile/-p <name>`, the reauth prompt and the subsequent auth flow MUST target the specified profile, not the default profile. The confirm message MUST include the explicitly-specified profile name.

#### Scenario: Reauth prompt with explicit profile
- **WHEN** `getGeminiClient()` is called with `profileName` set to `"work"` (via `--profile work`) and encounters an `AuthenticationError`
- **THEN** the confirm prompt message contains `"work"` and the auth flow targets the `"work"` profile

### Requirement: Reauth prompt uses prompt facade
The reauth prompt MUST use the `confirm()` function exported from `src/cli/utils/prompts.ts`. The prompt MUST NOT import from `@inquirer/prompts` directly. On `CancellationError` (user presses Ctrl+C during prompt), the factory MUST re-throw the original `AuthenticationError` (not the cancellation).

#### Scenario: Ctrl+C during reauth prompt propagates auth error
- **WHEN** the user presses Ctrl+C while the reauth confirm prompt is displayed
- **THEN** the `confirm()` call throws `CancellationError`, the factory catches it and re-throws the original `AuthenticationError`
- **AND** the CLI exits with the authentication error message, not a cancellation message

### Requirement: ProfileAuthManager.autoExtendSession attempts silent refresh
The `ProfileAuthManager.autoExtendSession(profileName)` method MUST attempt to silently extend a near-expiry session. The method MUST:
1. Load the profile's cookies from `cookieStorageService.load(profileName)` (or equivalent storage access)
2. Call `checkCookieFreshness(cookies)` from `src/infrastructure/storage.ts` to determine if cookies are within the 1-hour grace window
3. If cookies are fresh (outside the window), return `true` immediately (no action needed)
4. If cookies are within the window (not fresh), call a provided `silentRefresh` function (injected as a dependency) with the profile name
5. Return the boolean result of `silentRefresh`

If loading the cookies fails (no profile, no storage file), the method MUST return `false` without throwing.

#### Scenario: autoExtendSession returns true when cookies are already fresh
- **WHEN** `autoExtendSession("default")` is called and the profile's cookies are fresh (outside the 1-hour grace window)
- **THEN** the method returns `true` without calling `silentRefresh`
- **AND** no browser is launched

#### Scenario: autoExtendSession returns true when silent refresh succeeds
- **WHEN** `autoExtendSession("default")` is called and cookies are within the 1-hour grace window, and the injected `silentRefresh` returns `true`
- **THEN** the method returns `true`

#### Scenario: autoExtendSession returns false when silent refresh fails
- **WHEN** `autoExtendSession("default")` is called and cookies are within the 1-hour grace window, and the injected `silentRefresh` returns `false`
- **THEN** the method returns `false`

#### Scenario: autoExtendSession returns false when profile has no cookies
- **WHEN** `autoExtendSession("ghost")` is called and no storage file exists for the profile
- **THEN** the method returns `false` without throwing

### Requirement: ProfileAuthManager.ensureAuthenticated triggers auto-extend before throwing
The `ProfileAuthManager.ensureAuthenticated(profileName?)` method MUST attempt auto-extend when cookies are not valid, before throwing `AuthenticationError`. The updated flow MUST be:
1. Resolve and validate the profile name (unchanged)
2. Check `profileManager.hasValidCookies(name)` (unchanged)
3. If cookies are NOT valid, call `autoExtendSession(name)`
4. If `autoExtendSession` returns `true`, proceed to load and return cookies (step 5)
5. If `autoExtendSession` returns `false`, throw `AuthenticationError`
6. If cookies ARE valid (step 2 passed), return `cookieStorageService.loadCookiesForProfile(name)` (unchanged)

The method MUST log a brief `"Session auto-refreshed for profile '<name>'"` message at info level when auto-extend succeeds, before returning cookies.

#### Scenario: ensureAuthenticated auto-extends and succeeds
- **WHEN** `ensureAuthenticated("default")` is called, `hasValidCookies` returns `false`, and `autoExtendSession` returns `true`
- **THEN** the method logs `"Session auto-refreshed for profile 'default'"` and returns the `LoadedCookies` for the profile
- **AND** `AuthenticationError` is NOT thrown

#### Scenario: ensureAuthenticated auto-extends and fails, throws error
- **WHEN** `ensureAuthenticated("default")` is called, `hasValidCookies` returns `false`, and `autoExtendSession` returns `false`
- **THEN** the method throws `AuthenticationError` with the message containing `"No valid session for profile 'default'"`
- **AND** the logged message does NOT include `"Session auto-refreshed"`

#### Scenario: ensureAuthenticated skips auto-extend when cookies are valid
- **WHEN** `ensureAuthenticated("default")` is called and `hasValidCookies` returns `true`
- **THEN** `autoExtendSession` is NOT called and the method returns `LoadedCookies` directly

