# Design — page the `gemiterm list -i` browser

## D1. Why a top-aligned, custom `windowStart` slice (not `usePagination`)

The first two iterations of this change used `@inquirer/core`'s `usePagination` (verified at `node_modules/@inquirer/core/dist/lib/pagination/use-pagination.d.ts:1-22`). `usePagination` returns a `string` for the visible page and handles multi-line items via `readlineWidth()` + `breakLines` — both comfortable guarantees from the `@inquirer/select` maintainers.

But `usePagination` has two properties that conflict with the chat-list browser's "page" semantics:

1. **It centers the cursor on the visible window.** With `loop: true` (the default), the fill algorithm wraps around the list, so a 20-item list at `pageSize: 5` with `active: 19` rendered `[c18, c19, c00, c01]`. Even with `loop: false`, the non-loop pointer logic (`use-pagination.js:46-65`) keeps the cursor near the middle of the page when possible. The result: each "page" the user navigates to has 2 items of overlap with the previous page, and the `Page: X/Y` indicator disagrees with the visible window's contents.
2. **The `active` prop is treated as a render hint, not a controlled value.** The hook does `useState(0)` internally and reads the prop on first render; subsequent renders use the internal state. That meant the snap-to-first-row formula couldn't reliably move the cursor — the user would sometimes see the cursor "jump" in a way that didn't match the page indicator.

The user reported this explicitly: *"I would expect each page to only show count of items = pagesize.. it seems that changing page just jumps selector down the list instead - is that how it's intended to function ?"*. The fix is a custom top-aligned render driven by a `useState<number>(windowStart)`:

```ts
const windowStart = /* useState<number>(0) */
const windowEnd = Math.min(filteredSorted.length, windowStart + pageSize);
const visibleItems = filteredSorted.slice(windowStart, windowEnd);
const rows = visibleItems
  .map((item) => renderRow(item, item === filteredSorted[safeActive]))
  .join("\n");
```

The slice is a `ReadonlyArray<ChatInfo>` (no copy needed — `[].slice` is O(k) on k visible items), `renderRow` is called only on visible items, and the cursor is computed by reference (`item === filteredSorted[safeActive]`) so there's no string comparison. The visible window is always a clean slice: page K (1-indexed) is exactly `[K * pageSize, K * pageSize + pageSize - 1]`, with the cursor on the first row of the new page after `→` / `←`. No overlap, no wrapping, no off-by-one with the page indicator.

`@inquirer/core` is no longer imported for pagination; only `useState`, `useKeypress`, `useMemo`, `useEffect` are used from the package, and the render block has no hook dependencies beyond the local `useState`s.

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
- The `- 4` accounts for the title bar (1 line), the visible-row gap, the hint line (1 line), and a one-line safety buffer (1 line).
- The `* 0.8` multiplier cuts the page size by 20% from the naive `(rows - 4)` value. On a 24-row terminal, the naive subtraction gives 20 rows; the 80% reduction gives 16. With top-aligned paging, this is the number of items shown in each page; the slightly smaller page keeps the title bar and hint line visually grouped with the rows they describe.
- The `Math.max(5, …)` floor protects tiny terminals: at 5 rows the user can still see 5 chats and a hint, which is the minimum useful.

OS-agnostic: `process.stdout.rows` is a standard Node.js property on `WriteStream` that returns the TTY height on linux, macOS, WSL, and Windows when stdout is a TTY. No OS-specific code path is needed. The `requireTty` gate in the `browser` wrapper runs before `browserPrompt`, so the read is always against a TTY at runtime.

`io.ts` mediation is **not** needed: `process.stdout.rows` is a stream property, not a file system operation.

## D3. `BrowserConfig.pageSize?` test override

```ts
export interface BrowserConfig {
  chats: ReadonlyArray<ChatInfo>;
  initialSort?: "recent" | "oldest" | "alpha";
  pageSize?: number;
}
```

Production code never sets `pageSize`. The field exists solely for tests to force a small `pageSize` (3, 5, 20) without monkey-patching `process.stdout.rows`.

## D4. Keypress handler additions

The keypress handlers (inside `useKeypress` at `src/cli/utils/prompts.ts:236-327`) cover `←`, `→`, `↑`, `↓`, plus the existing `s` / `p` / `f` / `q` / `enter`. They all mutate `windowStart` (a `useState<number>`) and `active` in the same handler so the `withUpdates` batcher in `@inquirer/core`'s `hook-engine.js:42-58` collapses the updates into a single re-render.

