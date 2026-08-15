## Context

Phase 1 of the architecture review (`docs/refactorings-phase-1.html`) landed: the mediator is gone, commands receive a `CliCommandContext` (`src/cli/command-registry.ts:16-21`, fields `{ verbose, profileAuthManager, getGeminiClient, listProfiles }`), arg parsing is shared (`src/cli/utils/command-args.ts`), and terminal input runs through `@inquirer/input`. This change is phase-2 item #2 (Profile Lifecycle), revalidated against that post-phase-1 state.

Ground truth (verified 2026-08-14):

- `auth-command.ts` = 443 lines; constructs `CookieStorage`, `ProfileManager`, `PlaywrightCliDriver`, `CookieMonitor`, `AuthService` inline at `:44-53`; never reads `context`.
- `status-command.ts` = 59 lines; constructs `CookieStorage` + `ProfileManager` inline at `:41-42`; never reads `context`.
- Profile-listing idiom duplicated: `auth-command.ts:173-192` ↔ `status-command.ts:43-54` (the `formatProfileTable` formatter itself is already shared in `src/infrastructure/formatters.ts`; the surrounding map-header-log idiom is the duplicate).
- `src/services/profile-service.ts` = 121 lines, **zero production callers** (only `tests/services/profile-service.test.ts` references it). It is not the thin 60-line pass-through the phase-2 doc claimed — it carries real `authenticate`/`buildCookieArray` logic — but it is dead, and a parallel `ProfileAuthManager` already sits on the context.
- `ProfileManager` lives in `src/infrastructure/storage.ts:79`. `AuthService` orchestrates the browser login flow. `install-browser`/`install-skills` also `new` services inline but are unrelated installers (out of scope).
- The main `commands` spec still carries a stale `ProfileCommand` requirement although `profile-command.ts` no longer exists — observed, deliberately out of scope for this change.

## Goals / Non-Goals

**Goals**

- One deep module owns the profile lifecycle: 6+1 operations behind `manageProfiles(action, params)`.
- End the service-locator pattern in `auth` and `status`; both become thin adapters over `context.profileLifecycle`.
- Delete dead `ProfileService` and its test.
- All-profiles iteration with warn-and-continue for `list`/`status` actions: no single bad profile aborts the batch.
- Byte-equivalent `auth`/`status` user-visible output.

**Non-Goals**

- No changes to the cookie/auth sensitive-area files themselves (`auth-service.ts`, `cookie-monitor.ts`, `cookie-storage-service.ts`, `playwright-cli-driver.ts`) — the module composes them as-is. The phase-2 #1 CookieSession deepening (deliberately skipped) owns that territory.
- No changes to `ProfileAuthManager` or conversation-owning-profile resolution (`resolveProfile`) — that is `src/cli/utils/profile-resolution.ts` territory, touched by change `refactorings-phase2-04`.
- No CLI flag changes, no output format changes.
- No touching `install-browser`/`install-skills` service-locator usage.
- No repair of the stale `ProfileCommand` spec requirement.

## Decisions

1. **Action-dispatch over a class-per-operation.** A single `manageProfiles(action: ProfileAction, params: ProfileActionParams)` with a `'list' | 'create' | 'delete' | 'rename' | 'set-default' | 'status' | 'auth'` union replaces 6+ scattered method surfaces. *Alternative:* plain class methods on a `ProfileLifecycle` service (no dispatch) — rejected because the phase-2 review's leverage argument (one union type + one method = the whole interface) holds: the union documents the full lifecycle in one place and makes the thin adapters trivially small.

2. **Module lives in `src/services/profile-lifecycle.ts`, wrapping — not moving — `ProfileManager`.** `ProfileManager` stays in `src/infrastructure/storage.ts` (path-mediation boundary). The module holds the only `new CookieStorage()` / `new ProfileManager()` / auth-stack constructions outside the composition root. *Alternative:* move `ProfileManager` into `services/` too — rejected; it drags `infrastructure/storage.ts` internals across the mediation boundary and widens this change.

3. **Reconcile with `ProfileAuthManager` by composition, not merger.** `ProfileAuthManager` (context-resident, conversation→profile routing) keeps its job. `ProfileLifecycle` owns CRUD + login flow + status. They share `ProfileManager` underneath. *Alternative:* fold both into one class — rejected; the two have different lifetimes and callers, and merging them couples CLI dispatch with auth routing.

4. **Delete `ProfileService` outright; absorb the useful bits.** The `authenticate` cookie-rebuild logic is superseded by `AuthService` + `CookieStorage` (its only distinct piece, `buildCookieArray`, duplicates cookie construction that the storage layer already performs). The profile-table idiom is re-homed in the `list`/`status` actions. *Alternative:* revive `ProfileService` as the module — rejected; it is dead, untested against real flows, and its name collides conceptually with `ProfileAuthManager`.

5. **Construction at the composition root.** `src/cli/index.ts` constructs `ProfileLifecycle` once with its concrete collaborators and puts it on `CliCommandContext` next to `profileAuthManager`. Commands never construct it. Tests inject fakes through the constructor. *Alternative:* lazy getter on the context (like `getGeminiClient`) — rejected; the profile lifecycle is cheap to construct and has no per-profile lazy semantics.

6. **Warn-and-continue semantics for `list`/`status`.** Statuses are collected per profile; a storage/cookie read failure for one profile logs `logger.warn` and yields a row with `exists: false` (or skips the row when even the directory is unreadable), then iteration continues. This mirrors the semantics change `refactorings-phase2-04` specs for chat listing; this change applies the same principle to profile listing.

## Risks / Trade-offs

- [Risk] Auth flows are the repo's sensitive area; moving 400 lines of auth-command logic could regress the login menu. → Mitigation: the module calls the exact same services with the exact same prompt shims; existing `tests/cli/commands/auth-command.test.ts` assertions (byte-level output) must pass unchanged before merge; re-read the four service-level test files listed in AGENTS.md if any service file ends up touched (none are planned).
- [Risk] `CliCommandContext` grows a field — every command signature still compiles, but test fixtures constructing contexts need the new field. → Mitigation: additive field; a test helper/factory default keeps fixture churn small.
- [Risk] Deleting `ProfileService` removes ~14 test references. → Mitigation: net test-count delta is recorded in tasks; baseline number updated in open changes' `tasks.md` if the total moves.
- [Risk] Two profile-ish managers (`ProfileLifecycle`, `ProfileAuthManager`) could drift. → Mitigation: decision 3 pins the boundary — CRUD/login/status vs conversation routing; documented in both modules' specs.

## Migration Plan

1. Land the module + context field + thin adapters in one change (no intermediate half-service state).
2. Delete `ProfileService` + its test in the same change (no dead-code window).
3. Rollback is a single revert — no persisted state, no config format change.

## Open Questions

- None blocking. (The action union includes `'auth'` so the login flow has a home in the module; if review prefers keeping the login flow as `AuthService` called directly from the module's `'create'` action, that is an internal detail invisible to the spec.)
