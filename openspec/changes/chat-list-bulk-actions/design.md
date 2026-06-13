## Context

The chat-list browser (`gemiterm list -i`, defined in `openspec/specs/chat-list-browser/spec.md`) is a single-pick TUI: navigate → `enter` → action menu → loop. Real workflows routinely want to act on **several** conversations at once, and right now the only way to batch is to drop out of the browser and run `gemiterm export-all`, which exports *every* chat rather than a user-chosen subset. The proposed change adds two parallel surfaces:

1. **In the browser** — multi-select with `space` and a `b`-triggered bulk action menu (`Bulk delete`, `Bulk export`, `Combine & Summarize`).
2. **On the non-interactive CLI** — comma-separated ids on `delete` and `export`, plus a new `summarize` command.

Both surfaces route to the same code paths via `CommandRegistry.getHandler(...)`, mirroring the existing single-row dispatch pattern (`src/cli/commands/list-command.ts:193-205`). No new mediator handlers are introduced; the mediator stays unchanged.

The new `summarize` command produces a single markdown file that contains (a) a **cross-references** section that links notes which share date proximity or repeated keywords, and (b) a per-note **100-token** extract (title + opening message excerpt + a `Keywords:` line). The summarizer is **client-side** — no Gemini call. The user can then run `gemiterm new --prompt-file <path>` to feed the result into a follow-up chat, or accept a one-shot prompt at the end of `summarize` that spawns `new` directly.

## Goals / Non-Goals

**Goals**

- Add multi-select to the chat-list browser with `space` and a bulk action menu on `b`.
- Reuse existing single-conversation code for bulk operations — no duplicated mediator or formatting logic.
- Add a new `summarize` command with a deterministic, offline, client-side summary file format.
- Accept comma-separated ids on `delete` and `export` so the non-interactive form is symmetric with the browser's bulk form.
- Preserve byte-equivalence of every existing non-interactive command (single ids, no flags) and of `gemiterm list` (with or without `--interactive`).
- Stay inside the established module boundaries: `cli/commands/` for CLI commands, `cli/utils/prompts.ts` for the prompt layer, `infrastructure/formatters.ts` for formatting, `infrastructure/io.ts` and `infrastructure/path-utils.ts` for file I/O and paths.

**Non-Goals**

- Calling Gemini or any other LLM to generate the summary. The user explicitly asked for a client-side algorithm.
- Persisting the multi-select selection across browser re-entries. The selection is a per-session `Set<string>` and resets when the browser re-mounts.
- Adding new mediator query/command types. The existing `FetchChatQuery` and `DeleteConversationCommand` are sufficient.
- Changing the byte-format of `gemiterm export`'s default file naming (`gemini-chat-<id>-<YYYY-MM-DD>.<ext>`) or the byte-format of `gemiterm list`'s text table.
- Supporting bulk in the existing `export-all` command. `export-all` continues to export *every* chat; the new comma-separated form on `export` is the user-chosen-subset path.

## Decisions

### D1. `BrowserResult` gains a new `{ kind: "bulk" }` variant

The `BrowserResult` discriminated union in `src/cli/utils/prompts.ts:162-164` becomes:

```ts
export type BrowserResult =
  | { kind: "pick"; chat: ChatInfo; action: BrowserAction }
  | { kind: "bulk"; selectedChats: ReadonlyArray<ChatInfo>; action: BulkAction }
  | { kind: "quit" };

export type BulkAction =
  | "bulk-delete"
  | "bulk-export"
  | "bulk-summarize"
  | "back"
  | "quit";
```

`BulkAction` mirrors `BrowserAction` (the `action: "back"` placeholder lets the prompt resolve with a stable shape; the caller replaces it via the post-resolve `select` menu). The `BrowserAction` union is unchanged, which keeps the single-row action menu typed the same way.

**Alternative considered:** Make `BulkAction` the *resolved* value (the prompt shows the bulk menu inline). Rejected because `@inquirer/core` doesn't allow two `createPrompt` instances alive at the same time, and we already established the sequential `select` pattern for the single-row action menu.

