## ADDED Requirements

### Requirement: CookieSession Module

The system MUST provide a `CookieSession` class in `src/services/cookie-session.ts` that owns the entire cookie lifecycle behind a narrow interface: `ensureSession(profile)` (the only load path), `commit(profile, liveJar)` (the only persistence path), and `sessionStatus(profile)` (a pure read for status-style callers). The class MUST be constructed with injectable dependencies `{ cookieStorage, logger, clock?, rotator? }` where `clock` defaults to `Date.now` and `rotator` defaults to the in-repo `RotateCookies` POST. All cookie-name magic strings, the freshness threshold constant, and the expiry computation MUST live inside this module and nowhere else in `src/`.

#### Scenario: Module surface

- **WHEN** `src/services/cookie-session.ts` is inspected
- **THEN** it exports `CookieSession` exposing `ensureSession`, `commit`, and `sessionStatus`, and no other module in `src/` defines `COOKIE_EXPIRY_THRESHOLD_MS` or a `getCookieExpiry`/`checkCookieFreshness`/`validateCookies` implementation

#### Scenario: Injectable clock drives freshness decisions

- **WHEN** a `CookieSession` is constructed with a fake `clock` and a profile whose `__Secure-1PSIDTS` expires 3 days after the fake clock's value
- **THEN** freshness is computed against the injected time, and advancing the fake clock past the threshold flips the same persisted cookies from fresh to stale without waiting real time

### Requirement: ensureSession Is the Only Load Path

`CookieSession.ensureSession(profile)` MUST load the profile's persisted cookies, apply two-tier validation, run the recovery ladder when tier 2 is stale or missing, and resolve an `ActiveSession` carrying `{ cookies, secure1psid, secure1psidts, expiresAt }`. When tier 1 fails (no usable `__Secure-1PSID`) and the ladder cannot recover, the method MUST throw an `AuthenticationError` whose message names the profile and directs the user to `gemiterm auth`. No other module in `src/` may assemble per-profile API cookie pairs from persisted state except through this method.

#### Scenario: Valid persisted session resolves without writes

- **WHEN** `ensureSession("default")` is called and the persisted cookies pass both tiers
- **THEN** the method resolves with `secure1psid`/`secure1psidts` matching the stored values, `expiresAt` per the single expiry computation, and no storage write occurs

#### Scenario: Missing primary binding throws an actionable error

- **WHEN** `ensureSession("default")` is called and the persisted set has no `__Secure-1PSID`
- **THEN** the method throws an `AuthenticationError` whose message contains the profile name and the substring `gemiterm auth`

#### Scenario: Missing profile storage surfaces the existing load error

- **WHEN** `ensureSession("ghost")` is called and no storage file exists for the profile
- **THEN** the error carries the `No storage state found` semantics of `CookieStorage.load`

### Requirement: commit Is the Only Persistence Path

