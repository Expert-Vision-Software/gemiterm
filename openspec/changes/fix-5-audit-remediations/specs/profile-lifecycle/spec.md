# Delta: profile-lifecycle (fix-5-audit-remediations)

Truth-syncs three requirements off the deleted `AuthService`/`CookieMonitor` collaborators onto the `CookieSession` facade. Action surface, prompts, and output bytes are unchanged.

## MODIFIED Requirements

### Requirement: ProfileLifecycle Module Action-Dispatch Interface
The system MUST provide a `ProfileLifecycle` module in `src/services/profile-lifecycle.ts` exposing a single action-dispatch method `manageProfiles(action, params)`, where `action` is one of `'list' | 'create' | 'delete' | 'rename' | 'set-default' | 'status' | 'auth'`. The module MUST own all profile I/O (delegating to `ProfileManager`), the login browser flow (delegating to the injected `CookieSession`'s `captureLogin`), default-profile marker management, and status reporting (including the read-only session probe via `CookieSession.probeDetailed`). The module MUST receive `ProfileManager`, `CookieSession`, and its logger through its deps-object; it MUST NOT construct browser drivers, cookie monitors, or legacy auth services (none exist in the codebase).

#### Scenario: Dispatch table covers the action union
- **WHEN** `manageProfiles("status", { verbose: true })` is invoked
- **THEN** the status action enumerates profiles through `ProfileManager` and enriches each with `cookieSession.probeDetailed(name)` results

#### Scenario: Login flows route through the auth facade
- **WHEN** the `create` or `auth` action triggers browser-driven authentication
- **THEN** the login is delegated to `cookieSession.captureLogin` and the module never references an `AuthService` or `CookieMonitor`

### Requirement: ProfileLifecycle CRUD Actions Delegate With Validation
The `create` action MUST validate the profile name via `validateProfileName`, create the profile via `ProfileManager.create` when absent, and delegate the login flow to `CookieSession.captureLogin`. The `auth` action MUST support renewal of an existing profile via `captureLogin(profile, { mode: "renew" })`, throwing `Profile '<name>' does not exist.` when the named profile is absent. The `delete` action MUST require a `[y/N]` confirmation before calling `ProfileManager.delete`. The `rename` action MUST validate both names and call `ProfileManager.rename(old, new)`. The `set-default` action MUST call both `ProfileManager.setDefault` and `setDefaultProfileName`. All user-visible prompts, confirmations, and error messages MUST be byte-equivalent to the pre-change `auth`-menu and `status` behaviors.

#### Scenario: Create validates then logs in through the facade
- **WHEN** `manageProfiles("create", { name: "work" })` runs and "work" does not exist
- **THEN** `ProfileManager.create("work")` is called and `cookieSession.captureLogin("work")` completes the login

#### Scenario: Renew rejects an unknown profile
- **WHEN** `manageProfiles("auth", { renewProfile: "ghost" })` runs and "ghost" is not stored
- **THEN** a `GemitermError` with message `Profile 'ghost' does not exist.` is thrown and no browser opens

### Requirement: ProfileLifecycle Is Context-Injected, Not Service-Located
The `ProfileLifecycle` instance MUST be constructed once in `src/cli/index.ts` (the composition root, alongside `createCookieSession`) and carried on `CliCommandContext` as `profileLifecycle`. The `auth` and `status` commands MUST obtain the module exclusively from `context.profileLifecycle` and MUST NOT construct `ProfileManager`, `CookieSession`, or any browser/auth collaborator themselves.

#### Scenario: Commands contain no service-locator expressions
- **WHEN** `src/cli/commands/auth-command.ts` and `src/cli/commands/status-command.ts` are inspected
- **THEN** they contain no `new ProfileManager`, `new CookieStorage`, `createCookieSession(`, or driver-construction expression; every dependency arrives via `context`
