# auth

## MODIFIED Requirements

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
