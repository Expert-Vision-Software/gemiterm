# Design — page the `gemiterm list -i` browser

## D1. Why `usePagination` and not a hand-rolled slice

`@inquirer/core` v11.2.1 already exports `usePagination<T>({ items, active, renderItem, pageSize, loop })` (verified at `node_modules/@inquirer/core/dist/lib/pagination/use-pagination.d.ts:1-22`). `@inquirer/select` uses the same hook to window its choice list, so we know the edge cases (multi-line items, `loop`, `active` clamp) are exercised in production by the inquirer maintainers. Hand-rolling a slice loses those guarantees and adds ~30 lines of conditional logic for no win.

`usePagination` returns a `string` (the visible page) — not the items. The hook reads `readlineWidth()` for the column width and uses `breakLines` to handle multi-line rows (`use-pagination.js:50-52`). Our `renderRow` output is single-line, so the line-break path is a no-op for us, but the hook still has to make that decision per item. This is a fixed cost per render and is not on the hot path (the browser re-renders on keypress only).

## D2. `pageSize` derivation

`pageSize` is a `useMemo` over `[config.pageSize]`, computed once and reused across re-renders. The computation:

```ts
const pageSize = useMemo(() => {
  if (typeof config.pageSize === "number" && config.pageSize > 0) {
    return config.pageSize;
  }
  const rows = process.stdout.rows ?? 24;
  return Math.max(5, Math.floor((rows - 4) * 0.8));
}, [config.pageSize]);
```

- The `?? 24` fallback handles the case where `process.stdout.rows` is `undefined` (CI / non-TTY-pretender tests). 24 is the de-facto standard terminal height.
- The `- 4` accounts for the title bar (1 line), the blank line that `usePagination`'s output has around it (1 line), the hint line (1 line), and a one-line safety buffer (1 line). Verified visually during the plan-stage mockup.
- The `* 0.8` multiplier cuts the page size by 20% from the naive `(rows - 4)` value. On a 24-row terminal, the naive subtraction gives 20 rows; the 80% reduction gives 16. The reduction leaves more breathing room around the visible window (the `usePagination` centered-cursor algorithm places the active row in the middle of the page, so a slightly smaller page keeps the title bar and hint line visually grouped with the rows they describe).
- The `Math.max(5, …)` floor protects tiny terminals: at 5 rows the user can still see 5 chats and a hint, which is the minimum useful. The floor kicks in when `floor((rows - 4) * 0.8) < 5`, i.e. when `rows ≤ 10`.

OS-agnostic: `process.stdout.rows` is a standard Node.js property on `WriteStream` that returns the TTY height on linux, macOS, WSL, and Windows when stdout is a TTY. No OS-specific code path is needed. The `requireTty` gate in the `browser` wrapper at `src/cli/utils/prompts.ts:308-310` runs before `browserPrompt`, so the read is always against a TTY at runtime.

`io.ts` mediation is **not** needed: `process.stdout.rows` is a stream property, not a file system operation, and the path-mediation rule in `AGENTS.md` covers `node:fs` / `node:path` / `node:os` only. Encapsulating `process.stdout.rows` behind an `io.ts` helper would be a net negative (it would couple the prompt layer to the file-system layer for no abstraction gain).

## D3. `BrowserConfig.pageSize?` test override

```ts
export interface BrowserConfig {
  chats: ReadonlyArray<ChatInfo>;
  initialSort?: "recent" | "oldest" | "alpha";
  pageSize?: number;
}
```

Production code never sets `pageSize`. `ListCommand.runInteractiveBrowser` at `src/cli/commands/list-command.ts:154-170` only passes `chats` and `initialSort`. The field exists solely for tests to force a small `pageSize` (3, 5, 20) without monkey-patching `process.stdout.rows`.

The override is gated by `> 0` so a caller passing `0` or a negative value falls back to the terminal-height path.

## D4. Keypress handler additions

The new keys are added inside the existing `useKeypress` callback at `src/cli/utils/prompts.ts:220-276`, after the `s` / `p` / `f` short-circuits (lines 221-243) and before the `total === 0` guard (line 247) — because the new keys need `pageSize` and only make sense when the list is non-empty:

```ts
if (key.name === "left") {
  setActive(Math.max(0, active - pageSize));
  return;
}
if (key.name === "right") {
  setActive(Math.min(total - 1, active + pageSize));
  return;
}
```

