## Purpose

The interactive authentication capability for `gemiterm`. It owns the end-to-end login flow (launching a headed Chromium via `playwright-cli`, polling a running browser session for Google's sign-out indicator, capturing the `__Secure-1PSID` and `__Secure-1PSIDTS` cookies, persisting them to the profile storage, and closing the browser). It also owns the multi-profile management CLI surface (`auth` command) and the `playwright-cli` driver abstraction that auto-detects the local install (direct binary or `bunx @playwright/cli`).
## Requirements
### Requirement: CookieSession facade is the single authentication surface
The `src/auth/cookie-session.ts` module MUST expose a `CookieSession` facade as the only authentication surface consumed by the CLI. The facade MUST expose `ensureSession(profile)`, `captureLogin(profile)`, `probe(profile)`, `refresh(profile)`, `activeProfiles()`, `findProfileForConversation(conversationId)`, and `createKeepalive(profile)` (constructing a wired session-keepalive loop for the profile that satisfies the REPL's start/stop handle contract), and MUST accept all collaborators (`BrowserRefresher`, `CookieStore`, `CookieValidator`, recovery rung, logger) through a single `CookieSessionDeps` deps-object so the implementation is replaceable at the seam. No file outside `src/auth/` may import the collaborators directly, and the facade MUST NOT expose raw collaborator accessors (e.g. getters returning the cookie store or the refresher) — CLI files obtain keepalive instances through `createKeepalive` only. `refresh(profile)` and the keepalive loop MUST share one in-process rotation floor: a rotation recorded by either consumer suppresses the other within the floor window (60 seconds by default), per the session-keepalive requirement.

#### Scenario: Facade wires collaborators from a deps-object
- **WHEN** a `CookieSession` is constructed with fakes for every collaborator in `CookieSessionDeps`
- **THEN** `ensureSession`, `captureLogin`, `probe`, `refresh`, and `createKeepalive` each complete using only the injected fakes (no direct construction of concrete collaborators inside the facade)

#### Scenario: Conversation routing contract is preserved
- **WHEN** `findProfileForConversation("<cid>")` is called and exactly one active profile's client reports owning the conversation
- **THEN** it resolves that profile's name; and when no active profile owns it, it resolves `null`

#### Scenario: Keepalive is constructed through the facade factory
- **WHEN** a command calls `createKeepalive("p")` on the facade
- **THEN** the returned loop is wired to the facade's injected cookie store, refresher, and shared rotation floor, and exposes `start()`/`stop()`

#### Scenario: Manual refresh is suppressed inside the shared floor window
- **WHEN** the keepalive loop completes a rotation for profile "p" and `refresh("p")` is invoked 30 seconds later in the same process
- **THEN** `refresh` resolves `{ rotated: false }` without spawning the browser, and the suppression is logged at debug level

#### Scenario: Scheduled tick is suppressed inside the shared floor window
- **WHEN** a manual `refresh("p")` completes a rotation and a keepalive tick for "p" fires 30 seconds later in the same process
- **THEN** the tick skips the browser and reschedules

### Requirement: CookieSession.ensureSession arms from the on-disk jar
`ensureSession(profile)` MUST load the profile's stored jar, run tier validation, and return the armed cookies without any network call or browser launch when the jar is fresh (storage mtime within 30 minutes). When the jar's mtime exceeds 30 minutes, the method MUST spawn a detached refresh-runner process for the profile (fire-and-forget) and STILL return the on-disk armed cookies immediately - the current command is never blocked on the browser. Legacy 2/4-cookie jars MUST arm without error (shape is not a validity signal) and self-upgrade via the detached refresh.

#### Scenario: Fresh jar arms with zero added latency
- **WHEN** `ensureSession("p")` is called and the profile's `storage_state.json` mtime is under 30 minutes old
- **THEN** the resolved cookies equal the on-disk jar, no refresh-runner process is spawned, and neither the refresher nor the classifier is invoked

#### Scenario: Stale jar arms immediately and spawns a detached refresh
- **WHEN** `ensureSession("p")` is called and the jar mtime is over 30 minutes old
- **THEN** the method resolves with the on-disk cookies without waiting, and exactly one detached refresh-runner process is spawned for profile `p`

#### Scenario: Legacy trimmed jar is accepted
- **WHEN** `ensureSession("p")` is called and the stored jar contains only `__Secure-1PSID` + `__Secure-1PSIDTS`
- **THEN** the call does not reject on jar shape (tier-2 warns at most) and arms the session

### Requirement: Detached refresh-runner survives the CLI and is observable
The detached refresh-runner spawn MUST create the child in its own process group (`detached: true`) so it survives the exiting CLI process tree - including the `bun run` script-runner teardown on Windows, which otherwise kills it mid-flight. The child's stdout and stderr MUST be redirected (append) to `<configDir>/gemiterm.log` so every run records a start line and an outcome (`rotated=true`, timeout, or failure); a failure to open the log file MUST degrade to discarded output and MUST NOT block the refresh. The child environment MUST carry `GEMITERM_CONFIG_DIR` resolved to an absolute path. Within one process, `ensureSession` MUST spawn at most one detached runner per profile regardless of how many times the same stale profile is armed.

Across processes, the spawn MUST be single-flight per profile: before spawning, the parent MUST atomically create `<profiles>/<name>/refresh-runner.lock` (payload: the acquiring pid). When the lock already exists and its mtime is within the stale window (120 s), the parent MUST skip the spawn entirely - the in-flight runner owns the rotation and jar observers (`waitForRotation`) still see its result. A lock whose mtime exceeds the stale window MUST be swept (removed, then the create retried once). The runner child MUST release the lock when it finishes (any outcome); the parent MUST NOT release it. A failure of the lock write itself MUST NOT block the refresh - the spawn proceeds.

#### Scenario: Runner outlives the script-runner teardown
- **WHEN** a stale-jar `ensureSession` runs inside `bun run dev list` and the CLI process tree exits seconds later
- **THEN** the spawned runner process is still alive and completes its own probe/open/poll cycle (rotation or logged timeout) independently of the parent

#### Scenario: Every run lands in gemiterm.log
- **WHEN** the detached runner starts and finishes (either outcome)
- **THEN** `<configDir>/gemiterm.log` gains a start line (profile + pid) and an outcome line (`rotated=true`, the rotation-timeout info, or the failure warning)

#### Scenario: Log failure never blocks a refresh
- **WHEN** the log file cannot be opened at spawn time
- **THEN** the runner is still spawned with discarded stdio and the refresh proceeds

#### Scenario: One arm per invocation
- **WHEN** `ensureSession` arms the same stale profile multiple times in one process
- **THEN** exactly one detached runner is spawned for that profile

#### Scenario: One runner per profile across processes
- **WHEN** two CLI invocations arm the same stale profile within seconds of each other
- **THEN** only the first spawns a detached runner; the second skips its spawn (lock held) and observes the rotation through the jar

#### Scenario: Crashed runner's lock stops blocking
- **WHEN** a runner died without releasing its lock and its mtime exceeds 120 s
- **THEN** the next spawn attempt sweeps the stale lock and acquires it

#### Scenario: Lock failure never blocks a refresh
- **WHEN** the lock file cannot be written at spawn time
- **THEN** the runner is still spawned and the refresh proceeds

### Requirement: CookieSession awaits an in-flight detached rotation
The facade MUST record, at `ensureSession` arm time, per profile: the routable `__Secure-1PSIDTS` baseline value of the armed jar and whether the jar was armed stale (storage mtime past the 30-minute detached-spawn threshold). On this record the facade MUST expose two additive members:

- `rotationInFlight(profile)` - synchronous, resolving whether the last arm was stale and no rotation has been observed since.
- `waitForRotation(profile, opts?)` - when the last arm was fresh (or the profile was never armed), it MUST resolve `null` immediately without polling; otherwise it MUST poll the on-disk jar (first check immediately, then at the configured poll interval) until the routable `__Secure-1PSIDTS` value differs from the recorded baseline or a timeout elapses (90 seconds by default - at or above the rotation budget of 60 s plus browser-open margin, so the wait can always cover the runner it is awaiting; overridable via `opts.timeoutMs` and an injectable dep for tests). On an observed change it MUST mark the rotation observed, re-arm from the refreshed jar, and resolve the fresh `ArmedSession`. On timeout it MUST resolve `null` and keep the rotation marked in flight.

`waitForRotation` MUST NOT spawn a browser or refresh-runner, MUST NOT write cookies, and MUST NOT reject (jar read failures during polling are swallowed and polling continues until the deadline). The arm-first semantics of `ensureSession` are unchanged: a stale arm still resolves immediately with the on-disk cookies.

#### Scenario: Fresh arm short-circuits the wait
- **WHEN** `ensureSession("p")` arms a jar whose mtime is under 30 minutes old and `waitForRotation("p")` is then called
- **THEN** the call resolves `null` without any polling delay, `rotationInFlight("p")` is `false`, and no jar read beyond the arm occurs

#### Scenario: Rotation landing resolves the re-armed session
- **WHEN** `ensureSession("p")` arms a stale jar (spawning the detached runner) and the on-disk jar's routable `__Secure-1PSIDTS` changes to a new value while `waitForRotation("p")` polls
- **THEN** the call resolves an `ArmedSession` whose cookies are the refreshed on-disk jar, and `rotationInFlight("p")` subsequently returns `false`

#### Scenario: Timeout resolves null and keeps the rotation in flight
- **WHEN** `waitForRotation("p")` polls a jar whose `__Secure-1PSIDTS` never changes before the timeout
- **THEN** the call resolves `null` after at most the configured timeout and `rotationInFlight("p")` remains `true`

#### Scenario: The wait is passive
- **WHEN** `waitForRotation("p")` runs against any profile state
- **THEN** no refresh-runner is spawned, no browser session opens, and no cookie write occurs

#### Scenario: Jar read failures do not reject the wait
- **WHEN** a poll's jar read fails mid-wait and the rotation lands on a later poll
- **THEN** the call still resolves the refreshed `ArmedSession` rather than rejecting

### Requirement: SDK cookie selection prefers the gemini.google.com-routable scope
The armed SDK config (`secure1psid`/`secure1psidts`) and the rotation baseline MUST be derived by selecting the cookie that is RFC-6265-routable to `gemini.google.com`, never the first cookie by name. A jar that holds `__Secure-1PSID`/`__Secure-1PSIDTS` at both `.youtube.com` and `.google.com` scopes MUST yield the `.google.com` values (the `.youtube.com` values are a different session and fail Gemini auth). When no cookie of the name is routable to `gemini.google.com`, selection MUST fall back to any name match rather than returning null for an otherwise-present cookie.

#### Scenario: google.com scope wins over an earlier youtube.com sibling
- **WHEN** a jar holds `__Secure-1PSID` and `__Secure-1PSIDTS` at `.youtube.com` (earlier in the jar) and at `.google.com` (later), with different values
- **THEN** the armed SDK config and the refresh baseline resolve to the `.google.com` values

#### Scenario: fallback to any name match when nothing is routable
- **WHEN** a jar holds a same-name cookie whose domain is not routable to `gemini.google.com`
- **THEN** selection falls back to that cookie's value (never `undefined`/`null` for a present cookie)

### Requirement: CookieSession.captureLogin captures the full browser jar (gate is not payload)
`captureLogin(profile)` MUST open a headed browser (`https://gemini.google.com/app`) after printing a one-shot notification (containing `Opening headed browser` and the app URL, without blocking on input), poll the session's cookie list until BOTH `__Secure-1PSID` and `__Secure-1PSIDTS` are present (5-minute timeout), and then persist the COMPLETE browser storage state captured via `state-save` as the payload - filtered by domain (`.google.com`, `.youtube.com`, `accounts.google.com`) and by nothing else. No cookie-name filtering may exist in the capture path. The browser session MUST be closed in a `finally` block on every path. On success the method MUST print a confirmation containing the captured cookie count and the expiry derived from `__Secure-1PSIDTS.expires`; on timeout it MUST reject with a typed timeout error.

#### Scenario: Gate waits for both required cookies; payload is the full jar
- **WHEN** the cookie list first reports both `__Secure-1PSID` and `__Secure-1PSIDTS` while the browser also holds `SID`, `HSID`, `SSID`, `APISID`, `SAPISID`, `NID`
- **THEN** the persisted jar contains all of those cookies (payload is never filtered to the gate set) and the confirmation reports the full count

#### Scenario: Notification prints and does not block
- **WHEN** `captureLogin` begins
- **THEN** console output contains `Opening headed browser` and `https://gemini.google.com/app`, and the browser launch proceeds without reading stdin

#### Scenario: Browser closed even when the gate times out
- **WHEN** the required cookies never appear within the timeout
- **THEN** the driver's session close is still invoked and the call rejects with the typed timeout error

### Requirement: BrowserRefresher rotates PSIDTS via headless persistent-profile page load
The `src/auth/browser-refresher.ts` collaborator MUST provide `rotatePsidts(profile, baselineValue, timeoutMs = 60000, session?)`: open the persistent-profile browser headless (`open --browser=chromium --persistent --profile=<profileDir>` without `--headed`) at `https://gemini.google.com/app`, poll the cookie list until the `__Secure-1PSIDTS` value differs from `baselineValue` or the timeout elapses, capture the full state via `state-save`, persist through the store's full-jar writer with the domain filter, and close the session in a `finally` block. The playwright session name MUST default to `refresh-<profile>` and MUST be caller-overridable so concurrent callers (detached runner vs. recovery) never share a session name - closing a shared name kills the other caller's browser mid-poll. On timeout or unchanged PSIDTS it MUST resolve `{ rotated: false }` without throwing and without persisting.

#### Scenario: Rotation detected and persisted
- **WHEN** the headless page's cookie list reports an `__Secure-1PSIDTS` value different from the baseline within 60 seconds
- **THEN** the full jar is persisted via the full-jar writer and the result is `{ rotated: true }`

#### Scenario: Timeout closes the browser and persists nothing
- **WHEN** PSIDTS never changes before the timeout
- **THEN** the browser session is closed, no jar write occurs, and the result is `{ rotated: false }`

#### Scenario: Refresh preserves companion cookies
- **WHEN** a rotation is persisted
- **THEN** the stored jar still contains cookies the refresher did not rotate (e.g. `SID`, `HSID`, `APISID`) - the full-jar writer replaces, never trims

#### Scenario: Callers scope their own session name
- **WHEN** recovery rotates while a detached runner may still be alive for the same profile
- **THEN** recovery's `open`/`close` use a session name distinct from `refresh-<profile>` (e.g. `recover-<profile>`), so neither caller can close the other's browser

### Requirement: CookieStore performs snapshot/delta CAS saves
The `src/auth/cookie-store.ts` collaborator MUST provide `load(profile)` returning the jar plus a snapshot keyed by `(name, domain, path) -> value`, and `save(profile, cookies, snapshot)` writing ONLY entries this process changed, and ONLY where the on-disk value still matches the snapshot (compare-and-swap). A concurrent writer's fresher value for an entry this process did not change MUST survive the save. Writes MUST be atomic (temp file + rename) through the `io.ts` surface, and the on-disk format MUST remain the Playwright storage-state JSON.

#### Scenario: Stale process cannot clobber a sibling's fresh rotation
- **WHEN** process A loads a jar, process B rotates `__Secure-1PSIDTS` on disk, and process A then saves an unrelated change with its original snapshot
- **THEN** the on-disk `__Secure-1PSIDTS` still holds process B's rotated value

#### Scenario: Save round-trips through the storage format
- **WHEN** a jar is saved and reloaded
- **THEN** the loaded cookies equal the saved set (same names, values, domains, paths)

### Requirement: CookieStore guards concurrent writers with a cross-process lock
The store MUST serialize writers through one sibling lock file per profile (`storage_state.json.lock`) acquired by exclusive file creation with 100 ms retries, implemented purely with Bun filesystem APIs (no shell commands, no OS-specific locking). CAS saves MUST be fail-open (proceed after waiting at most 10 seconds); full-jar writers MUST be fail-closed (throw typed `LockUnavailableError` after at most 90 seconds). A lock whose file mtime is older than 120 seconds MUST be stealable. Behavior MUST be identical on Windows and POSIX.

#### Scenario: CAS save proceeds when the lock is held too long
- **WHEN** a CAS save cannot acquire the lock within 10 seconds
- **THEN** the save proceeds anyway (fail-open) rather than failing the command

#### Scenario: Full-jar writer fails closed
- **WHEN** a full-jar writer cannot acquire the lock within 90 seconds
- **THEN** it rejects with `LockUnavailableError` and the on-disk jar is unchanged

#### Scenario: Stale lock is stolen
- **WHEN** a lock file exists with an mtime older than 120 seconds
- **THEN** the next writer removes and re-acquires it instead of waiting

### Requirement: CookieValidator enforces two-tier session validation
The `src/auth/cookie-validation.ts` collaborator MUST raise a typed validation error (tier 1) when `__Secure-1PSIDTS` is absent, expired, or not RFC-6265-routable to `gemini.google.com` (domain/path scope would not deliver it to that host), or when `__Secure-1PSID` is absent. It MUST log at most one warning per process (tier 2) when the companion set (`SID`, `HSID`, `SSID`, `APISID`, `SAPISID`, `SIDCC`, `NID`) is absent - a hedge for un-ablated surfaces, never a gate. Local `expires` values MUST NOT be treated as a validity signal beyond routability.

#### Scenario: Tier 1 raises on missing PSIDTS
- **WHEN** a jar without `__Secure-1PSIDTS` is validated
- **THEN** validation rejects with the typed tier-1 error

#### Scenario: Tier 1 raises on present-but-unroutable PSIDTS
- **WHEN** the jar holds a `__Secure-1PSIDTS` whose domain scope would not be sent to `gemini.google.com`
- **THEN** validation rejects with the typed tier-1 error (routability, not name presence)

#### Scenario: Tier 2 warns once for a companion-less jar
- **WHEN** a jar with `__Secure-1PSID` + routable `__Secure-1PSIDTS` but no companions is validated twice in one process
- **THEN** validation passes both times and the tier-2 warning is logged exactly once

### Requirement: CookieSession.probe classifies live, phantom, or dead
The facade's `probe(profile)` MUST classify a profile read-only as `live` (init GET yields session tokens AND the probe's `listChats` call returns at least one chat), `phantom` (tokens present AND zero chats), or `dead` (init GET yields no session tokens). The probe's `listChats` call MUST be unbounded so the observed chat count is real — this is network-identical to a `limit: 1` call because the SDK fetches the full chat list and slices client-side, and the ≥-one-chat signal is identical either way. The facade MUST additionally expose `probeDetailed(profile)` returning `{ state, chatCount }` (the same single classification pass, with the observed chat count; `dead` reports `chatCount: 0` without consulting the chats probe), and MUST re-export the result type so command layers never import the classifier collaborator directly. Both probes MUST NOT write cookies, rotate, or spawn a browser, and MUST NOT use the SDK's `models()` as a signal (it is a static table). The classifier remains the only sanctioned session-state oracle.

#### Scenario: Phantom is distinguishable from dead
- **WHEN** the init GET extracts tokens but the probe's `listChats` call returns none
- **THEN** `probe` resolves `phantom` (and `probeDetailed` resolves `{ state: "phantom", chatCount: 0 }`); and when the init GET extracts no tokens, they resolve `dead` / `{ state: "dead", chatCount: 0 }`

#### Scenario: Probe is read-only
- **WHEN** `probe` or `probeDetailed` runs against any profile state
- **THEN** no cookie write occurs and no browser session is opened

#### Scenario: Detailed probe reports the observed chat count
- **WHEN** the init GET extracts tokens and the unbounded `listChats` probe observes N ≥ 1 chats
- **THEN** `probeDetailed` resolves `{ state: "live", chatCount: N }` and `probe` resolves `live`

### Requirement: CookieSession refresh-and-retry recovery rung
The `src/auth/recovery.ts` collaborator MUST implement a recovery operation that, given a degraded classification, runs the synchronous headless refresh (`BrowserRefresher.rotatePsidts` with the on-disk PSIDTS as baseline) under the caller-scoped session name `recover-<profile>`, persists via the full-jar writer, re-arms the session exactly once, and on failure throws the existing `AuthenticationError` type so the headed re-login prompt contract is preserved. The retry count MUST be exactly one.

Before opening any browser, the facade's `recover(profile)` MUST await an in-flight detached rotation (`rotationInFlight(profile)` → bounded `waitForRotation(profile)`); when the detached rotation lands during that wait, recovery MUST resolve the re-armed session without spawning or opening anything.

When the refresh reports `{ rotated: false }` (no PSIDTS change from baseline within the rotate budget), the thrown `AuthenticationError` MUST state the no-change-from-baseline condition and that the browser session appears signed out server-side, pointing at `gemiterm auth` - distinct from the transport-failure message, which wraps the underlying error.

#### Scenario: Recovery retries exactly once then throws
- **WHEN** recovery runs and the refresh reports `{ rotated: false }`
- **THEN** exactly one refresh attempt occurred and the operation rejects with `AuthenticationError` naming the no-change-from-baseline / signed-out-server-side condition

#### Scenario: Successful rotation restores the session
- **WHEN** the refresh rotates PSIDTS and re-arming succeeds
- **THEN** recovery resolves with the re-armed cookies and no error surfaces

#### Scenario: In-flight rotation satisfies recovery without a browser
- **WHEN** `recover(profile)` runs while `rotationInFlight(profile)` is true and the detached rotation lands during the bounded wait
- **THEN** recovery resolves the re-armed session, and no recovery browser session is opened

#### Scenario: Recovery never shares the runner's session name
- **WHEN** recovery proceeds to its own rotation
- **THEN** the refresher is driven with the session name `recover-<profile>`, never `refresh-<profile>`

### Requirement: PlaywrightCliDriver headless and storage-state surface
`PlaywrightCliDriver` MUST expose `openHeadless(url, profile, session?)` (identical argv to the headed form minus `--headed`), `stateSave(session, outputPath)` (wrapping `state-save <file>`), and MUST retain the auto-detect strategy selection and existing headed surface unchanged.

#### Scenario: Headless open omits the headed flag
- **WHEN** `openHeadless("https://gemini.google.com/app", "p", "s")` builds its argv
- **THEN** the args contain `open`, `--browser=chromium`, `--persistent`, `--profile=<profileDir>` and the app URL, and do NOT contain `--headed`

#### Scenario: State save passes the target path
- **WHEN** `stateSave("s", "out.json")` runs
- **THEN** the CLI receives `state-save` with `out.json` as its file argument

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

### Requirement: Session keepalive rotates PSIDTS on an interval
The auth module MUST provide a session-keepalive loop for the active profile that, while running, triggers the synchronous headless PSIDTS rotation every 10 minutes (600 s), reusing the fix-1 refresher and CAS persistence unchanged. A 60-second in-process floor MUST suppress any second rotation within the same window (including one initiated manually through the facade's `refresh`). Each tick MUST first compare the on-disk `__Secure-1PSIDTS` against the loop's last-observed baseline and skip the browser entirely when the value is already current; a rotation MUST only spawn when genuinely due. A failed tick (browser unavailable, timeout, or `rotated: false`) MUST log without prompting or throwing into any active session and MUST reschedule.

#### Scenario: Current PSIDTS skips the browser
- **WHEN** a keepalive tick runs and the on-disk `__Secure-1PSIDTS` matches the loop's last-observed baseline with a successful rotation younger than the interval
- **THEN** no browser session is opened and no write occurs

#### Scenario: Due rotation runs and persists
- **WHEN** a tick finds the baseline older than the interval
- **THEN** the synchronous headless rotation runs exactly once and any rotated jar persists through the CAS store

#### Scenario: The 60-second floor prevents double rotation
- **WHEN** a scheduled rotation completes and a manual `refresh` is invoked 30 seconds later
- **THEN** the manual call is suppressed by the floor within the same process

#### Scenario: Failed tick never surfaces into the session
- **WHEN** a rotation tick fails or reports `rotated: false`
- **THEN** no error or prompt reaches the caller, a diagnostic is logged, and the next tick is scheduled

### Requirement: CookieSession.captureLogin rejects with LoginCancelledError on browser close

`CookieSession.captureLogin(profile)` MUST classify any `PlaywrightCliError` whose stderr contains the markers `is not open` or `not found` (case-insensitive) as a browser-closed condition. On the first such error from `driver.cookieList`, the gate loop MUST throw `LoginCancelledError` (a new typed error in `src/core/errors.ts`) instead of retrying until the login timeout. The gate loop MUST emit exactly one info-level log line containing `Gate poll cancelled` per cancellation. The existing `LoginTimeoutError` timeout path MUST remain in effect for all other errors.

The capture `finally` MUST still invoke `driver.closeSession` (which already swallows the `not found` teardown error). `driver.cookieListFromState` and `cookieStore.saveFullJar` MUST NOT be invoked after a `LoginCancelledError`.

The CLI top-level handler (`src/cli/index.ts`) MUST log the `LoginCancelledError` message at info level and exit with code 0. All other errors MUST continue to follow the existing `Command '<name>' failed: <message>` + exit 1 path.

#### Scenario: Headed browser closed mid-poll cancels capture with a typed error

- **WHEN** `captureLogin("p")` is running and the headed browser is closed before the gate cookies appear
- **THEN** the call rejects with `LoginCancelledError` (NOT `LoginTimeoutError`); `driver.closeSession("p")` is invoked; `driver.cookieListFromState("p")` and `cookieStore.saveFullJar("p", ...)` are NOT invoked; exactly one info-level log line containing `Gate poll cancelled` is emitted; no debug-level `Gate poll failed` lines are emitted for the closed-browser error.

#### Scenario: Transient cookieList errors still poll until timeout

- **WHEN** `driver.cookieList` rejects with a `PlaywrightCliError` whose stderr contains neither marker
- **THEN** the gate loop continues polling and eventually rejects with `LoginTimeoutError` (no behavior change).

#### Scenario: isBrowserClosedError matches both known markers

- **WHEN** the classifier is given a `PlaywrightCliError` with stderr `Browser foo is not open` or `session not found`
- **THEN** it returns `true`; for any other stderr text or a non-`PlaywrightCliError` value it returns `false`.

#### Scenario: CLI exit semantics for cancellation

- **WHEN** `AuthCommand.execute` rejects with `LoginCancelledError`
- **THEN** the CLI logs the message at info level and exits with code 0; the generic `Command 'auth' failed` error path is not used.

