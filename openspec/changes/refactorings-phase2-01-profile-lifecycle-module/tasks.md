## 1. Module foundation

- [ ] 1.1 Create `src/services/profile-lifecycle.ts` with the `ProfileAction` union (`'list' | 'create' | 'delete' | 'rename' | 'set-default' | 'status' | 'auth'`), the `ProfileActionParams` input types, and the `ProfileLifecycle` class exposing `manageProfiles(action, params)`. Constructor takes the collaborator set (`CookieStorage`, `ProfileManager`, `PlaywrightCliDriver`, `CookieMonitor`, `AuthService`, `Logger`) via DI for testability.
- [ ] 1.2 Implement the `list` action: map every configured profile to `{ ...profileManager.getStatus(name), isDefault: name === getDefaultProfileName() }`, print the `Profiles` header, render via `formatProfileTable`, log the active count; print the existing empty-profiles guidance when none exist. This is the single home for the idiom currently duplicated at `auth-command.ts:173-192` and `status-command.ts:43-54`.
- [ ] 1.3 Implement the `status` action: `ensureConfigDir()`, print the `Configuration` / `Directory: <configDir>` section, then the `list` table idiom; return a result instructing exit code 2 when no profiles exist; log the active count via `Logger.info`.
- [ ] 1.4 Implement the CRUD actions (`create`, `delete`, `rename`, `set-default`) with `validateProfileName` gates, the `[y/N]` delete confirmation, and byte-equivalent prompts/error messages lifted verbatim from `auth-command.ts`.
- [ ] 1.5 Implement the `auth` action: zero-profiles → create default + authenticate; one profile → authenticate it; multi-profile → the `[A]/[D]/[S]/[R]/[X]` menu loop with `formatProfileTable`, delegating the browser flow to `AuthService.authenticate`. Interactive prompts route through the existing `src/cli/utils/prompts.ts` facade (same shims the commands use today).

## 2. Warn-and-continue iteration

- [ ] 2.1 Wrap the per-profile status reads in `list`/`status` with warn-and-continue: a failing profile logs `logger.warn` naming the profile and iteration proceeds. Add the two `profile-lifecycle` spec scenarios to the test suite (one unreadable profile does not abort; all failing still completes).

## 3. Context wiring and thin adapters

- [ ] 3.1 Add `profileLifecycle: ProfileLifecycle` to `CliCommandContext` in `src/cli/command-registry.ts`; construct the module once in `src/cli/index.ts` (composition root) and place it on the context built at `src/cli/index.ts:107-112`.
- [ ] 3.2 Collapse `src/cli/commands/auth-command.ts` (443 lines) to a thin adapter: `AUTH_FLAGS`/usage via the shared arg parser + `context.profileLifecycle.manageProfiles("auth" | <menu action>, ...)`. No `new CookieStorage/ProfileManager/PlaywrightCliDriver/CookieMonitor/AuthService` may remain in the file.
- [ ] 3.3 Collapse `src/cli/commands/status-command.ts` (59 lines) to a thin adapter delegating to `manageProfiles("status", {})`, preserving the exit-code-2 contract. No `new CookieStorage`/`new ProfileManager` may remain in the file.

## 4. Dead-code removal

- [ ] 4.1 Delete `src/services/profile-service.ts` and `tests/services/profile-service.test.ts`. Confirm no `src/` import references `ProfileService` (only the test file does today).

## 5. Tests and gates

- [ ] 5.1 Create `tests/services/profile-lifecycle.test.ts` covering: all seven actions dispatch; unknown action throws `GemitermError`; `list` renders the table with `isDefault`; `create` validates names; `delete` confirmation declined prints `Cancelled.`; `set-default` calls both marker surfaces; `status` prints sections and signals exit 2 on empty; warn-and-continue scenarios.
- [ ] 5.2 Run `tests/cli/commands/auth-command.test.ts` and `tests/cli/commands/status-command.test.ts` unchanged — every existing assertion (menu text, tables, exit codes, prompts) must pass without editing expected output. Repoint any construction-level fixtures to inject a fake `ProfileLifecycle` via the context.
- [ ] 5.3 Run `bun test` — record the new baseline (657 pass / 0 fail minus the deleted profile-service tests plus the new profile-lifecycle tests) and update the baseline number in `openspec/changes/chat-list-bulk-actions/tasks.md` if the total moved.
- [ ] 5.4 Run `bun run typecheck` and `bash scripts/lint-path-mediation.sh` — both clean (module adds no `node:fs`/`node:path`/`node:os` imports; `ProfileManager` stays in `src/infrastructure/storage.ts`).