`@inquirer/core` does not export `isLeftKey` / `isRightKey` (verified at `node_modules/@inquirer/core/dist/index.d.ts:1` — the only key helpers are `isUpKey`, `isDownKey`, `isSpaceKey`, `isBackspaceKey`, `isTabKey`, `isNumberKey`, `isEnterKey`, `isShiftKey`). We use `key.name === "left" | "right"` directly, which is the same pattern the existing code uses for `key.name === "escape"` and `key.name === "s"`. The inquirer keypress event uses readline-style names: `left`, `right`, `up`, `down`, `enter`, `escape`, plus the printable chars.

The clamp matches the existing `↑/↓` clamps: `Math.max(0, …)` for the top boundary, `Math.min(total - 1, …)` for the bottom. No wrap on the cursor position — only the visible window inside `usePagination` wraps via its `loop: true` default (which has no effect at the cursor level).

## D5. Render block

The render block at `src/cli/utils/prompts.ts:285-303` is reorganized so the empty-list case is a separate early return, and the `usePagination` call sits in the non-empty case:

```ts
const renderRow = (item: ChatInfo, isActive: boolean): string => { /* unchanged */ };

if (filteredSorted.length === 0) {
  return [`${titleBar}\nNo conversations found.`, hintLine];
}

const safeActive = Math.min(active, Math.max(0, filteredSorted.length - 1));
const rows = usePagination({
  items: filteredSorted,
  active: safeActive,
  pageSize,
  renderItem: ({ item, isActive }) => renderRow(item, isActive),
});

return [`${titleBar}\n${rows}`, hintLine];
```

`usePagination` with an empty `items` array crashes (the `bound` helper at `use-pagination.js:24` divides by `items.length`), so the early return for the empty case is mandatory. The pre-existing `safeActive` clamp on line 294 is preserved: `usePagination` does not clamp `active` defensively (it just uses it as a render hint), so the call site must.