### D2. Selection is a `useState<ReadonlySet<string>>` in the browser

```ts
const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
```

The `useState` setter takes a new `Set` instance (using the functional form `setSelected((prev) => { const next = new Set(prev); ...; return next; })`) so `@inquirer/core`'s `Object.is` change detection re-renders. The selection is read at `b`-press time and mapped to `ChatInfo[]` from the current `filteredSorted` array — selected ids that are no longer in the visible list (because the user changed a filter) are silently dropped from the bulk payload.

### D3. `space` and `b` keypresses

`@inquirer/core`'s `useKeypress` exposes `key.name` (verified by the existing `key.name === "s"` / `"p"` / `"f"` handlers at `src/cli/utils/prompts.ts:221-243`). The new handlers:

```ts
if (key.name === "space") {
  const chat = filteredSorted[active];
  if (chat) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(chat.id)) next.delete(chat.id);
      else next.add(chat.id);
      return next;
    });
  }
  return;
}

if (key.name === "b") {
  if (selected.size === 0) {
    // No resolve; the next render will show the hint line updated to mention "b bulk"
    // and a transient console.log hint is also acceptable here.
    return;
  }
  const selectedChats = filteredSorted.filter((c) => selected.has(c.id));
  done({ kind: "bulk", selectedChats, action: "back" });
  return;
}
```

**Empty-selection hint:** Per the user's choice, `b` with zero selected rows prints a dim hint (`No conversations selected — press space to select rows first.`) and stays in the browser. Implementation: a one-shot `console.log(chalk.dim("..."))` from inside the `useKeypress` callback. This is consistent with how the existing `enter` handler does not resolve on an empty list (`src/cli/utils/prompts.ts:247-252`).

### D4. Row rendering: `[x] / [ ]` checkbox prefix

Each row gains a 4-character checkbox prefix in the `renderRow` helper (`src/cli/utils/prompts.ts:285-292`):

```ts
const checked = selected.has(item.id) ? "[x]" : "[ ]";
const cursor = isActive ? "> " : "  ";
return `${cursor} ${checked} ${chalk.dim(item.id)}  ${chalk.cyan(formatDate(item.timestamp))}  ${truncateTitle(item.title)}  ${pin}`;
```

Total prefix width is 8 characters (cursor 2 + space 1 + checkbox 3 + space 1 + space 1 = 8). The title bar gains `Selected: N` next to the existing fields. The hint line becomes `↑↓ navigate · s sort · p profile · f favorites · space select · b bulk · enter pick · q quit`.

### D5. Browser dispatches bulk actions via `CommandRegistry.getHandler` (no new mediator calls)

The existing single-row `executeAction` in `src/cli/commands/list-command.ts:184-206` is extended with a `bulk` case that uses the same `CommandRegistry.getHandler` pattern. The browser does NOT call mediator handlers directly; the bulk commands are real CLI commands invoked with constructed argv. The new `runInteractiveBrowser` flow:

```ts
if (result.kind === "bulk") {
  const bulkAction = await this.showBulkActionMenu(result.selectedChats.length);
  if (bulkAction === "quit") return;
  if (bulkAction === "back") continue;
  await this.executeBulkAction(bulkAction, result.selectedChats, context);
  continue;
}
```

`executeBulkAction` builds argv `[ids.join(","), ...flags]` and invokes the appropriate command's `execute`. This guarantees that any future changes to the single-conversation flow are automatically picked up by the bulk flow (the user's "no code duplication" rule).

### D6. Comma-separated id parsing lives in a shared `extractConversationIds` utility

A new file `src/cli/utils/conversation-id-parser.ts` exports:

```ts
export function extractConversationIds(args: string[]): string[];
```

It walks `args`, skips tokens that start with `--` or `-` (flags) and tokens that are values of `--out` / `--out-dir` / `--format` / `--profile` / `--include-metadata` / `--force` / `--since` / `--after` / `--before` (flag values), collects the remaining positional tokens, splits each on `,`, trims whitespace, drops empties, and dedupes. Returns `string[]`. Throws `GemitermError` with message `Error: at least one conversation ID is required.` if the result is empty.