`CookieSession.commit(profile, liveJar)` MUST be the single way cookies are persisted anywhere in the codebase: it reads the persisted set, overlays the live jar's values onto matching cookie names (preserving each entry's domain/path/httpOnly/secure/sameSite metadata and every cookie name the jar does not track), validates the merged set, and writes only when the merged set passes tier 1 with a present (possibly stale) tier 2. When the merged set fails validation, the method MUST throw and leave the persisted file untouched. Persistence failures MUST NOT fail the triggering API operation (logged at debug level). `CookieStorage.save` MUST NOT be called from any `src/` module other than `CookieSession` (and `CookieStorage`'s own tests).

#### Scenario: Jar overlay preserves metadata and untracked names

- **WHEN** `commit("default", { "__Secure-1PSIDTS": "new-value" })` runs against a persisted set containing `__Secure-1PSID`, `__Secure-1PSIDTS` (with domain/path metadata), and `NID`
- **THEN** the saved file contains the new `__Secure-1PSIDTS` value on the original metadata-bearing entry, the unchanged `__Secure-1PSID` and `NID` entries, and remains a valid `{ cookies: [...] }` document

#### Scenario: No write when the jar changes nothing

- **WHEN** `commit` is called with a jar whose tracked values equal the persisted ones
- **THEN** no storage write occurs

#### Scenario: Invalid merged set leaves disk untouched

- **WHEN** `commit` is called with a jar whose merged set loses `__Secure-1PSID`
- **THEN** the method throws, and a subsequent load returns the pre-commit persisted set unchanged

#### Scenario: Commit failure never fails the API operation

- **WHEN** the underlying storage write throws during a post-API-call `commit`
- **THEN** the triggering Gemini API operation's result is returned normally and the failure is logged at debug level

### Requirement: Two-Tier Cookie Validation

Cookie validation MUST distinguish two tiers. Tier 1 (primary binding): the set contains a non-empty `__Secure-1PSID`; failure is terminal — no recovery rung can rescue the session. Tier 2 (secondary binding): the set contains a non-empty `__Secure-1PSIDTS` whose expiry is later than `now + 7 days` (the single freshness threshold); failure is recoverable via the recovery ladder. The freshness comparison MUST use the injected clock.

#### Scenario: Both tiers pass

- **WHEN** validation runs on a set with non-empty `__Secure-1PSID` and a `__Secure-1PSIDTS` expiring more than 7 days out
- **THEN** tier 1 and tier 2 both pass

#### Scenario: Stale secondary binding is recoverable, not terminal

- **WHEN** validation runs on a set with a valid `__Secure-1PSID` and a `__Secure-1PSIDTS` expiring within 7 days
- **THEN** tier 1 passes and tier 2 reports stale-recoverable

#### Scenario: Missing primary binding is terminal

- **WHEN** validation runs on a set with a valid `__Secure-1PSIDTS` and no `__Secure-1PSID`
- **THEN** tier 1 fails and no recovery is attempted

### Requirement: Typed Recovery Ladder

`ensureSession` MUST attempt recovery in a fixed rung order when tier 2 is stale or missing: (1) trust the persisted set when both tiers pass; (2) absorb — `commit` a caller-supplied live jar when it holds newer tracked values than disk, then re-validate; (3) rotate — POST `RotateCookies`, `commit` the rotated `__Secure-1PSIDTS`, re-validate; (4) fail — throw `AuthenticationError` naming the profile and the failing binding, directing to `gemiterm auth`. Each rung MUST log its outcome at debug level. A failed rung MUST fall through to the next; a failed rotation MUST NOT invalidate an otherwise tier-2-valid session.

#### Scenario: Ladder order is fixed

- **WHEN** tier 2 is stale and both an absorbable live jar and a working rotator are available
- **THEN** rung 2 (absorb) is attempted before rung 3 (rotate)

#### Scenario: Absorb rescues without network

- **WHEN** tier 2 is stale on disk but the caller-supplied jar holds a fresh `__Secure-1PSIDTS`
- **THEN** `commit` persists the fresh value, re-validation passes, and no rotation POST is made

#### Scenario: Failed rotation preserves a working session

- **WHEN** tier 2 passes marginally and the rotation POST fails
- **THEN** `ensureSession` still resolves with the persisted session and the failure is logged at debug level

#### Scenario: Terminal failure names the binding

- **WHEN** all applicable rungs are exhausted with tier 2 still failing
- **THEN** the thrown `AuthenticationError` names the profile and identifies `__Secure-1PSIDTS` as the failing binding

### Requirement: In-Repo RotateCookies Rotation

Proactive rotation MUST be implemented in-repo (the `gemini-web-sdk` exposes no rotation API) as a POST to `https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/RotateCookies` carrying a `Cookie` header built from the current tracked values, parsing the response for a rotated `__Secure-1PSIDTS`. Rotation MUST be attempted at most once per `ensureSession` invocation, only when tier 2 is stale or missing. Until the exact request envelope is verified against a live session (implementation task gate), rung 3 MUST be internally disabled, degrading the ladder to rungs 1→2→4 with behavior identical to the pre-change baseline. Rotation failures (network, non-success status, unparseable body) MUST count as a failed rung, never as a session invalidation.

#### Scenario: Stale tier 2 triggers one rotation attempt

- **WHEN** tier 2 is stale, rungs 1–2 cannot recover, and rung 3 is enabled
- **THEN** exactly one `RotateCookies` POST is made and its rotated `__Secure-1PSIDTS` is committed on success

#### Scenario: Disabled rung degrades to baseline behavior

- **WHEN** rung 3 is disabled and tier 2 is stale with no absorbable jar
- **THEN** no POST is made and `ensureSession` throws the actionable `AuthenticationError`, matching pre-change behavior

### Requirement: Single Expiry Computation

The session expiry of a cookie set MUST be computed by exactly one function inside `CookieSession`: the maximum positive `expires` (in ms) across the `__Secure-1PSID` and `__Secure-1PSIDTS` entries present in the set, or `null` when neither has a positive `expires`. `ProfileManager.getStatus`, `AuthService`'s confirmation reporting, and `ActiveSession.expiresAt` MUST consume this one function; no duplicate implementations may remain.

#### Scenario: Expiry is the max across tracked cookies

- **WHEN** the computation runs on a set whose `__Secure-1PSIDTS` expires in 10 minutes and whose `__Secure-1PSID` expires in 30 days
- **THEN** the result is the `__Secure-1PSID` expiry timestamp

#### Scenario: No positive expiry yields null

- **WHEN** the computation runs on a set where both tracked cookies have `expires <= 0` or are absent
- **THEN** the result is `null`