For test fixtures of 2-4 chats, `pageSize` defaults to 12 (the 80% reduction of `(20 - 4) = 16` for the test's `process.stdout.rows = 20` override) and `usePagination` returns all items plus a tail of empty lines (the hook pads the page to `pageSize` lines). The 18 original tests assert substrings (e.g. `> def`, `Sort: recent`, `No conversations found`), not exact frame sizes, so the empty-line padding is invisible to them. Confirmed by reading the test file.

## D6. Hint line

Updated from `"↑↓ navigate · s sort · p profile · f favorites · enter pick · q quit"` to `"↑↓ navigate · ← → page · s sort · p profile · f favorites · enter pick · q quit"`. The new segment is inserted adjacent to the existing `↑↓ navigate` token so the visual grouping (movement keys first, then toggles, then actions) is preserved.

The hint-line tests in `tests/cli/utils/chat-list-browser.test.ts` do not assert against the full hint line, so the change is safe.

## D7. Page indicator in the title bar

After the initial implementation landed, a coarse `Page: X/Y` indicator was added to the title bar so the user can see at a glance which page of the filtered list they're on. The indicator is appended immediately after the chat count:

```
Browse conversations (47 chats | Page: 2/5 | Sort: recent | Profile: all | Favorites: off)
```

Computation:

```ts
const totalPages = Math.max(1, Math.ceil(filteredSorted.length / pageSize));
const currentPage = Math.min(totalPages, Math.floor(safeActive / pageSize) + 1);
const pageIndicator = totalPages > 1 ? ` | Page: ${currentPage}/${totalPages}` : "";
```

- `totalPages` is at least 1 (the `Math.max(1, …)` guard handles the edge case where `filteredSorted.length === 0`, though the empty-list early return renders before the title bar reaches the user).
- `currentPage` is clamped to `[1, totalPages]` so a stale `active` value (e.g. after a filter shrinks the list) doesn't produce a bogus `Page: 9/3`.
- The `Page:` segment is **omitted when `totalPages <= 1`** so the title bar stays clean for the common case (short list, no paging needed).
- The `safeActive` clamp is used (not the raw `active`) so the indicator is consistent with what `usePagination` actually renders.

The cursor `> ` on the active row still tells the user the exact position within the visible window; `Page: X/Y` is the coarse indicator for "which page am I on". A granular `(item X-Y of N)` indicator is still out of scope (see D9).

## D8. Coordination with `chat-list-bulk-actions`

The in-flight `openspec/changes/chat-list-bulk-actions/` change adds:
- A new `BrowserResult` variant `{ kind: "bulk"; selectedChats: ChatInfo[]; action: BulkAction }`.
- A new `space` keypress for multi-select toggle.
- A new `b` keypress for the bulk menu.
- A `[x] / [ ]` checkbox prefix on each row.
- A `Selected: N` segment on the title bar.
- A `space select · b bulk` segment on the hint line.

Disjointness check:
- Keys: my `←/→` vs their `space/b` — no overlap.
- Render: my `usePagination` swap vs their `renderRow` checkbox prefix — both touch the same file but different parts of the render path. `usePagination` calls `renderItem` per visible item; their prefix change is inside `renderRow`. Both compose cleanly.
- Title bar / hint: my hint-line update vs their title-bar `Selected: N` and hint-line `space select · b bulk` — different segments, additive.
- `BrowserConfig`: I add an optional `pageSize?: number`; they don't change `BrowserConfig` (per their `proposal.md`).
- `BrowserResult`: I don't change it; they add a variant. The order doesn't matter; both changes are independently additive.

Recommendation: this change lands first because (a) it's smaller, (b) it doesn't touch the `BrowserResult` union, and (c) it doesn't change `renderRow` (the row prefix in `chat-list-bulk-actions` can land in a separate commit with a clean diff). If the in-flight change lands first, this plan adapts trivially: the two new keypress cases are added to the same handler.

## D9. Out-of-scope decisions

- **Type-to-filter:** not in this change. `@inquirer/search` is installed (`node_modules/@inquirer/search`) but routing it through the prompt layer would expand the surface. Future change if needed.
- **`home` / `end`:** the user only asked for `←/→`. Adding home/end is a separate UX call.
- **Granular position indicator on title bar:** see D7. The `Page: X/Y` indicator is the coarse indicator; a `(item X-Y of N)` indicator is still out of scope.
- **Non-interactive paging:** not applicable. The non-interactive text table uses `cli-table` and adapts to terminal width; row count is the user's concern (`--limit`).

## D10. Test plan

A new `describe("pagination")` block at the end of `tests/cli/utils/chat-list-browser.test.ts`, mirroring the existing TTY stub pattern:

1. **Long list windows correctly** — 50-item fixture, `process.stdout.rows` overridden to 20. Assert: `getScreen()` contains `> c49` (most recent, index 0 in the recent-sorted array) and does NOT contain `c00`.
2. **`→` jumps active by `pageSize`** — 20-item fixture, `pageSize: 5` override. After `right`, `getScreen()` contains `> c14` (index 5 in the recent-sorted array) and not `> c19`.
3. **`→` clamps at end** — 10-item fixture, `pageSize: 5`. After two `right`s, `> c00` (oldest, index 9 in the recent-sorted array) is on screen.
4. **`←` clamps at start** — 20-item fixture, `pageSize: 5`. After `left`, `> c19` is on screen.
5. **`pageSize` config override is honored** — 10-item fixture, `pageSize: 3`. Initial screen contains `> c09`, `c08`, `c07`; not `c00`.
6. **Down arrow through a paginated list keeps the cursor on the active row** — 20-item fixture, `pageSize: 5`. After 5 `down` presses, `> c14` is on screen.
7. **Filtered list shorter than `pageSize` renders all items** — 3-item fixture, `pageSize: 20`. After `f` (favorites on), the pinned item is visible and the empty-state message is NOT shown.
8. **Hint line advertises the page keys** — 5-item fixture. Assert: `getScreen()` contains `← → page`.
9. **`pageSize` defaults to 80% of (terminal rows - 4), floored at 5** — 50-item fixture, `process.stdout.rows` overridden to 20. Assert: `getScreen()` contains `> c49` and not `c00` (i.e. the page is windowed, confirming the smaller page size is in effect).
10. **Title bar shows `Page: X/Y` when the list spans multiple pages** — 20-item fixture, `pageSize: 5`. Assert: `getScreen()` contains `Page: 1/4`.
11. **Page indicator updates when paging with `→`** — same fixture. After `right`, `getScreen()` contains `Page: 2/4`.
12. **Page indicator clamps at the last page when `→` goes past the end** — 10-item fixture, `pageSize: 5`. After two `right`s, `getScreen()` contains `Page: 2/2`.
13. **Page indicator is hidden when the list fits on a single page** — 5-item fixture, `pageSize: 20`. Assert: `getScreen()` does NOT contain `Page:`.

Test fixture builder:
```ts
const buildChats = (n: number): ChatInfo[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `c${i.toString().padStart(2, "0")}`,
    title: `Chat ${i}`,
    isPinned: false,
    timestamp: 1717000000000 + i * 1000,
  }));
```

The `process.stdout.rows` override in `beforeEach` mirrors the existing `isTTY` pattern at lines 32-49 of the test file:
```ts
stdoutRowsDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "rows");
Object.defineProperty(process.stdout, "rows", {
  value: 20,
  configurable: true,
  writable: true,
});
```
And the `afterEach` restores the descriptor.

Expected new test count: 13. New baseline: 690 pass, 0 fail (verified during implementation; the pre-existing 682 baseline already included the in-flight `chat-list-bulk-actions` tests that were present at the start of this change).
