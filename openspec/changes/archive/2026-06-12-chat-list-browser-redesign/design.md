# Design: chat-list-browser-redesign

## Browser interactions

### D1. Three toggle keys replace the sub-menu and `/` search

The browser binds three single-letter toggle keys: `s` cycles sort, `p` cycles profile, `f` toggles favourites. There are no sub-menus, no transient text-input modes, and no paged views.

**Why:** The inquirer-prompts browser had four independent interaction patterns (page navigation, sort sub-menu, `/` substring search, action sub-menu). For a chat-list with a few hundred items, page navigation and substring search add cognitive overhead without much payoff — the user is looking for a chat they recognise, not a needle in a haystack. Sort, profile, and favourites are the three actual decisions a human makes when narrowing a chat list; expressing them as one keystroke each is the minimum viable surface.

**Alternatives considered:**

- *Keep the sort sub-menu and add a profile sub-menu and a favourites sub-menu.* Rejected: three sub-menus is even worse than one.
- *Map `s` / `p` / `f` to single toggles with on/off semantics (e.g. `s` flips between recent and oldest).* Rejected: the three sort modes are not binary, and a `s` toggle that only flips between two modes hides `alpha`.
- *Use vim-style multi-key chords (`gs`, `gp`, `gf`).* Rejected: not discoverable from the hint line; the chat-list is not a context where vim fluency is assumed.

### D2. `s` cycles `recent` → `oldest` → `alpha` → `recent`

The cycle is a fixed order; there is no "back" key. The user can always reach any sort in two presses.

**Why:** Two presses is the worst case, and the cycle makes the next-state predictable from the hint line (no need to look at the title bar to know what `s` will do next). The order is the same as the non-interactive `--sort` flag's documented modes (`recent` is the default and the first option, then `oldest`, then `alpha`).

### D3. `p` cycles `["all", ...uniqueProfileNames]`

The cycle is built from the input chats at prompt-render time. `uniqueProfileNames` is the deduplicated list of `chat.profile` values that are not `undefined`, in the order each profile first appears in the input. The cycle wraps. When the cycle has only one element (`all` — i.e. no chat has a `profile` field), `p` is a no-op.

**Why:** Deriving the cycle from the input chats means the browser needs no `BrowserConfig.profileNames` field; the contract is "give me chats, I'll discover profiles." The order is deterministic (input order) so the cycle is predictable. A cycle of one is a clean no-op rather than an error.

### D4. `f` toggles a boolean

Pressing `f` flips the favourites filter. There is no "favourites on a specific profile" combination beyond the obvious — turning both filters on narrows to pinned chats in the selected profile.

**Why:** Favourites is a single binary decision. The combination with `p` is implicit and free.

### D5. All rows are rendered; no paging; the cursor does not wrap

`usePagination` is no longer used. The browser renders every filtered row joined by `\n`, and the cursor moves with `↑` / `↓` only. The cursor is clamped to `[0, filteredSorted.length - 1]`; pressing `↓` on the last row is a no-op, and pressing `↑` on the first row is a no-op. The `BrowserConfig` interface drops `pageSize` and `loop`.

**Why:** For the in-memory chat list (a few hundred items in the typical case), the cost of rendering every row is negligible, and removing the pagination concept removes a whole class of bugs (wrap-at-ends, "what page am I on", "the cursor fell off the bottom"). The `↑` / `↓` semantics become obvious.

### D6. `s` / `p` / `f` work even when the visible list is empty

The three toggle handlers run before the empty-list short-circuit. This means the user can always escape a filter combination that produced no matches: pressing `f` toggles favourites off, pressing `p` cycles to a profile with content.

**Why:** Without this, the only escape from an empty list would be `q` / `esc`, which kills the entire browser session. The user would have to re-launch the browser and re-apply all their previous filters. The fix is a 4-line placement change in the keypress handler.

### D7. The cursor stays on the same row index when sort / profile / favourites changes

When the filtered+sorted list re-derives from a state change, the active row's index is preserved, clamped to `filteredSorted.length - 1`.

**Why:** This matches the original inquirer-prompts design (scenario "Selecting a sort mode updates the list" in the abandoned spec). It also matches the user's mental model: "I'm on the third row, and the third row is still the third row in the new ordering." It also makes the `s` / `p` / `f` keys feel "live" — the user can scan across orderings without losing their place.

**Alternatives considered:**

- *Reset the cursor to row 0 on every state change.* Rejected: loses the user's place. Annoying on long lists.
- *Snap the cursor to the same chat by id.* Rejected: extra complexity, and on a re-sort the chat may now be at a different conceptual position; preserving the row index is more predictable.