The three commands (`delete`, `export`, `summarize`) each call this helper, then validate each id via the existing `validateConversationId`. The existing single-id `extractConversationId(args): string | null` private method is **removed** from each command and replaced with the shared utility — no duplicated argv-walking logic.

**Alternative considered:** Have each command keep its own `extractConversationId` private method and add a sibling `extractConversationIds`. Rejected because the user explicitly asked for "no code duplication" and three copies of the same walk is exactly the duplication to avoid.

### D7. `delete` multi-id: single batch confirm, per-id error reporting

`gemiterm delete id1,id2,id3` flow:

1. Parse ids via `extractConversationIds`. If empty, error and exit 1.
2. Validate each id. On any invalid id, error and exit 1.
3. Resolve owning profile per id (calls `ProfileAuthManager.findProfileForConversation` for each; this is the existing per-id lookup in `src/cli/commands/delete-command.ts:87-99`).
4. If `--force` is not set: build a list `• <id> — "<title>"` (title from a mediator `ListChatsQuery` cache) and call `confirm("Delete N conversations?")` once. On `no`, print `Cancelled.` and return.
5. Iterate ids. For each, send `DeleteConversationCommand` with the resolved `profileName`. On `{ success: true }` print `Conversation '<id>' deleted.`. On `{ success: false }` or thrown error, print `Failed to delete conversation '<id>': <message>` in red and continue.
6. After the loop, if any id failed, exit 1; otherwise exit 0.

In multi-profile setups, ids whose owning profile cannot be resolved are skipped with a warning `Skipped '<id>': no owning profile found. Use 'gemiterm list --all-profiles' to see which profile it belongs to.` and the rest of the batch proceeds.

### D8. `export` multi-id: N files, optional `--out-dir`

`gemiterm export id1,id2,id3` flow:

1. Parse ids. If empty, error and exit 1.
2. If `--out` is supplied, it is rejected with `Error: cannot use --out together with comma-separated ids. Specify --out-dir instead.` (a single `--out` makes no sense for N files).
3. If `--out-dir` is supplied, ensure it exists (use the existing `infrastructure/io.ts:ensureDir`). Default is the current working directory.
4. Iterate ids. For each, send `FetchChatQuery`, build the formatted content (existing `formatChatAsMarkdown` / `formatChatAsJson`), and write to `<out-dir>/gemini-chat-<id>-<YYYY-MM-DD>.<ext>` (the existing default filename pattern, just inside `--out-dir`).
5. Print `Exported conversation '<id>' to: <path>` per success. On any failure, print the error and continue.
6. After the loop, print a summary `Exported: <n>` / `Failed: <m>` / `Output: <dir>` (matches the existing `export-all` summary style at `src/cli/commands/export-all-command.ts:139-145`).

### D9. New `SummarizeCommand` and `local-summarizer` service

Two new files:

- `src/cli/commands/summarize-command.ts` — the `SummarizeCommand` class, registered as `summarize`. Handles argv parsing, mediator dispatch for the per-id `FetchChatQuery`s, the file write, the post-action `confirm`, and the conditional `new` spawn.
- `src/services/local-summarizer.ts` — a pure-function module: `summarizeChatsLocally(chats: ChatInfo[], messagesById: Map<string, Message[]>): BulkSummary`. Returns a structured object with `crossReferences: CrossRefGroup[]` and `perNote: PerNoteExtract[]`. The formatter (in `src/infrastructure/formatters.ts`) turns it into markdown.

`SummarizeCommand` flow:

1. Parse ids. If empty, error and exit 1.
2. Send a `ListChatsQuery` (no filter) and a `FetchChatQuery` per id. On any per-id failure, log a warning and continue with the rest.
3. Call `summarizeChatsLocally(chats, messagesById)` and `formatBulkSummary(summary)` to get the file content.
4. Resolve the default output path: `gemiterm-bulk-summary-<YYYY-MM-DD-HHMMSS>.md` in CWD, or the path supplied by `--out/-o`.
5. Write the file and print the path: `Bulk summary written to: <path>`.
6. If `process.stdin.isTTY === true`, call `confirm("Open a new chat with this file as context?")`. On yes, look up the active profile via `ProfileAuthManager.getActiveProfiles()` (or the single default profile) and invoke `CommandRegistry.getHandler("new").execute(["--prompt-file", path, "--profile", profileName], context)`. On no, return normally.
7. If non-TTY, skip the prompt and return (the user can run `gemiterm new --prompt-file <path>` themselves).

