# Delta: auth (fix-1-cookie-session-core)

Replaces the scattered five-module auth implementation with a single `CookieSession` facade backed by browser-based PSIDTS rotation, a CAS cookie store, and ablation-derived validation. Evidence: `docs/cookie-ablation-findings.md` (2026-08-15). AuthCommand menu behaviors are unchanged.

## REMOVED Requirements

### Requirement: AuthService.authenticate orchestrates the full login flow
**Reason**: `AuthService` is deleted; its responsibilities (headed browser launch, login wait, cookie persistence, expiry computation) move to `CookieSession.captureLogin` with a structurally different capture contract: the login gate is a poll for `__Secure-1PSID` + `__Secure-1PSIDTS` presence, but the persisted payload is the complete browser jar captured via `state-save` (the name-filtered payload here was the H6 capture-trim root cause).
**Migration**: See `CookieSession facade is the single authentication surface` and `CookieSession.captureLogin captures the full browser jar (gate is not payload)` (ADDED). The 5-minute timeout, headed-browser notification, and browser-closed-in-finally semantics are preserved in the new requirements.

### Requirement: AuthService prints headed-browser notification (no Enter-block)
**Reason**: Deleted with `AuthService`; the notification moves into `captureLogin` unchanged in substance (one-shot console output, no input blocking).
**Migration**: See the notification scenario under `CookieSession.captureLogin captures the full browser jar (gate is not payload)` (ADDED).

### Requirement: AuthService prints a confirmation with cookie count and expiry
**Reason**: Deleted with `AuthService`; the confirmation (cookie count, `__Secure-1PSID` presence marker, PSIDTS-derived expiry) is emitted by `captureLogin`.
**Migration**: See the confirmation scenarios under `CookieSession.captureLogin captures the full browser jar (gate is not payload)` (ADDED).

### Requirement: CookieMonitor polls every 2 seconds using a sign-out-link JS probe
**Reason**: `CookieMonitor` is deleted. Its sign-out-link DOM probe was a UI-drift-fragile login gate, and its name filter (`REQUIRED_COOKIES`) truncated every captured jar to 2 cookies (the H6 root cause, live at `cookie-monitor.ts:110,151,157`). The new gate polls `cookie-list` for cookie presence only - no DOM probe.
**Migration**: See `BrowserRefresher rotates PSIDTS via headless persistent-profile page load` and `CookieSession.captureLogin captures the full browser jar (gate is not payload)` (ADDED).

### Requirement: CookieMonitor exposes checkLoggedIn and checkCookies helpers
**Reason**: Deleted with `CookieMonitor`; no consumer survives the cutover. Cookie-presence checks are internal to the refresher/capture gate.
**Migration**: See the gate scenarios under `CookieSession.captureLogin captures the full browser jar (gate is not payload)` (ADDED).

### Requirement: CookieMonitor.stop is idempotent and clears the interval
**Reason**: Deleted with `CookieMonitor`; interval lifecycle moves to `BrowserRefresher`, which MUST close the browser session in a `finally` block on every exit path.
**Migration**: See the timeout/finally scenarios under `BrowserRefresher rotates PSIDTS via headless persistent-profile page load` (ADDED).

### Requirement: CookieStorageService loads and validates per-profile cookies
**Reason**: `CookieStorageService` is deleted; loading and validation split into `CookieStore` (IO + CAS) and `CookieValidator` (two-tier, ablation-derived). The 7-day freshness threshold is retired as meaningless (local `expires` values are provably not a validity signal).
**Migration**: See `CookieStore performs snapshot/delta CAS saves` and `CookieValidator enforces two-tier session validation` (ADDED).

### Requirement: CookieStorageService validates and computes cookie freshness
**Reason**: Same deletion; the freshness model changes from a local 7-day threshold to the two-tier routability model (tier-1: PSIDTS routable to `gemini.google.com`; tier-2: companion warn).
**Migration**: See `CookieValidator enforces two-tier session validation` (ADDED).

### Requirement: CookieStorageService computes cookie expiry
**Reason**: Same deletion; expiry computation survives only as the login confirmation's display value derived from `__Secure-1PSIDTS.expires` inside `captureLogin`.
**Migration**: See the confirmation scenario under `CookieSession.captureLogin captures the full browser jar (gate is not payload)` (ADDED).

### Requirement: CookieStorageService persists refreshed session cookies
**Reason**: Same deletion; persistence of rotated cookies is owned by `CookieStore` CAS saves driven by `BrowserRefresher`, with the stale-overwrite-fresh hazard structurally prevented (snapshot/delta compare-and-swap).
**Migration**: See `CookieStore performs snapshot/delta CAS saves` (ADDED).

### Requirement: ProfileAuthManager.ensureAuthenticated returns cookies or throws
**Reason**: `ProfileAuthManager` is deleted; its naive gate (local validity + throw) is replaced by `CookieSession.ensureSession`, which arms from disk with zero network latency, triggers opportunistic detached refresh on stale jars, and defers session-death judgment to the classifier and recovery rung.
**Migration**: See `CookieSession.ensureSession arms from the on-disk jar` and `CookieSession refresh-and-retry recovery rung` (ADDED). The `AuthenticationError` -> headed re-login prompt contract is preserved.

### Requirement: ProfileAuthManager.getActiveProfiles filters to valid sessions
**Reason**: Deleted with `ProfileAuthManager`; the enumeration moves to the facade and is backed by the read-only classifier instead of local freshness checks.
**Migration**: See `CookieSession.probe classifies live, phantom, or dead` (ADDED) - `activeProfiles` is its enumeration consumer.