### D8. `BrowserConfig` drops `pageSize`, `loop`, and `initialFilter`

Only `chats` and `initialSort` remain. The `initialFilter` field went away because `/` is gone; `pageSize` and `loop` went away because there is no pagination.

**Why:** A smaller interface is harder to misuse. The only in-tree caller (`list-command.ts`) was updated in the same commit.

### D9. `enter` on an empty list is a no-op

The original inquirer-prompts spec required this, but the implementation incorrectly resolved the prompt with `quit` on `enter` when the list was empty. The current implementation matches the spec.

**Why:** When the list is empty, the user can't pick a chat, so `enter` shouldn't do anything. The `q` / `esc` keys still quit.

## Carried over from `integrate-inquirer-prompts`

### D10. The prompts facade is the only importer of `@inquirer/prompts`

`src/cli/utils/prompts.ts` is the sole file in `src/` that imports from `@inquirer/prompts` or `@inquirer/core`. No command file imports from these packages directly. The mediation lint script (`.github/workflows/test.yml:23-29`) verifies this.

**Why:** A single importer means the cancel-to-`CancellationError` mapping, the shared theme, and the TTY gate are written once and applied uniformly. Command code is free of `@inquirer` knowledge and can be unit-tested with hand-written shims (the `promptInput` / `promptConfirmation` pattern on `AuthCommand` / `DeleteCommand` / `ProfileCommand`).

### D11. TTY gate, cancellation mapping, abort signal

Every facade function calls `requireTty` first. Every facade function catches `ExitPromptError` and `AbortPromptError` and rethrows a `CancellationError`. The facade exposes a module-level `AbortController` via `getAbortSignal` / `abortActivePrompts` / `resetAbortController` so the REPL can propagate Ctrl+C into in-flight model requests.

**Why:** TTY gating prevents the facade from blocking on `stdin` in a CI / pipe context. The cancellation mapping gives the calling command a single error type to handle (`CancellationError` extends `GemitermError`), so the command's "this is a clean exit, not a bug" branch is one `instanceof` check.

### D12. The interactive REPL uses the facade and accepts a `InteractiveLoopDeps` injection point

`src/cli/utils/interactive-prompt.ts` was rewritten from `node:readline` to the facade. The REPL takes an `InteractiveLoopDeps` parameter (with `prompt: (opts) => Promise<string>`, `messageHandler: (msg, signal) => Promise<void>`, `abortSignal: AbortSignal`) so unit tests can drive it without `mock.module` — which leaks across `*.test.ts` files in Bun.

**Why:** The original `mock.module`-based tests caused cross-file flakes (the `CancellationError` replacement would leak into other test files). DI keeps the test surface small and the cross-file behaviour predictable.

### D13. `--interactive` is additive; non-interactive `gemiterm list` is byte-equivalent

The `--interactive / -i` flag does not change the non-interactive `gemiterm list` output for any other flag combination. The flag conflicts with `--format` and `--path` (the conflict produces a clear stderr message and exit code 1). The flag requires a TTY.

**Why:** Additive flag = no surprises for existing users. Conflict detection is the cleanest way to express "this combination is meaningless" without making the parser reject a flag combination by accident.

### D14. The action menu is a separate `prompts.select` after the browser resolves

After the user picks a chat, the browser prompt resolves and the caller (`ListCommand.runInteractiveBrowser`) opens a 5-option `prompts.select` for the action (view, export-markdown, export-json, copy-id, back). This is a sequential prompt, not a nested prompt inside the browser, because `@inquirer/core` doesn't support two `createPrompt` instances alive at the same time.

**Why:** A nested prompt would need a custom readline bridge, which the framework explicitly discourages. A sequential prompt + a `while` loop in the caller is the documented pattern and works well with the `Quit` action (the loop exits cleanly with code 0).

### D15. The non-interactive `--search` flag is still forwarded to the mediator when `--interactive` is set

With `--interactive --search foo`, the `ListChatsQuery` mediator payload still carries `search: "foo"`, and the mediator returns only matching chats. The browser receives the filtered list as its `chats` argument. The browser's own client-side filters (`s` / `p` / `f`) then operate on top of the mediator-filtered list.

**Why:** This matches the non-interactive behaviour (where `--search` is just forwarded to the mediator) and means a script can pre-narrow the chat list before opening the browser, which is occasionally useful. It also means the `--search pre-fills the filter` scenario from the abandoned spec can be retired: there is no browser-side search input to pre-fill.
