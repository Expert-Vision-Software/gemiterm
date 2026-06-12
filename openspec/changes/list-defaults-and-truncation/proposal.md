## Why

Two small UX adjustments to the `list` command and the chat-list browser, both motivated by real friction in the post-`integrate-inquirer-prompts` flow.

1. **`gemiterm list` returns 10 chats by default**, which silently hides the user's 11th-newest and older conversations behind a cap they didn't ask for. The pre-v2.0 Python CLI (`gemiterm` v1.4.1) returned the full list; the v2.0.0 Bun rewrite inherited the 10-row cap from a misreading of the design. The 10-cap is a footgun for users with more than ten recent chats (the common case). `--limit` is retained as the explicit way to bound output for piped workflows.
2. **`--all` is now redundant** with the new "no default limit" behavior, and exposing two ways to do the same thing is a small but real source of confusion. Removing `--all` simplifies the help text and the implementation.
3. **The chat-list browser renders the full `chat.title` in the row**, which can be hundreds of characters for chats whose title is the user's first prompt. With a 4-column layout and 15 rows on a 24-line terminal, long titles wrap and the row layout breaks. Truncating to 55 chars + `…` keeps every row on a single visual line and signals to the user that the displayed title is incomplete.

## What Changes

- `ListCommand` (`src/cli/commands/list-command.ts`): the default `limit` is `0` (meaning "no limit"). `--limit/-n N` is unchanged and is the only way to bound output. When `limit` is omitted, the mediator payload carries `limit: undefined` and the client-side slice step is skipped entirely. `--all` is removed from the flag set, the `ListCommandOptions` interface, and the help text. `--offset` without `--limit` now skips the first N rows (instead of being a no-op paired only with a limit).
- `ListCommand` test suite (`tests/cli/list-command.test.ts`, `tests/integration/commands/list.test.ts`): the "applies --all flag" / "--all sends query without limit" tests are removed and replaced with "returns all conversations by default (no limit)" / "omitting --limit sends query without limit" assertions.
- `Browser` prompt (`src/cli/utils/prompts.ts`): the `renderItem` callback now applies a new `truncateTitle(title)` helper that returns the title unchanged when `length <= 55` and returns `title.slice(0, 54) + "…"` otherwise. The helper is exported for testability. The truncation runs before chalk styling so the ellipsis takes the same unstyled treatment as the rest of the title.
- `Browser` prompt test suite (`tests/cli/utils/chat-list-browser.test.ts`): four unit tests for `truncateTitle` (short, exactly-55, 80-char, 56-char edge) and one integration test that asserts an 80-char title is truncated in the rendered screen output.
- Spec deltas in `specs/commands/spec.md` and `specs/chat-list-browser/spec.md` capture the new behavior as requirements.

## Capabilities

### Modified Capabilities

- `commands`: the `ListCommand` requirement is updated to drop the default-10 cap, drop the `--all` flag, and clarify that `--offset` works without `--limit`. One scenario is removed (`List with --all disables the slice`), one is modified (`List with no flags sends a default query`), and one is added (`List without --limit returns all conversations`).

### New Capabilities

- `chat-list-browser`: a new requirement `Browser SHALL truncate long titles with an ellipsis` documents the 55-char + `…` truncation. Scenarios cover the short, exactly-55, and over-55 cases plus a regression assertion that the rendered row contains the truncated prefix and the ellipsis.

## Impact

- **Code modified:** `src/cli/commands/list-command.ts` (12 lines), `src/cli/utils/prompts.ts` (5 lines added, 1 line changed), `tests/cli/list-command.test.ts` (-12 / +18), `tests/integration/commands/list.test.ts` (-8 / +16), `tests/cli/utils/chat-list-browser.test.ts` (+44).
- **No new dependencies.**
- **Tests:** 664 pass / 0 fail / 1318 expect() calls (was 657 / 0 / 1305 — net +7 from new default-limit assertions and truncation tests, -3 from removed `--all` tests).
- **Cross-cutting:** none. The changes are localized to the `list` command and the browser prompt. The byte-equivalent non-interactive contract of `gemiterm list` is preserved: omitting `--limit` and `--all` together now produce the same output as the pre-change `gemiterm list --all`. The interactive TUI behavior is unchanged.
- **Risk:** low. The change is additive (the new code path is "skip the slice") plus the removal of one redundant flag. The truncation is a pure presentation change with no effect on data flow.
- **Rollback:** revert the commit. No data migrations, no config changes, no schema changes.