### Requirement: ProfileAuthManager.findProfileForConversation returns the profile that owns the conversation
**Reason**: Deleted with `ProfileAuthManager`; conversation-profile routing moves to the facade with unchanged semantics (iterate active profiles, probe conversation ownership).
**Migration**: See `CookieSession facade is the single authentication surface` (ADDED) - `findProfileForConversation` is a facade-level operation delegating to the same collaborator set; its observable contract (returns the owning profile name or null) is unchanged.

## ADDED Requirements

### Requirement: CookieSession facade is the single authentication surface
The `src/auth/cookie-session.ts` module MUST expose a `CookieSession` facade as the only authentication surface consumed by the CLI. The facade MUST expose `ensureSession(profile)`, `captureLogin(profile)`, `probe(profile)`, `refresh(profile)`, `activeProfiles()`, and `findProfileForConversation(conversationId)`, and MUST accept all collaborators (`BrowserRefresher`, `CookieStore`, `CookieValidator`, recovery rung, logger) through a single `CookieSessionDeps` deps-object so the implementation is replaceable at the seam. No file outside `src/auth/` may import the collaborators directly.

#### Scenario: Facade wires collaborators from a deps-object
- **WHEN** a `CookieSession` is constructed with fakes for every collaborator in `CookieSessionDeps`
- **THEN** `ensureSession`, `captureLogin`, `probe`, and `refresh` each complete using only the injected fakes (no direct construction of concrete collaborators inside the facade)

#### Scenario: Conversation routing contract is preserved
- **WHEN** `findProfileForConversation("<cid>")` is called and exactly one active profile's client reports owning the conversation
- **THEN** it resolves that profile's name; and when no active profile owns it, it resolves `null`

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
The `src/auth/browser-refresher.ts` collaborator MUST provide `rotatePsidts(profile, baselineValue, timeoutMs = 60000)`: open the persistent-profile browser headless (`open --browser=chromium --persistent --profile=<profileDir>` without `--headed`) at `https://gemini.google.com/app`, poll the cookie list until the `__Secure-1PSIDTS` value differs from `baselineValue` or the timeout elapses, capture the full state via `state-save`, persist through the store's full-jar writer with the domain filter, and close the session in a `finally` block. On timeout or unchanged PSIDTS it MUST resolve `{ rotated: false }` without throwing and without persisting.

#### Scenario: Rotation detected and persisted
- **WHEN** the headless page's cookie list reports an `__Secure-1PSIDTS` value different from the baseline within 60 seconds
- **THEN** the full jar is persisted via the full-jar writer and the result is `{ rotated: true }`

#### Scenario: Timeout closes the browser and persists nothing
- **WHEN** PSIDTS never changes before the timeout
- **THEN** the browser session is closed, no jar write occurs, and the result is `{ rotated: false }`

#### Scenario: Refresh preserves companion cookies
- **WHEN** a rotation is persisted
- **THEN** the stored jar still contains cookies the refresher did not rotate (e.g. `SID`, `HSID`, `APISID`) - the full-jar writer replaces, never trims

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
The facade's `probe(profile)` MUST classify a profile read-only as `live` (init GET yields session tokens AND `listChats({limit:1})` returns at least one chat), `phantom` (tokens present AND zero chats), or `dead` (init GET yields no session tokens). The probe MUST NOT write cookies, rotate, or spawn a browser, and MUST NOT use the SDK's `models()` as a signal (it is a static table). This is the only sanctioned session-state oracle.

#### Scenario: Phantom is distinguishable from dead
- **WHEN** the init GET extracts tokens but `listChats({limit:1})` returns none
- **THEN** `probe` resolves `phantom`; and when the init GET extracts no tokens, it resolves `dead`

#### Scenario: Probe is read-only
- **WHEN** `probe` runs against any profile state
- **THEN** no cookie write occurs and no browser session is opened

### Requirement: CookieSession refresh-and-retry recovery rung
The `src/auth/recovery.ts` collaborator MUST implement a recovery operation that, given a degraded classification, runs the synchronous headless refresh (`BrowserRefresher.rotatePsidts` with the on-disk PSIDTS as baseline), persists via the full-jar writer, re-arms the session exactly once, and on failure throws the existing `AuthenticationError` type so the headed re-login prompt contract is preserved. The retry count MUST be exactly one.

#### Scenario: Recovery retries exactly once then throws
- **WHEN** recovery runs and the refresh reports `{ rotated: false }`
- **THEN** exactly one refresh attempt occurred and the operation rejects with `AuthenticationError`

#### Scenario: Successful rotation restores the session
- **WHEN** the refresh rotates PSIDTS and re-arming succeeds
- **THEN** recovery resolves with the re-armed cookies and no error surfaces

### Requirement: PlaywrightCliDriver headless and storage-state surface
`PlaywrightCliDriver` MUST expose `openHeadless(url, profile, session?)` (identical argv to the headed form minus `--headed`), `stateSave(session, outputPath)` (wrapping `state-save <file>`), and MUST retain the auto-detect strategy selection and existing headed surface unchanged.

#### Scenario: Headless open omits the headed flag
- **WHEN** `openHeadless("https://gemini.google.com/app", "p", "s")` builds its argv
- **THEN** the args contain `open`, `--browser=chromium`, `--persistent`, `--profile=<profileDir>` and the app URL, and do NOT contain `--headed`

#### Scenario: State save passes the target path
- **WHEN** `stateSave("s", "out.json")` runs
- **THEN** the CLI receives `state-save` with `out.json` as its file argument
