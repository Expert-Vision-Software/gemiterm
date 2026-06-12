# Tasks: chat-list-browser-redesign

> All tasks are complete. The implementation is on `enhance/ux-improvements` (commits `5cd8b56`, `d7bb5dd`, `9c370e7`, the no-paging refactor, and the `s` / `p` / `f` toggle refactor from this session). This change captures the design intent in the spec and re-baselines the work under a single focused change. The previous `integrate-inquirer-prompts` change is abandoned.

## 1. Browser redesign

- [x] 1.1 Drop `pageSize`, `loop`, and `initialFilter` from `BrowserConfig`.
- [x] 1.2 Drop `usePagination` import and the `usePagination({...})` call.
- [x] 1.3 Drop the `mode: 'browse' | 'search' | 'sort'` state, the `filter` and `searchInput` state.
- [x] 1.4 Add `profileFilter: 'all' | string` and `favoritesOnly: boolean` state.
- [x] 1.5 Add `profileNames` derived via `useMemo` (deduplicated, in input order).
- [x] 1.6 Update `filteredSorted` `useMemo` to filter by `profileFilter !== 'all' && c.profile !== profileFilter` and `favoritesOnly && !c.isPinned`.
- [x] 1.7 Add `s` key handler that cycles `sort` `recent` → `oldest` → `alpha` → `recent`.
- [x] 1.8 Add `p` key handler that cycles `profileFilter` through `['all', ...profileNames]`, wrapping, no-op when cycle is just `['all']`.
- [x] 1.9 Add `f` key handler that toggles `favoritesOnly`.
- [x] 1.10 Place the `s` / `p` / `f` handlers **before** the empty-list short-circuit so they work even when the visible list is empty (recovery from a bad filter combo).
- [x] 1.11 Drop the `/` key handler and the search-mode rendering branch.
- [x] 1.12 Drop the sort-sub-menu rendering branch.
- [x] 1.13 Drop the `n` / `p` / `g` / `G` key handlers and the wrap-at-ends behaviour.
- [x] 1.14 Fix the empty-list `enter` key: it is a no-op (the original inquirer-prompts spec required this; the implementation incorrectly resolved with `quit` before).
- [x] 1.15 Update the title bar to show chat count, sort mode, profile filter, and favourites state.
- [x] 1.16 Update the hint line to `↑↓ navigate · s sort · p profile · f favorites · enter pick · q quit`.
- [x] 1.17 In `src/cli/commands/list-command.ts`, drop `initialFilter: options.search || undefined` from the `browser({...})` call.

## 2. Tests — `tests/cli/utils/chat-list-browser.test.ts`

- [x] 2.1 Drop the `/ opens the search input, typing fills it, Enter narrows the list` test.
- [x] 2.2 Drop the `s opens the sort menu with three options` test.
- [x] 2.3 Add: `s` cycles `recent` → `oldest` → `alpha` → `recent` (title-bar assertions).
- [x] 2.4 Add: `s` keeps the cursor on the same row index when sort changes (clamped to new list length).
- [x] 2.5 Add: `p` cycles `all` → `work` → `personal` → `all` (using chats with a `profile` field).
- [x] 2.6 Add: `p` is a no-op when no chats have a `profile` field.
- [x] 2.7 Add: `f` toggles favourites on / off, narrowing the list to pinned chats.
- [x] 2.8 Add: `f` and `p` work even when the visible list is empty (recovery from a filter that produces no matches).
- [x] 2.9 Add: `p` and `f` combine — e.g. work + favourites shows only pinned work chats.
- [x] 2.10 Add a new `SAMPLE_CHATS_WITH_PROFILES` and `SAMPLE_CHATS_NO_PINNED` const for the profile- and favourites-specific tests.

## 3. Tests — `tests/cli/list-command.test.ts`

- [x] 3.1 Drop the `--interactive --search pre-fills the filter` test (the feature is gone; the `--search` flag is still forwarded to the mediator, just not pre-filled in the browser).

## 4. Prompt-layer facade (carried over from `integrate-inquirer-prompts`)