```ts
if (key.name === "left") {
  const currentPage = Math.floor(windowStart / pageSize);
  const newPage = Math.max(0, currentPage - 1);
  if (newPage !== currentPage) {
    setWindowStart(newPage * pageSize);
    setActive(newPage * pageSize);
  }
  return;
}

if (key.name === "right") {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.floor(windowStart / pageSize);
  const newPage = Math.min(totalPages - 1, currentPage + 1);
  if (newPage !== currentPage) {
    setWindowStart(newPage * pageSize);
    setActive(newPage * pageSize);
  }
  return;
}

if (isUpKey(key)) {
  const newActive = Math.max(0, active - 1);
  setActive(newActive);
  if (newActive < windowStart) {
    setWindowStart(newActive);
  }
  return;
}

if (isDownKey(key)) {
  const newActive = Math.min(total - 1, active + 1);
  setActive(newActive);
  if (newActive >= windowStart + pageSize) {
    setWindowStart(newActive - pageSize + 1);
  }
  return;
}
```

`@inquirer/core` does not export `isLeftKey` / `isRightKey` (verified at `node_modules/@inquirer/core/dist/index.d.ts:1`). We use `key.name === "left" | "right"` directly, which is the same pattern the existing code uses for `key.name === "escape"` and `key.name === "s"`.

The four handlers together give a clean separation:

- **`→` / `←` page-jump** — sets both `windowStart` and `active` to `newPage * pageSize`. The new page is a clean slice, cursor on the first row. The `if (newPage !== currentPage)` guard makes `→` on the last page and `←` on the first page no-ops (the page did not change, so the cursor stays on its current row).
- **`↓` / `↑` step-with-scroll** — moves the cursor by 1 within the current window; scrolls the window by 1 when the cursor reaches the bottom (`↓`) or top (`↑`) edge. After the scroll, the cursor lands at the new edge of the scrolled window (the same relative position: bottom-of-window after `↓`, top-of-window after `↑`). The user can navigate smoothly through the list without the window jumping by a full page on every keypress.

## D5. Render block

The render block (around `src/cli/utils/prompts.ts:340-370`) is a top-aligned slice:

```ts
const safeActive = Math.min(active, Math.max(0, filteredSorted.length - 1));

if (filteredSorted.length === 0) {
  return [`${titleBar}\nNo conversations found.`, hintLine];
}

const windowEnd = Math.min(filteredSorted.length, windowStart + pageSize);
const visibleItems = filteredSorted.slice(windowStart, windowEnd);
const rows = visibleItems
  .map((item) => renderRow(item, item === filteredSorted[safeActive]))
  .join("\n");

return [`${titleBar}\n${rows}`, hintLine];
```

The `safeActive` clamp is defensive — the keypress handlers clamp `active` to `[0, total - 1]` on every move, so `safeActive === active` in normal use. The clamp is kept for the case where `filteredSorted` shrinks (e.g. favorites filter narrows the list to fewer items than `active`).

The empty-list early return is mandatory: an empty `filteredSorted` would cause `windowStart + pageSize` to be a positive number with nothing to slice, producing an empty `rows` string and a title bar followed by an empty body. The early return renders the canonical "No conversations found." body instead.

## D6. Resetting the cursor and window on filter changes

Pressing `s`, `p`, or `f` mutates one of the `useState` values that feeds into the `filteredSorted` `useMemo` — which re-runs and produces a new array. To make the cursor land on the first row of the first page of the re-sorted / re-filtered list:

1. **Explicit `setActive(0)` and `setWindowStart(0)` in the `s` / `p` / `f` handlers.** Both calls happen inside the same `useKeypress` callback, so the `withUpdates` batcher collapses them into a single re-render. The new render uses `active = 0` and `windowStart = 0` from the start, so the user sees the cursor land on the first row of the first page of the re-sorted / re-filtered list with no flicker.
2. **A `useEffect(() => { setActive(0); setWindowStart(0); }, [filteredSorted])` safety net.** The `useMemo` for `filteredSorted` returns a new array reference whenever any of its deps (`config.chats`, `sort`, `profileFilter`, `favoritesOnly`) change. The `useEffect` fires when that reference changes, so any future code path that mutates the list (e.g. a future date-range filter) is also covered. In the common case (sort/profile/favorites), the effect's calls are no-ops because the explicit handler already set `active = 0` and `windowStart = 0` in the same render.

The explicit-handler approach was chosen over the `useEffect`-only approach to avoid a one-frame flicker. With `useEffect` only, the user presses `s`, the first render uses the stale `active` / `windowStart`, then the effect fires and triggers a second render — the user sees a brief flash of the cursor at the wrong row with the wrong page. With the explicit handler + safety net, the first render already has the correct values, and the effect's calls are no-ops.

