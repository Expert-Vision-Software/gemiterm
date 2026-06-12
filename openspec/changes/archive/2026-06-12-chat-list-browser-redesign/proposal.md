# Proposal: chat-list-browser-redesign

## Why

The previous `integrate-inquirer-prompts` change shipped a TUI chat-list browser with three separate interaction patterns: a sort sub-menu (`s` → pick 1/2/3), a `/` substring search input, and a paged list (`n`/`p`/`g`/`G`). User feedback is that this is over-engineered: a human navigating their chats only needs to switch sort modes, scope by profile, and find pinned chats. Three toggle keys are simpler and more direct.

This change replaces the inquirer-prompts browser redesign with a toggle-driven one, and re-scopes the carried-over prompt-layer work (text/confirm/select facade, TTY gate, cancellation mapping, REPL migration) under a single focused change.

## What changes

### Browser redesign (replaces the inquirer-prompts browser)

- `s` cycles the sort mode: `recent` → `oldest` → `alpha` → `recent`. No sub-menu.
- `p` cycles the profile filter: `all` → each profile (in order of first appearance, deduplicated) → `all`.
- `f` toggles the favourites filter (`isPinned === true` only).
- `/` is removed. The non-interactive `--search` flag is still forwarded to the mediator; the browser no longer has its own substring-search input.
- Paging is gone. The browser renders every filtered row in a single scrollable view; the user navigates with `↑`/`↓`.
- `n` / `p` / `g` / `G` are removed. There is no wrap-at-ends (the cursor stops at the first and last row).
- The hint line simplifies to `↑↓ navigate · s sort · p profile · f favorites · enter pick · q quit`.
- The title bar shows the chat count, the current sort mode, the current profile filter, and the current favourites state.
- `s` / `p` / `f` work even when the visible list is empty, so the user can recover from a filter combination that produced no matches.
- `BrowserConfig` drops `pageSize`, `loop`, and `initialFilter`. `usePagination` is no longer used in `src/cli/utils/prompts.ts`.
- Bonus fix that the original spec already required: `enter` on an empty list is a no-op (it was previously resolving with `quit`, contradicting the spec).

### Carried over from `integrate-inquirer-prompts` (unchanged, re-scoped under this change)

- `src/cli/utils/prompts.ts` is the only module in `src/` that imports from `@inquirer/prompts` or `@inquirer/core`. All command-layer prompts (`auth`, `delete`, `profile`, the chat REPL, the browser) go through this facade.
- The facade exposes `text`, `confirm`, `select`, and `browser` (async wrappers), plus the `browserPrompt` raw `createPrompt` for unit tests. It also exports `NonInteractiveError`, `CancellationError`, `getAbortSignal`, `abortActivePrompts`, and `resetAbortController`.
- Every facade function performs a TTY gate (`process.stdin.isTTY === true`) and throws `NonInteractiveError` with a command-specific hint if the check fails.
- Every facade function maps `ExitPromptError` and `AbortPromptError` from `@inquirer/prompts` to a single `CancellationError` (a `GemitermError` subclass).
- `src/cli/utils/interactive-prompt.ts` (the chat REPL) routes through the facade instead of `node:readline`. It takes a `InteractiveLoopDeps` injection point so tests can drive it without `mock.module` leakage.
- `src/cli/commands/{auth,delete,profile}-command.ts` each keep their existing `promptInput` / `promptConfirmation` shim methods, but the shims delegate to the facade. No test files needed to change.
- `gemiterm list --interactive / -i` enters the browser. The flag is additive: the non-interactive forms of `gemiterm list` are byte-equivalent to the pre-change baseline. The flag conflicts with `--format` and `--path` (prints `Cannot use --interactive with --format or --path.` to stderr and exits 1). The flag requires a TTY; the facade throws `NonInteractiveError` with `gemiterm list -i requires a TTY; use --format json for machine-readable output` on non-TTY.
- `--search` is still forwarded to the mediator in both the interactive and non-interactive paths. The browser doesn't pre-fill a search input; it just receives the mediator-filtered chats.
- `--sort` still pre-selects the initial sort in the browser.

### Files affected

Code:
- `src/cli/utils/prompts.ts` — browser refactor (remove `usePagination` + `pageSize`/`loop`/`initialFilter` + `/` and sort-mode state + their render branches; add `profileFilter` + `favoritesOnly` state + `s`/`p`/`f` key handlers + new title bar / hint line + empty-state `enter` no-op)
- `src/cli/commands/list-command.ts` — drop `initialFilter: options.search || undefined` from the `browser({...})` call

Tests:
- `tests/cli/utils/chat-list-browser.test.ts` — drop `/` test, drop sort-submenu test, add sort cycle / sort-cursor-clamp / profile cycle / profile no-op / favourites toggle / favourites+profile combine / empty-state recovery
- `tests/cli/list-command.test.ts` — drop the `--interactive --search pre-fills the filter` test (feature is gone)

OpenSpec deltas (under `openspec/changes/chat-list-browser-redesign/specs/`):
- `chat-list-browser/spec.md` — 8 ADDED requirements (opt-in via `--interactive`, display with cursor navigation, `s` cycle sort, `p` cycle profile, `f` toggle favourites, action menu after pick, exit cleanly, non-interactive contract)
- `commands/spec.md` — 4 ADDED requirements (`ListCommand --interactive flag`, `ListCommand --interactive conflict detection`, `ListCommand --interactive TTY requirement`, `ListCommand non-interactive byte-equivalence contract`)
- `interactive-prompt-loop/spec.md` — 4 ADDED requirements (TTY requirement, cancellation propagation, validation behaviour, slash-command contract); the TTY requirement text drops the "readline interface" wording since the code now goes through `@inquirer/prompts`
- `prompt-layer/spec.md` — 5 ADDED requirements (TTY gate, text/confirm/select exposure, cancellation mapping, shared theme, single-importer rule)

The truncation requirement on `chat-list-browser` is already in main from the `list-defaults-and-truncation` change and is not re-added here.

## Impact

- All 669 existing tests pass after the refactor (5 new tests added in `tests/cli/utils/chat-list-browser.test.ts`, 1 obsolete test removed from `tests/cli/list-command.test.ts`).
- No public API change. The `BrowserConfig` interface shrinks (drops 3 optional fields), which is technically a breaking change for any external caller, but the only in-tree caller is `list-command.ts` and it was updated in the same commit.
- The implementation is already done on `enhance/ux-improvements` (commits `5cd8b56`, `d7bb5dd`, `9c370e7`, the no-paging refactor, and the `s`/`p`/`f` toggle refactor). This change captures the design intent in the spec and re-baselines the work under a single focused change. The previous `integrate-inquirer-prompts` change is abandoned.
- `bun test`, `bun run typecheck`, and `openspec validate <capability>` for all four touched capabilities are clean.
