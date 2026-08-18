## ADDED Requirements

> 2026-08-18: the wait-ceiling figure in this delta was superseded by
> `fix-rotation-dead-end` (archived `2026-08-18-fix-rotation-dead-end`), which
> raised the default 30 s -> 90 s and synced this requirement into
> `openspec/specs/auth/spec.md` in its modified form. The text below mirrors
> the synced main-spec requirement so archiving this change cannot regress it.

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