### D10. Local-summarizer algorithm (deterministic, offline)

`src/services/local-summarizer.ts` exports two pure functions and the `BulkSummary` type:

```ts
export interface PerNoteExtract {
  id: string;
  title: string;
  timestamp: number;
  keywords: string[];
  excerpt: string; // ≤ 100 tokens, ≈ 75-80 words or ≈ 400 chars
}

export interface CrossRefGroup {
  kind: "date" | "shared-keywords" | "no-related";
  label: string;
  members: string[]; // chat ids
}

export interface BulkSummary {
  generatedAt: string; // ISO timestamp
  perNote: PerNoteExtract[];
  crossReferences: CrossRefGroup[];
}

export function summarizeChatsLocally(
  chats: ReadonlyArray<ChatInfo>,
  messagesById: ReadonlyMap<string, ReadonlyArray<Message>>,
): BulkSummary;

export function formatBulkSummary(summary: BulkSummary): string;
```

**Per-note extract** (≤ 100 tokens):

- `title` from `chat.title` (truncated to 55 chars + `…` via the existing `truncateTitle` helper).
- `excerpt` = the first `User` message of the chat, truncated to ~60 words on a sentence boundary (cut at the last `.` `!` `?` within the first ~60 words; hard-cut at 60 words if no sentence boundary is found). Appended to the title: `[title]\n\n<excerpt>`.
- `keywords` = the top 3 non-stopword tokens by frequency, drawn from `title + excerpt + first 200 chars of all messages`. Lowercased, alphanumeric only, deduped. Stopwords are the standard English set (a, an, the, and, or, of, to, in, is, it, ...).

**100-token cap:** the cap is approximate — the goal is "one screen of plain text per note, fits in a follow-up chat prompt without spilling over the 2048 code-unit CLI arg limit." We enforce a hard cap of 400 characters on `excerpt`; combined with the title + keywords line, the per-note block stays well under 100 tokens.

**Cross-references** (three sub-sections, all optional):

- **By date** — group chats by `YYYY-MM-DD` of their `timestamp`. Emit a group only if ≥ 2 chats share a day. The `label` is the date, the `members` are the chat ids in that day.
- **Shared keywords** — for every pair of chats whose `keywords` arrays share ≥ 2 entries, emit a group `chatA.id ↔ chatB.id: <shared keywords, comma-separated>`. Skip pairs that already appear in a date group to avoid noise.
- **No related notes** — every chat that appears in neither a date group nor a shared-keywords group is listed under a single `No related notes` group. (For N=1 inputs this is the only group.)

**`formatBulkSummary` output** (markdown):

```md
# Bulk summary — N conversations

Generated: 2024-05-28 14:23:01

## Cross-references

### By date
- 2024-05-28: abc123, def456

### Shared keywords
- abc123 ↔ def456: typescript, async

### No related notes
- ghi789

## Notes

### Python tips (`abc123`, 2024-05-28)
**Keywords:** typescript, async, hooks

[first user message excerpt, ≤ 60 words]

### Bun setup (`def456`, 2024-05-28)
...
```

### D11. Post-summarize UX — `Open a new chat with this file as context?`

Per the user's choice, the `summarize` command prompts once after writing the file: `Open a new chat with this file as context? (y/n)`. On yes, the command spawns:

```ts
const newCmd = registry.getHandler("new");
if (newCmd) {
  await newCmd.execute(
    ["--prompt-file", outputPath, ...(profileName ? ["--profile", profileName] : [])],
    context,
  );
}
```

