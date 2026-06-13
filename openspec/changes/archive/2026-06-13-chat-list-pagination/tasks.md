## 1. Implementation

- [x] 1.1 In `src/cli/utils/prompts.ts`, add `usePagination` to the existing `@inquirer/core` import — no new dependency.
- [x] 1.2 Extend `BrowserConfig` with an optional `pageSize?: number` field. Test override only; production leaves it `undefined` to use the terminal-height path.
- [x] 1.3 Inside `browserPrompt`, add a `useMemo` for `pageSize` keyed on `[config.pageSize]`. Default path: `process.stdout.rows ?? 24` minus 4, multiplied by 0.8 (the 20% reduction), floored at 5.
- [x] 1.4 Add two keypress cases inside the existing `useKeypress` callback: `key.name === "left"` → `setActive(Math.max(0, active - pageSize))`; `key.name === "right"` → `setActive(Math.min(total - 1, active + pageSize))`. Each returns early.
- [x] 1.5 Replace the render block with the new structure: compute `safeActive` and the `Page: X/Y` indicator first, then `usePagination({ items: filteredSorted, active: safeActive, pageSize, renderItem })` and return `[titleBar + "\n" + rows, hintLine]`. The empty-list early return is preserved.
- [x] 1.6 Update the hint line to `"↑↓ navigate · ← → page · s sort · p profile · f favorites · enter pick · q quit"`.
- [x] 1.7 Add the `Page: X/Y` indicator to the title bar when `totalPages > 1`. `totalPages = max(1, ceil(N / pageSize))`; `currentPage = min(totalPages, floor(active / pageSize) + 1)`. The indicator is placed immediately after the chat count and is omitted when the list fits on a single page.

## 2. Tests

- [x] 2.1 Append a new `describe("pagination", …)` block to `tests/cli/utils/chat-list-browser.test.ts`. Use the existing TTY stub pattern in `beforeEach`/`afterEach`, and add a parallel `process.stdout.rows` override + restore block.
- [x] 2.2 Add the 13 tests from design.md D10: long list windowing, `→` page jump, `→` end clamp, `←` start clamp, `pageSize` override honored, down + pagination interaction, filtered-list-shorter-than-pageSize, hint-line page-keys, 80% pageSize formula, `Page: X/Y` visible when paginated, `Page: X/Y` updates on `→`, `Page: X/Y` clamps at last page, `Page:` hidden when single page.
- [x] 2.3 Add a `buildChats(n)` helper at the top of the new `describe` block (returns `n` chats with stable ids `c00`…`c{n-1}`, deterministic timestamps `1717000000000 + i * 1000`, un-pinned, distinct titles).

## 3. Verification

- [x] 3.1 Run `bun test` and confirm the full suite passes. New tests added by this change: 13. Full suite count after this change: 695 pass, 0 fail. (The 690 baseline was already augmented by the in-flight `chat-list-bulk-actions` tests; after the pageSize tweak and page indicator, the count rises by 5 to 695.)
- [x] 3.2 Run `bun run typecheck` and confirm zero errors. The `usePagination` generic parameter is `ChatInfo` (inferred from `items`); the `renderItem` callback signature matches `(layout: { item: T; index: number; isActive: boolean }) => string` per `use-pagination.d.ts:6-13`.
- [x] 3.3 Run `bun run lint:mediation` and confirm the bash version (NOT the broken `lint:mediation:ps` script) reports zero violations. No new `node:fs` / `node:path` / `node:os` imports are introduced. `process.stdout.rows` is a Node.js global, not a module import, so the path-mediation rule does not apply. (On Windows, invoke `bash` via `& "C:\Program Files\Git\bin\bash.exe" scripts/lint-path-mediation.sh` because `bash` is not on the default PATH.)
- [ ] 3.4 Manual smoke test on a real terminal: `bun run dev -- list -i` against a profile with > 20 chats. Confirm the visible page is windowed with the 80% pageSize, `↑/↓` moves the cursor, `←/→` jumps by page, the title bar shows `Page: X/Y`, `s/p/f` still work, the action menu still resolves on `enter`, and `q` quits.

## 4. Sync and archive

- [x] 4.1 Apply the delta spec to `openspec/specs/chat-list-browser/spec.md`. The main spec now describes the paged-window model with the 80% pageSize formula, the `Page: X/Y` indicator, and all new scenarios.
- [x] 4.2 Move the change folder into `openspec/changes/archive/2026-06-13-chat-list-pagination/`. The delta spec folder is kept as the historical record of what was changed.