- [x] 4.1 Create `src/cli/utils/prompts.ts` as the sole importer of `@inquirer/prompts` and `@inquirer/core` in `src/`.
- [x] 4.2 Export `text`, `confirm`, `select` async wrappers (1:1 over `@inquirer/input`, `@inquirer/confirm`, `@inquirer/select`) that perform the TTY gate, pass the shared theme, and map cancellation to `CancellationError`.
- [x] 4.3 Export `NonInteractiveError` and `CancellationError` as `GemitermError` subclasses.
- [x] 4.4 Export `getAbortSignal` / `abortActivePrompts` / `resetAbortController` backed by a module-level `AbortController`.
- [x] 4.5 `requireTty(commandHint)` throws `NonInteractiveError` with a command-specific hint message when `process.stdin.isTTY !== true`.
- [x] 4.6 `mapCancellation(error)` catches `ExitPromptError` and `AbortPromptError` from `@inquirer/prompts` and rethrows `CancellationError`.
- [x] 4.7 `makeTheme({...})` with `chalk.cyan("?")` idle prefix, `chalk.green(figures.tick)` done prefix, `chalk.red` error styling, hidden `keysHelpTip`.
- [x] 4.8 Lint script `scripts/lint-path-mediation.sh` plus `.github/workflows/test.yml:23-29` enforce the single-importer rule.

## 5. Interactive prompt loop (carried over)

- [x] 5.1 Migrate `src/cli/utils/interactive-prompt.ts` from `node:readline` to the `prompts.text` facade.
- [x] 5.2 Add an `InteractiveLoopDeps` injection point (with `prompt`, `messageHandler`, `abortSignal`) so tests can drive the loop without `mock.module` (which leaks across files in Bun).
- [x] 5.3 Treat `CancellationError` from the prompt layer as a clean exit: print `chalk.dim("\nGoodbye.")` and resolve the loop.
- [x] 5.4 Surface validation errors from the prompt layer without consuming the user's message: re-prompt with the error visible.
- [x] 5.5 Recognise `/exit` and `/quit` as the only loop-terminating slash commands; treat empty input as a no-op that re-prompts.

## 6. Command migrations (carried over)

- [x] 6.1 `src/cli/commands/auth-command.ts`: keep the existing `promptInput` shim method, but have it delegate to `prompts.text`. No test-file changes.
- [x] 6.2 `src/cli/commands/delete-command.ts`: keep the existing `promptConfirmation` shim method, but have it delegate to `prompts.text` (with the same y/N parse the existing tests expect). No test-file changes.
- [x] 6.3 `src/cli/commands/profile-command.ts`: keep the existing `promptInput` shim method, but have it delegate to `prompts.text`. No test-file changes.
- [x] 6.4 `src/cli/commands/list-command.ts`: add the `--interactive / -i` flag. On a TTY, call `prompts.browser({ chats, initialSort })` in a `while` loop. Reject `--interactive` with `--format` or `--path` (stderr message + exit 1). On non-TTY, let the facade throw `NonInteractiveError` with `gemiterm list -i requires a TTY; use --format json for machine-readable output`.

## 7. Tests — prompt layer and REPL (carried over)

- [x] 7.1 `tests/cli/utils/prompts.test.ts` — TTY gate, error class hierarchy, abort signal helpers.
- [x] 7.2 `tests/cli/utils/interactive-prompt.test.ts` — REPL driven via the `InteractiveLoopDeps` injection point (slash commands, empty input, cancellation, validation).
- [x] 7.3 `tests/cli/utils/chat-list-browser.test.ts` — see section 2 above.
- [x] 7.4 `tests/cli/list-command.test.ts` — see section 3 above.
- [x] 7.5 `tests/integration/commands/list.test.ts` — `--interactive` flag does not affect the non-interactive `gemiterm list` output (byte-equivalence).

## 8. OpenSpec

- [x] 8.1 Abandon the previous `integrate-inquirer-prompts` change (directory removed from `openspec/changes/`).
- [x] 8.2 Create this change with `proposal.md`, `design.md`, `tasks.md`, and the four `specs/<capability>/spec.md` deltas.
- [x] 8.3 Sync the deltas to `openspec/specs/`:
  - `chat-list-browser/spec.md` — 8 ADDED requirements (opt-in, display + navigation, `s` cycle, `p` cycle, `f` toggle, action menu, exit, non-interactive contract)
  - `commands/spec.md` — 4 ADDED requirements (`ListCommand --interactive` flag, conflict detection, TTY requirement, byte-equivalence contract)
  - `interactive-prompt-loop/spec.md` — 4 ADDED requirements (TTY requirement with "readline interface" wording dropped, cancellation propagation, validation behaviour, slash-command contract)
  - `prompt-layer/spec.md` — 5 ADDED requirements (TTY gate, text/confirm/select exposure, cancellation mapping, shared theme, single-importer rule)
- [x] 8.4 `openspec validate` for all four capabilities is clean.
- [x] 8.5 `bun test` is 669 pass / 0 fail.
- [x] 8.6 `bun run typecheck` is clean.

The truncation requirement on `chat-list-browser` is owned by the `list-defaults-and-truncation` change and is not re-added here.