## D7. Page indicator in the title bar

A coarse `Page: X/Y` indicator is added to the title bar so the user can see at a glance which page of the filtered list they're on. The indicator is appended immediately after the chat count:

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
- The `safeActive` clamp is used (not the raw `active`) so the indicator is consistent with what the render block actually shows.

With the top-aligned `windowStart` slice, the `Page: X/Y` indicator is now consistent with the visible window: page K (1-indexed) is exactly items `[K * pageSize, K * pageSize + pageSize - 1]`, and the cursor is on the first item of that page. There is no overlap, no wrap, no off-by-one.

## D8. Hint line

Updated from `"↑↓ navigate · s sort · p profile · f favorites · enter pick · q quit"` to `"↑↓ navigate · ← → page · s sort · p profile · f favorites · enter pick · q quit"`. The new segment is inserted adjacent to the existing `↑↓ navigate` token so the visual grouping (movement keys first, then toggles, then actions) is preserved.

The hint-line tests in `tests/cli/utils/chat-list-browser.test.ts` do not assert against the full hint line, so the change is safe.

## D9. Coordination with `chat-list-bulk-actions`

The in-flight `openspec/changes/chat-list-bulk-actions/` change adds:
- A new `BrowserResult` variant `{ kind: "bulk"; selectedChats: ChatInfo[]; action: BulkAction }`.
- A new `space` keypress for multi-select toggle.
- A new `b` keypress for the bulk menu.
- A `[x] / [ ]` checkbox prefix on each row.
- A `Selected: N` segment on the title bar.
- A `space select · b bulk` segment on the hint line.

Disjointness check:
- Keys: my `←/→` vs their `space/b` — no overlap.
- Render: my `windowStart` slice vs their `renderRow` checkbox prefix — both touch the same file but different parts of the render path. My slice calls `renderRow` on each visible item; their prefix change is inside `renderRow`. Both compose cleanly.
- Title bar / hint: my hint-line update vs their title-bar `Selected: N` and hint-line `space select · b bulk` — different segments, additive.
- `BrowserConfig`: I add an optional `pageSize?: number`; they don't change `BrowserConfig` (per their `proposal.md`).
- `BrowserResult`: I don't change it; they add a variant. The order doesn't matter; both changes are independently additive.

Recommendation: this change lands first because (a) it's smaller, (b) it doesn't touch the `BrowserResult` union, and (c) it doesn't change `renderRow` (the row prefix in `chat-list-bulk-actions` can land in a separate commit with a clean diff). If the in-flight change lands first, this plan adapts trivially: the keypress additions are all inside the same handler.

## D10. Out-of-scope decisions

- **Type-to-filter:** not in this change. `@inquirer/search` is installed (`node_modules/@inquirer/search`) but routing it through the prompt layer would expand the surface. Future change if needed.
- **`home` / `end`:** the user only asked for `←/→`. Adding home/end is a separate UX call.
- **Granular position indicator on title bar:** see D7. The `Page: X/Y` indicator is the coarse indicator; a `(item X-Y of N)` indicator is still out of scope.
- **Non-interactive paging:** not applicable. The non-interactive text table uses `cli-table` and adapts to terminal width; row count is the user's concern (`--limit`).

## D11. Test plan

A new `describe("pagination")` block at the end of `tests/cli/utils/chat-list-browser.test.ts`, mirroring the existing TTY stub pattern. Tests cover four categories:

**Windowing:**
1. **Long list windows correctly** — 50-item fixture, `process.stdout.rows` overridden to 20. Assert: `getScreen()` contains `> c49` (most recent, index 0 in the recent-sorted array) and does NOT contain `c00`.
2. **`pageSize` config override is honored** — 10-item fixture, `pageSize: 3`. Initial screen contains `> c09`, `c08`, `c07`; not `c00`.
3. **Filtered list shorter than `pageSize` renders all items** — 3-item fixture, `pageSize: 20`. After `f` (favorites on), the pinned item is visible and the empty-state message is NOT shown.
4. **`pageSize` defaults to 80% of (terminal rows - 4), floored at 5** — 50-item fixture, `process.stdout.rows` overridden to 20. Assert: `getScreen()` contains `> c49` and not `c00` (i.e. the page is windowed, confirming the smaller page size is in effect).

