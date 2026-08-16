# Delta: auth (fix-3b-auth-regressions)

Closes the fix-3 review gaps on the auth surface. The session-keepalive requirement added by fix-3 (including its shared-floor clause covering manual `refresh`) is already correctly worded and needs no text change — this change implements it. The facade's exposed surface changes: the collaborator pass-through getters are replaced by a keepalive factory.

## MODIFIED Requirements

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
