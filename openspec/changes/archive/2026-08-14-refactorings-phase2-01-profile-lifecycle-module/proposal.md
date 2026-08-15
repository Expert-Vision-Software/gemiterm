## Why

After the phase-1 refactorings (mediator removal, shared arg parsing, `@inquirer/input`), every command except `auth` and `status` receives its dependencies through the shared `CliCommandContext`. `auth-command.ts` (443 lines) and `status-command.ts` (59 lines) still use the service-locator pattern — they `new` their own `CookieStorage`, `ProfileManager`, `PlaywrightCliDriver`, `CookieMonitor`, and `AuthService` inline (`auth-command.ts:44-53`, `status-command.ts:41-42`) and ignore every `CliCommandContext` field. The profile-listing idiom (map to statuses, print `Profiles` header, render `formatProfileTable`, log active count) is duplicated between `auth-command.ts:173-192` and `status-command.ts:43-54`. Meanwhile `src/services/profile-service.ts` (121 lines) is **dead code** — zero production callers; only its own test file references it — and a parallel `ProfileAuthManager` already lives on the context. The profile lifecycle has no single home.

This is item #2 of `docs/refactorings-phase-2.html` (architecture review 2026-08-12), revalidated against the post-phase-1 codebase.

## What Changes

- **New `ProfileLifecycle` module** (`src/services/profile-lifecycle.ts`) behind a single action-dispatch interface: `manageProfiles(action, params)` where `action ∈ 'list' | 'create' | 'delete' | 'rename' | 'set-default' | 'status' | 'auth'`. The module owns all profile I/O (via `ProfileManager`), the login browser flow (delegating to `AuthService`), default-profile marker management, and cookie validation for auth status. It hides the cookie-name constants, freshness rules, and storage details behind the action surface.
- **`CliCommandContext` gains `profileLifecycle`** — constructed once in `src/cli/index.ts` and injected, ending the service-locator pattern for auth/status.
- **`auth-command.ts` and `status-command.ts` become thin adapters** (~20/~15 lines of dispatch) that parse args and call `context.profileLifecycle.manageProfiles(...)`. User-visible output (menu text, tables, exit codes, prompts) MUST remain byte-equivalent to the current baseline.
- **Delete the dead `ProfileService`** (`src/services/profile-service.ts`, 121 lines) and its test file `tests/services/profile-service.test.ts` — cleanup, not a deepening win. Its still-valuable behaviors (profile-table idiom, status mapping) are absorbed into `ProfileLifecycle`.
- **All-profiles iteration with warn-and-continue** — the `list` and `status` actions iterate **all** configured profiles (active and inactive); a profile whose storage cannot be read logs a warning and is skipped while the remaining profiles continue. Nothing in the profile-lifecycle path aborts on a single bad profile.
- Out of scope: `install-browser` / `install-skills` also `new` services inline, but they are unrelated installer commands — not touched by this change.

## Capabilities

### New Capabilities

- `profile-lifecycle`: The `ProfileLifecycle` module — the single home for profile CRUD (list / create / delete / rename / set-default), the auth login flow delegation, status reporting, and the all-profiles warn-and-continue iteration contract. Covers the action-dispatch interface, the thin-adapter wiring through `CliCommandContext`, and the byte-equivalence of `auth` / `status` output.

### Modified Capabilities

- `commands`: `AuthCommand` and `StatusCommand` requirements change at the spec level — they MUST delegate to `context.profileLifecycle.manageProfiles(...)` instead of constructing services inline; all user-visible behavior (menu options, prompts, table output, exit codes) is preserved. The `CommandRegistry` requirement's `CliCommandContext` field list gains `profileLifecycle`.
- `profiles`: All seven `ProfileService.*` requirements are REMOVED — `ProfileService` is dead code with zero production callers; its behaviors move into the `profile-lifecycle` capability. Migration notes point each removed requirement at its replacement.

## Impact

- **Code touched**
  - `src/services/profile-lifecycle.ts` — **new** module (action-dispatch interface + implementations).
  - `src/cli/command-registry.ts` — `CliCommandContext` gains `profileLifecycle: ProfileLifecycle`.
  - `src/cli/index.ts` — construct `ProfileLifecycle` once (wrapping `CookieStorage`, `ProfileManager`, `PlaywrightCliDriver`, `CookieMonitor`, `AuthService`) and add it to the context.
  - `src/cli/commands/auth-command.ts` — 443-line class collapses to a thin adapter (arg handling + action dispatch); menu flows move into the module.
  - `src/cli/commands/status-command.ts` — 59-line class collapses to a thin adapter.
  - `src/services/profile-service.ts` — **deleted** (dead code).
  - `tests/services/profile-service.test.ts` — **deleted** with it.
  - `tests/cli/commands/{auth-command,status-command}.test.ts` — re-pointed at the module; existing output assertions must pass unchanged.
  - `tests/services/profile-lifecycle.test.ts` — **new**.
- **APIs / public surface** — `CliCommandContext` gains one field (additive; all 12 command classes still compile). No CLI flags change; `gemiterm auth` / `gemiterm status` output is byte-equivalent.
- **Sensitive areas** — `auth-service.ts`, `cookie-monitor.ts`, `cookie-storage-service.ts`, `playwright-cli-driver.ts` are NOT modified; `ProfileLifecycle` composes them exactly as `auth-command.ts` does today. The prompt layer facade (`src/cli/utils/prompts.ts`) continues to own all interactive prompts; the module's interactive actions call through the existing shims.
- **Path mediation** — `ProfileManager` stays in `src/infrastructure/storage.ts`; `ProfileLifecycle` consumes it from `src/services/` without moving storage code across the boundary. No new `node:fs`/`node:path`/`node:os` imports outside the two exempt files.
- **Dependencies** — none. All work is in-tree.
- **Test baseline** — current baseline is 657 pass / 0 fail; net count shifts by (new profile-lifecycle tests) − (deleted profile-service tests). Update the baseline number in any open change's `tasks.md` if the count moves.
