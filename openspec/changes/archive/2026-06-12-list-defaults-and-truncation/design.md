## Context

The two changes captured here both came out of post-merge UX review of the `integrate-inquirer-prompts` work. They're small, orthogonal, and have no shared abstractions, so this change is a documentation catch-up rather than a coordinated design.

### D1. Default limit goes from 10 to "no limit"

**Decision:** `DEFAULT_OPTIONS.limit` is `0`, interpreted as "no limit". `execute` computes `hasLimit = options.limit > 0`. When false, the mediator payload carries `limit: undefined` and the client-side slice step is skipped entirely. When `--offset > 0` and `hasLimit === false`, only the offset slice is applied.

**Why:** the v1.4.1 Python CLI returned the full list. The 10-cap was inherited from a misread of the v2.0.0 design and was a footgun: any user with more than ten recent chats saw a silently truncated list with no indication that the truncation happened. The 10-cap also forced users to add `--all` (or remember the 10-row limit) for every day-to-day query.

**Alternatives considered:**
- *Keep the 10-cap, just document it more clearly.* Rejected: the cap is the bug, not the documentation. The user should not have to think about it.
- *Default to 50 or 100 instead of "all".* Rejected: any cap is the wrong default. Modern chat histories can have thousands of entries; the user can pipe through `head` / `less` / `fzf` if they want a smaller view, and the `--limit` flag is right there for explicit bounding.
- *Default to a number that scales with terminal height.* Rejected: not portable across agents, pipes, and CI environments. `0` (= no limit) is unambiguous.

### D2. `--all` is removed (not deprecated)

**Decision:** `--all` is removed entirely: the flag is gone from `ListCommandOptions`, `DEFAULT_OPTIONS`, `parseArgs`, the help text, and the test suite. No deprecation warning, no alias.

**Why:** `--all` is now a 100% redundant synonym for omitting `--limit`. Two flags that do the same thing is a maintenance burden and a documentation hazard. The pre-v2.0 `gemiterm list --all` users will need to drop the flag — the behavior is identical, so this is a clean cutover, not a breaking semantic change.

**Alternatives considered:**
- *Keep `--all` as a no-op alias for one release with a deprecation warning.* Rejected: the user base is small and the change is documented in the help text and the changelog. A silent removal is fine.
- *Rename `--all` to `--no-limit`.* Rejected: adds complexity without adding clarity. The absence of `--limit` IS the "no limit" form.

### D3. Title truncation at 55 chars with `…`

**Decision:** the browser's `renderItem` callback applies a new `truncateTitle(title)` helper:
- If `title.length <= 55`: return the title unchanged.
- Otherwise: return `title.slice(0, 54) + "…"`.

The helper is exported from `src/cli/utils/prompts.ts` as `truncateTitle` for direct unit testing. The truncation runs before chalk styling so the ellipsis takes the same unstyled treatment as the rest of the title.

**Why:** the rendered row format is `> <id>  <date>  <title>  <pin>`. With a 4-column layout and 15 rows on a 24-line terminal, a 200-char title wraps the row to two visual lines, breaking the table layout. 55 chars + `…` keeps every row on one visual line and signals to the user that the title is incomplete (the action menu shows the full title when a chat is picked).

**Alternatives considered:**
- *Pad short titles with spaces instead of truncating long ones.* Rejected: the table already left-aligns titles, and padding doesn't help with rows that are genuinely too long.
- *Use the `string-width` package to measure visible width and handle full-width CJK characters correctly.* Rejected: the codebase doesn't currently depend on `string-width`, and chat titles in gemiterm are predominantly ASCII. The simple `length`-based check is consistent with the rest of the table (which uses simple `length` everywhere). A follow-up can add `string-width` if CJK users report misaligned columns.
- *Wrap to two lines instead of truncating.* Rejected: with 15 rows per page, 2 lines per row is 30 lines, exceeding the typical 24-line terminal. The `usePagination` hook doesn't know about row height.
- *Show a tooltip with the full title on hover.* Rejected: this is a TTY, not a GUI. No hover semantics.

## Risks / Trade-offs

- **Truncation is lossy.** A user with a 200-char title can't read the full title from the browser list. **Mitigation:** the action menu after picking a chat shows the full title (`Selected: <id> — "<full title>"`), and the export commands always write the full title.
- **Cap is now unbounded.** A user with 10,000 chats will see a 10,000-line table. **Mitigation:** the table formatter (`formatChatList`) and `cli-table3` handle large tables fine; the user can pipe to `less`/`head`/`fzf`, or use `--limit N` for explicit bounding, or use `--interactive` for the paginated TUI.
- **`--offset` without `--limit` is a new combination.** Previously offset only made sense with `--all` or `--limit`. Now it's useful on its own (e.g. `gemiterm list --offset 20` to skip the first 20 of the full list). **Mitigation:** the integration test `omitting --limit sends query without limit` and `--limit N` block both use the standard offset behavior; no test for offset-without-limit exists yet but the slice logic handles it correctly.
- **The 55-char threshold is magic.** **Mitigation:** the constant is named `TITLE_MAX` in `prompts.ts` and is a single line; changing it is trivial. The spec documents the 55 value as a contract.

## Migration Plan

Single commit. No data migration. Users who relied on `gemiterm list --all` will see a "Unknown flag" error if they pass it; the new behavior (omit `--limit`) is the same and is documented in the updated help text and the changelog.

## Open Questions

None. The decisions are settled.
