# Page the `gemiterm list -i` chat-list browser

## Why

`gemiterm list -i` (the only entry point to the chat-list TUI, per `AGENTS.md`) renders every chat into a single frame via `filteredSorted.map(...).join("\n")` at `src/cli/utils/prompts.ts:295-297`. With a few hundred conversations the listing scrolls past the visible terminal area, the cursor (driven by the `active` state) falls off-screen, and the user cannot see where they are. Up/down navigation still works, but the visible-list model breaks.

The codebase already ships the in-tree primitive needed: `@inquirer/core` v11.2.1 exports `usePagination` (verified at `node_modules/@inquirer/core/dist/lib/pagination/use-pagination.d.ts`), which `@inquirer/select` uses internally to window long lists. The fix is to swap the render block for `usePagination` and add `←` / `→` keys for page jumps.

A follow-up bug surfaced during testing: after paging or after a sort/filter change, the cursor was "stuck" — pressing `↓` could not reach the last item and pressing `↑` could not return to the first. The root causes were (a) `usePagination`'s `loop: true` default wrapping the visible window around the ends of the list, and (b) the `←` / `→` handlers not snapping the cursor to the first row of the new page. The fix is `loop: false`, an explicit snap-to-first-row formula for `←` / `→`, and an `active = 0` reset whenever the filtered list changes (sort / profile / favorites).

## What Changes

- **Paged window rendering** - the `browserPrompt` body in `src/cli/utils/prompts.ts` replaces the single `map().join("\n")` with `usePagination({ items: filteredSorted, active: safeActive, pageSize, loop: false, renderItem })`. `loop: false` is critical: with `loop: true` (the default) and the cursor near the end of the list, the fill algorithm wraps around to the start of the list when computing "items under the active row", which produced the "stuck cursor" bug. `pageSize` is derived from `process.stdout.rows` (with a `Math.max(5, floor((rows - 4) * 0.8))` floor — the 0.8 multiplier cuts the page size by 20% from the naive `(rows - 4)` to leave breathing room above and below the visible window) and may be overridden via the `BrowserConfig.pageSize` test option. When the filtered list has fewer rows than `pageSize`, every row is shown (the `usePagination` no-op case for short lists).
- **Page navigation keys** - `←` and `→` snap the cursor to the **first row of the new page** (`(currentPage ± 1) * pageSize`, clamped to `[0, totalPages - 1]`). `←` on the first page and `→` on the last page are no-ops (the page did not change, so the cursor stays on its current row). With the new logic, paging always lands the cursor on a row the user can immediately see, and the page indicator (`Page: X/Y`) is consistent with the visible window.
- **Cursor reset on filter changes** - pressing `s`, `p`, or `f` mutates one of the `useState` values that feeds into the `filteredSorted` `useMemo`. The keypress handlers explicitly call `setActive(0)` in the same `useKeypress` callback, so the `withUpdates` batcher collapses the sort/filter change and the cursor reset into a single re-render (no flicker). A `useEffect(() => setActive(0), [filteredSorted])` safety net enforces the same reset for any future list-mutating path.
- **Page indicator in the title bar** - when the filtered list spans more than one page, the title bar gains a `Page: X/Y` segment immediately after the chat count, where `Y = ceil(N / pageSize)` (total pages) and `X = min(Y, floor(active / pageSize) + 1)` (the 1-indexed page the active row is in). When the list fits on a single page, the `Page:` segment is omitted. The segment updates live as the user pages with `←` / `→`.
- **Hint line update** - the visible hint at `src/cli/utils/prompts.ts:327-329` gains `← → page` adjacent to the existing `↑↓ navigate` label. No other hint tokens change.
- **Test-only `pageSize` override** - `BrowserConfig` gains an optional `pageSize?: number` field. Production code never sets it (it is left `undefined` so the terminal-height path is used). Tests set it to a small integer (3, 5, 20) to force pagination in a deterministic fixture.
- **No byte-equivalence impact on the non-interactive paths.** `gemiterm list`, `gemiterm list --format json`, `gemiterm list --out`, and `gemiterm list --search` continue to emit the same text table / JSON / file output. Only the `--interactive/-i` TUI changes.

## Capabilities

### Modified Capabilities

- `chat-list-browser` - the existing requirement "Chat-list browser SHALL display the list with cursor navigation" (line 71 of `openspec/specs/chat-list-browser/spec.md`) is updated: the "no paging; the entire filtered list is always in the body" clause is replaced with a paged-window model centered on the active row, and `← / →` page-jump semantics are added to the cursor navigation clause. The cursor's `[0, filteredSorted.length - 1]` clamp and the title-bar / hint-line shape are preserved.

## Impact

- **Code touched** - `src/cli/utils/prompts.ts` (one file). The change is additive: one new import (`usePagination` from `@inquirer/core`, already a dep), one new `useMemo` call, one new keypress case (`←` / `→`), and a render-block swap inside the existing `browserPrompt`. `BrowserResult`, `BrowserAction`, and `BrowserConfig`'s public surface gain only the optional `pageSize?: number` field.
- **APIs / public surface** - `BrowserConfig.pageSize?` is added. The other `Browser*` types are unchanged. The `gemiterm list -i` CLI surface is unchanged.
- **Dependencies** - none. `usePagination` is exported by the already-installed `@inquirer/core`.
- **Multi-profile / multi-platform** - the `pageSize` derivation reads `process.stdout.rows`, which is a Node.js standard property available on linux, macOS, WSL, and Windows when stdout is a TTY. The TTY gate (`requireTty` at line 308) runs before `browserPrompt`, so the read is always against a TTY. There is no OS-specific code: no `io.ts` helper is required because no filesystem or path operation is involved. The `?? 24` fallback handles the case where `process.stdout.rows` is `undefined` (CI / non-TTY-pretender tests).
- **Conformance** - the non-interactive byte-equivalence contract for `gemiterm list` is preserved. The existing 18 tests in `tests/cli/utils/chat-list-browser.test.ts` continue to pass because all original fixtures are 2-4 items and the default `pageSize` (16 for the default terminal height of 24 rows) is larger than every original fixture. The 13 new pagination tests (windowing, page jumps, boundaries, override, sort+paginate interaction, short-list, hint line, 80% formula, page indicator) are net-new additions in a new `describe("pagination", …)` block.
- **Coordination with the in-flight `chat-list-bulk-actions` change** - that change adds `space` (multi-select toggle) and `b` (bulk menu) keys plus a `[x] / [ ]` row prefix to the same `browserPrompt`. The two changes touch disjoint keys (`← / →` vs `space / b`) and disjoint rendering concerns (`usePagination` windowing vs `[x]/[ ]` prefix inside `renderRow`). They are independent and additive. Ideally this change lands first (smaller surface, no `BrowserResult` union change) and `chat-list-bulk-actions` follows, but the order is not load-bearing.

## Out of scope

- Type-to-filter / search inside the browser (`@inquirer/search` is installed but unused here).
- `home` / `end` / `g` / `G` vim-style jump keys.
- A granular position indicator in the title bar (e.g. `(item 1-10 of 47)`). The `Page: X/Y` segment is the coarse indicator; the `↑↓` cursor already shows position within the visible window.
- Non-interactive `gemiterm list` paging (no demand; the table output adapts to terminal width via `cli-table`).
- Any change to `BrowserResult` / `BrowserAction`.
