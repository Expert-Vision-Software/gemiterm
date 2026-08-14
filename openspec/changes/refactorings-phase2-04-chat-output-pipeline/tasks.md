## 1. ChatOutput module

- [x] 1.1 Create `src/cli/utils/chat-output.ts` with the `render(data, sink)` entry: the `ChatList | Conversation | BatchExport` data union, the `{ format, out? }` sink, the single stdout-vs-file dispatch (`writeTextFile` + `Output written to: <path>` via `chalk.dim`, or `console.log`). Chat-list text delegates to `formatChatList`; conversation text reproduces the `Conversation: <id>` / `User:` / `Model:` output byte-identically; JSON strategies reproduce `{ chats }` / `{ conversationId, messages }`.
- [x] 1.2 Implement `sortChats(chats, order)` (moved verbatim from `list-command.ts:108-122`): recent/oldest timestamp comparators + alpha `localeCompare`; input not mutated.
- [x] 1.3 Implement `filterChatsByDate(chats, { after?, before?, since? })`: unify `list-command.ts:124-139` (two bounds, per-bound invalid-date pass-through) and `export-all-command.ts:113-118` (`since`, on-or-after, invalid/missing pass-through); input not mutated.
- [x] 1.4 Implement export forwarding: conversation/batch export formats forward to the `ExportStrategy` adapters from `refactorings-phase2-03` (via the injected context strategies passed by the command); `chat-output.ts` holds no export formatting of its own.
- [x] 1.5 Tests in `tests/cli/utils/chat-output.test.ts`: render dispatch (file+confirmation vs stdout) for every kind; JSON shapes; conversation text byte-shape; sort modes + no-mutation; date-filter bounds/invalid pass-through/since; export forwarding (strategy spy called, no inline formatting).

## 2. Shared-seam listing fix (gemini-queries.ts)

- [x] 2.1 In `src/cli/utils/gemini-queries.ts`, flip `listChatsForRequest` default: no `profile` → iterate all configured profiles via `Promise.allSettled` (replacing the fail-fast `Promise.all` at `:27`), warn+skip rejected profiles naming them, aggregate fulfilled results merged by descending timestamp, resolve `[]` when all reject. Explicit `profile` targets exactly that profile with no fan-out. The `allProfiles` flag maps onto the same path.
- [x] 2.2 Tests in `tests/cli/utils/gemini-queries.test.ts` (extend the existing suite): default spans all profiles; one rejected profile warns and skips; all rejected resolves `[]`; explicit profile does no fan-out.

## 3. Command re-pointing

- [x] 3.1 `src/cli/commands/list-command.ts`: delete `applySort` (`:108-122`), `applyDateFilter` (`:124-139`), `outputJson`/`outputText` (`:141-157`), `writeOutput` (`:159-162`); flow becomes fetch → `filterChatsByDate` → `sortChats` → `render` with `includeProfileColumn: allProfiles || configuredProfiles > 1`. Add the `--profile/-p <name>` flag to `LIST_FLAGS` (scoped listing; 4-column table).
- [x] 3.2 `src/cli/utils/prompts.ts`: replace the browser's inline comparator switch (`:210-221`) with the shared `sortChats`; no other browser behavior changes (`tests/cli/utils/chat-list-browser.test.ts` passes unedited).
- [x] 3.3 `src/cli/commands/fetch-command.ts`: delete `writeOutput` (`:120-123`) and the output helpers; route text/json output through `render`.
- [x] 3.4 `src/cli/commands/export-command.ts` and `export-all-command.ts`: route their output paths through `render` forwarding to the strategy adapters (thin layer over 03; if 03 has not landed, keep their current output calls and land only this task's list/fetch half — do not fork the export formatting).
- [x] 3.5 `src/cli/commands/continue-command.ts` and the shared invoker (from `refactorings-phase2-02`): no changes expected — verify the `list` invocation from `continue`/`fetch` with no id still renders the aggregated default correctly.

## 4. Integration expectations and gates

- [x] 4.1 Update `tests/integration/commands/list.test.ts`: multi-profile default expectations (aggregated, PROFILE column, warn/skip on inaccessible profile); single-profile expectations and all `--profile`/`--search`/`--sort`/`--limit`/`--offset`/`--out` expectations remain unedited.
- [x] 4.2 Verify `tests/cli/list-command.test.ts` and `tests/cli/commands/list.test.ts` unit expectations: single-profile cases pass unedited; add cases for the multi-profile default and the `--profile` flag.
- [x] 4.3 Verify `tests/cli/utils/prompts.test.ts` and `tests/cli/utils/chat-list-browser.test.ts` pass unedited (browser sort source changed, behavior identical).
- [x] 4.4 Run `bun test` — record the new baseline; update `openspec/changes/chat-list-bulk-actions/tasks.md` and any other open change's baseline number if the total moved.
- [x] 4.5 Run `bun run typecheck` and `bash scripts/lint-path-mediation.sh` — both clean.
- [x] 4.6 Add a CHANGELOG entry for the BREAKING multi-profile default at implementation time; re-read `chat-list-bulk-actions`' conformance note ("non-interactive byte-equivalence contract for `gemiterm list` is untouched") and reconcile it with this change before that change's implementation begins. If bulk-actions landed first, re-baseline all line references in this tasks file before editing.