The `new` command (which is a real `CliCommand` already, not a new code path) handles the rest — non-interactive mode if stdin is not a TTY (it isn't at this point), or the interactive REPL if it is. The browser loop is gone by the time we get here (the browser's `runInteractiveBrowser` dispatched the bulk action and `continue`s; if the bulk action calls into a CLI command that doesn't return, the browser loop never re-enters). On `no`, `summarize` returns normally and the browser re-enters with the selection reset.

**Edge case:** the post-summarize prompt is skipped on non-TTY stdin (CI / pipes). The path is still printed, so the user can copy-paste it.

## Risks / Trade-offs

- **[Risk]** The 100-token cap is approximate; users with very long opening messages may get a truncated excerpt that misses the point. → **Mitigation:** the excerpt is cut on a sentence boundary, so the resulting block is always grammatically complete. We also include the title in the per-note block, so even a degenerate excerpt leaves the reader with the topic.

- **[Risk]** The shared-keyword detector is shallow (literal string overlap, no stemming or embeddings). Two chats that discuss the same topic in different vocabulary won't be linked. → **Mitigation:** this is a heuristic, not a synthesis. The user explicitly asked for a client-side algorithm with no Gemini call; the spec describes the algorithm's limits and the document is honest about it.

- **[Risk]** A `space` press in the browser could be confused with the existing `enter` / arrow keys if a terminal sends a different key code. → **Mitigation:** the keypress handler matches `key.name === "space"`, the canonical `@inquirer/core` name for the spacebar. The same convention is used by `@inquirer/select` and other prompts. If a terminal sends something different, the user sees no-op and can re-press; no destructive action is triggered by `space`.

- **[Risk]** Dispatching `summarize` and `new` via `CommandRegistry.getHandler` from within `summarize`'s `execute` could create a re-entrancy loop if `new` ever spawned `summarize` again. → **Mitigation:** `summarize` is a leaf operation — it does not look for a positional chat id argument that could trigger another `summarize` invocation. `new` only takes a message / `--prompt-file` / `--profile`; it never parses `summarize`'s argv shape. Static analysis: a depth-2 walk of the command tree shows no cycle.

- **[Risk]** A bulk delete batch with N>50 ids could take a long time (N mediator round-trips) and the user has no way to abort. → **Mitigation:** the mediator calls are sequential and the user's `Ctrl+C` kills the process. We add a progress line `[i/N] Deleting <id>... OK|FAILED` for N>1 (consistent with `export-all`'s progress line at `src/cli/commands/export-all-command.ts:127-129`).

- **[Risk]** `--out-dir` could shadow the parent directory of a user's existing files. → **Mitigation:** `export` only writes files *into* the directory (it doesn't delete or overwrite anything outside it). If a file with the default name already exists in the dir, `writeTextFile` overwrites it — same behavior as the single-id `export` for the CWD case.

- **[Risk]** The browser's selection state lives in `useState`, which is keyed by component identity. If `@inquirer/core` re-mounts the prompt between filter changes, the selection is lost. → **Mitigation:** the existing browser doesn't re-mount on filter changes (filter changes update `useState` and re-render in place). The same pattern applies to the new selection state.

## Migration Plan

This is an additive change. There is no migration step for users.

- **Backward compatibility** — every existing CLI invocation that takes a single id (`gemiterm delete <id>`, `gemiterm export <id>`) continues to work. The single-id path is a strict subset of the new multi-id path: a one-element list is parsed by `extractConversationIds` and iterated once.
- **Rollout** — the change ships in a single release. No flags are deprecated, no commands are renamed, no mediator contracts change.
- **Rollback** — revert the commit. No data migrations, no schema changes.

## Open Questions

None at write time. The user's clarifications locked the design:

- Combine & Summarize is client-side, 100-token per-note, with a cross-references section and a post-summarize `new --prompt-file` offer.
- Selected rows render with `[x] / [ ]` checkbox prefix.
- Bulk delete uses a single global y/n confirm with the list shown.
- `b` with zero selected prints a hint and stays in the browser.
- Non-interactive `delete` and `export` accept comma-separated ids, alongside the new `summarize` command.