**Paging (top-aligned, clean slices):**
5. **`→` jumps active to the first row of the next page** — 20-item fixture, `pageSize: 5` override. After `right`, `getScreen()` contains `> c14` (index 5 in the recent-sorted array, the first row of page 2) and not `> c19`.
6. **`→` clamps at the last page and snaps to its first row** — 10-item fixture, `pageSize: 5`. After two `right`s, `> c04` (index 5, the first row of page 2/2) is on screen. The second `→` is a no-op because the page did not change.
7. **`←` clamps at the first row** — 20-item fixture, `pageSize: 5`. After `left`, `> c19` is on screen. `←` is a no-op because the cursor is already on the first page.
8. **`→` snaps the cursor to the first row of the next page** — 20-item fixture, `pageSize: 5`. After `right`, `> c14` (index 5, first row of page 2) is on screen.
9. **`←` snaps the cursor to the first row of the previous page** — 20-item fixture, `pageSize: 5`. After `right` (active=5, page 2), then `left`, `> c19` (index 0, first row of page 1) is on screen.
10. **`←` is a no-op on the first page** — 20-item fixture, `pageSize: 5`. After `left`, `> c19` is still on screen (cursor did not move).
11. **Each page is a clean slice of pageSize items (no overlap with the previous page)** — 20-item fixture, `pageSize: 5`. Initial screen contains `> c19` and `  c15`, not `  c14`. After `→`, contains `> c14` and `  c10`, not `  c19` or `  c15`.

**Up/down (step within page, scroll at edge):**
12. **Down arrow steps within the page until the cursor reaches the bottom** — 20-item fixture, `pageSize: 5`. After 1 down, `> c18` and `  c19` are on screen. After 4 downs, `> c15` and `  c19` are on screen, not `  c14`.
13. **Down arrow at the bottom of the page scrolls the window by one row** — 20-item fixture, `pageSize: 5`. After 5 downs, `> c14` and `  c18` are on screen, not `  c19`. After 1 more down, `> c13` and `  c17`, not `  c18`.
14. **Up arrow at the top of a scrolled window scrolls the window up by one row** — 20-item fixture, `pageSize: 5`. After 5 downs then 4 ups, cursor is on `> c18` (top of window [c18-c14]). After 1 more up, cursor is on `> c19` (top of new window [c19-c15]), with `  c15` and not `  c14`.
15. **Down arrow through a paginated list keeps the cursor on the active row** — 20-item fixture, `pageSize: 5`. After 5 `down` presses, `> c14` is on screen.

**Filter changes reset cursor and window to the top:**
16. **Changing the sort resets the cursor and window to the top of the new sort** — 20-item fixture, `pageSize: 5`. After `right` (active=5, cursor on c14), then `s`, `> c00` (oldest sort, index 0) is on screen and `Sort: oldest` is in the title bar.
17. **Changing the profile filter resets the cursor and window to the top of the filtered list** — `SAMPLE_CHATS_WITH_PROFILES` fixture, `pageSize: 1`. After `down` twice (active=2), then `p` (filter narrows to work profile), `> w1` is on screen.
18. **Toggling the favorites filter resets the cursor and window to the top of the filtered list** — `SAMPLE_CHATS` fixture, `pageSize: 1`. After `down` (active=1), then `f` (favorites on), `> abc` is on screen.

**Page indicator:**
19. **Title bar shows `Page: X/Y` when the list spans multiple pages** — 20-item fixture, `pageSize: 5`. Assert: `getScreen()` contains `Page: 1/4`.
20. **Page indicator updates when paging with `→`** — same fixture. After `right`, `getScreen()` contains `Page: 2/4`.
21. **Page indicator clamps at the last page when `→` goes past the end** — 10-item fixture, `pageSize: 5`. After two `right`s, `getScreen()` contains `Page: 2/2`.
22. **Page indicator is hidden when the list fits on a single page** — 5-item fixture, `pageSize: 20`. Assert: `getScreen()` does NOT contain `Page:`.

**Hint line:**
23. **Hint line advertises the page keys** — 5-item fixture. Assert: `getScreen()` contains `← → page`.

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

Two of the original `describe("browser prompt")` tests were updated to reflect the new behavior (rather than adding new tests in the same place):
- "s keeps the cursor on the same row index when sort changes" → renamed to "s resets the cursor to the top of the new sort"; the post-sort assertion changed from `> abc` (old index 1 in the recent sort) to `> ghi` (new index 0 in the oldest sort).
- "right arrow clamps at the last row" → renamed to "right arrow clamps at the last page and snaps to its first row"; the post-press assertion changed from `> c00` (old: last item of the list) to `> c04` (new: first item of the last page).

Expected new test count: 23 in the `describe("pagination", …)` block + 2 renamed in `describe("browser prompt")`. New baseline: 705 pass, 0 fail (verified during implementation; the 701 baseline already included the in-flight `chat-list-bulk-actions` tests that were present at the start of this change).
