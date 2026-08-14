## Why

The chat-list browser (`gemiterm list -i`) currently supports a single-pick workflow: navigate, press `enter`, view/export/copy that one conversation, return. In real workflows users repeatedly want to act on **several** conversations at once — sweep a batch of stale chats, archive a topic's worth of notes, or stitch a handful of related conversations into a single context file for a follow-up `new` session. The browser offers no way to do this today, and the only existing batch hook is `gemiterm export-all`, which exports *every* chat rather than a user-chosen subset. Comma-separated ids on `delete` and `export`, plus a new `summarize` command, close that gap on the non-interactive side; multi-select and a `b`-for-bulk menu close it on the interactive side.

## What Changes

- **Browser multi-select** — in `gemiterm list -i`, the user can press `space` on any row to toggle that conversation in/out of a per-session selection set. Selected rows render with an `[x]` checkbox prefix (unselected rows render `[ ] `). The title bar shows the current selection count. The selection is **not** persisted across browser re-entries.
- **Browser bulk menu** — pressing `b` resolves the browser with a new `BrowserResult` variant carrying the current selection. The caller shows a `select` action menu with three bulk actions (`Bulk delete`, `Bulk export`, `Combine & Summarize`) plus `Back to list` and `Quit`. Each bulk action delegates to a new `gemiterm summarize` command or to the existing `delete` / `export` commands in a loop, with **no code duplication** of the single-conversation logic.
- **`b` with zero selection** — prints a dim hint `No conversations selected — press space to select rows first.` and stays in the browser.
- **`delete` accepts comma-separated ids** — `gemiterm delete id1,id2,id3` resolves the owning profile per id, prompts once with a list of all N conversations and a single `y/n` confirm (unless `--force` is set), then sends a `DeleteConversationCommand` for each. Per-id errors are logged and the process exits non-zero if any failed.
- **`export` accepts comma-separated ids** — `gemiterm export id1,id2,id3` writes one file per id using the existing `gemini-chat-<id>-<YYYY-MM-DD>.<ext>` default filename pattern. A new `--out-dir/-d <dir>` flag (default: current working directory) places all N files under the supplied directory.
- **New `summarize` command** — `gemiterm summarize id1,id2,id3` produces a single markdown file that contains (a) a client-side **cross-references** section that links notes which share date proximity or repeated keywords, and (b) a per-note **100-token** extract (title + opening message excerpt + a `Keywords:` line). The default output path is `gemiterm-bulk-summary-<YYYY-MM-DD-HHMMSS>.md` in the current working directory; `--out/-o <path>` overrides it. After writing the file the command offers a one-shot `Open a new chat with this file as context? (y/n)` prompt and, on yes, spawns `gemiterm new --prompt-file <path>` with the active profile and exits.
- **Browser dispatches bulk operations via the same `CommandRegistry.getHandler` pattern** the single-row action menu already uses — `gemiterm list -i` does not call mediator handlers directly for bulk, it re-uses `DeleteCommand`, `ExportCommand`, and the new `SummarizeCommand`. This keeps the "no code duplication" rule.

## Capabilities

### New Capabilities

- `chat-summarization` — the local client-side algorithm for `summarize` (100-token per-note extract + cross-references section linking related notes by shared keywords and date proximity). The new `SummarizeCommand` CLI command, its argv parsing, and its file format. The post-summarize `Open a new chat with this file as context? (y/n)` prompt and the spawn of `gemiterm new --prompt-file <path>`.

### Modified Capabilities

- `chat-list-browser` — add the **multi-select** requirement (spacebar toggles row membership in a per-session `Set<string>`, row rendering gains the `[x] / [ ]` checkbox prefix, title bar gains the selection count, hint line gains `space select · b bulk`). Add the **bulk menu trigger** requirement (`b` resolves the browser with a new `BrowserResult` variant carrying the current selection snapshot; the caller's `select` action menu shows the three bulk actions). The pre-existing requirements (sort, filter, action menu, quit, byte-equivalence) are unchanged.
- `commands` — modify the `DeleteCommand` requirement to accept a comma-separated list of positional ids and add the batch confirm flow. Modify the `ExportCommand` requirement to accept a comma-separated list of positional ids and add the `--out-dir` flag. Add the `SummarizeCommand` requirement (positional `ids` parser, mediator calls, file write, post-summarize prompt). Add a `BulkAction` registry name entry (`summarize`) to the `CommandRegistry` requirement. **Non-breaking** — every existing `gemiterm delete <id>` / `gemiterm export <id>` invocation continues to work because a single id (no comma) is the same shape it was before.

## Impact

- **Code touched**
  - `src/cli/utils/prompts.ts` — `BrowserResult` union gains `{ kind: "bulk"; selectedChats: ChatInfo[]; action: BulkAction }`; `BrowserAction` is unchanged. `browserPrompt` gains `space` and `b` keypress handlers, a `useState<Set<string>>` for the selection, and a `useState<number>` for the active row (already present). `truncateTitle` and the existing `BrowserConfig` are unchanged.
  - `src/cli/commands/list-command.ts` — `runInteractiveBrowser` dispatches the new bulk action via `CommandRegistry.getHandler("delete" | "export" | "summarize")`. `showActionMenu` is unchanged. `parseArgs` is unchanged.
  - `src/cli/commands/delete-command.ts` — argv parser handles comma-separated ids; new batch confirm prompt listing all ids.
  - `src/cli/commands/export-command.ts` — argv parser handles comma-separated ids; new `--out-dir/-d` flag.
  - `src/cli/commands/summarize-command.ts` — **new** command file, registered as `summarize`.
  - `src/services/local-summarizer.ts` — **new** pure-function module: per-note 100-token extract, shared-keyword detector, date-bucketing. Lives in `services/` because it's invoked from a CLI command, not from the mediator. (The mediator stays unchanged.)
  - `src/infrastructure/formatters.ts` — new formatter for the summarize output file.
  - `src/cli/command-registry.ts` — `registerAllCommands` registers the new `summarize` command.
- **APIs / public surface**
  - `BrowserResult` discriminated union gains a new variant; consumers must handle the new variant in a switch.
  - `BrowserAction` is unchanged.
  - `CommandsRegistry.getRegisteredNames()` now includes `summarize` (12 commands total, was 11).
  - The `gemiterm` top-level help, the `Commands:` section, gains one entry.
- **Dependencies** — none. All work is in-tree.
- **Multi-profile** — `delete` and the new `summarize` resolve the owning profile per id via the existing `ProfileAuthManager.findProfileForConversation`. Ids whose owning profile cannot be resolved are skipped with a warning (delete) or noted in the output (summarize); the rest of the batch proceeds. Single-profile setups are unchanged.
- **TTY** — the new `summarize` post-action `confirm` is a TTY prompt. Without a TTY, the prompt is skipped and the file path is printed (the user can then run `gemiterm new --prompt-file <path>` themselves).
- **Conformance** — the non-interactive byte-equivalence contract for `gemiterm list` is untouched by *this* change. **Reconciliation with `refactorings-phase2-04-chat-output-pipeline` (landed first):** 04 re-scopes the flagless `gemiterm list` default to aggregate across all configured profiles (adding a `PROFILE` column), skipping inaccessible profiles with a warning. Single-profile output and `--profile <name>` output remain byte-equivalent, and the bulk browser already consumes multi-profile data, so this change is unaffected. The existing `gemiterm delete <id>` and `gemiterm export <id>` invocations produce byte-identical output to the pre-change baseline (a single id is a single-element list, which is a strict subset of the new behavior).
