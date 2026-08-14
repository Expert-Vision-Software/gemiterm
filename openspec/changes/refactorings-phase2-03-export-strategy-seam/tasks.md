## 1. Strategy module foundation

- [x] 1.1 Create `src/services/export-strategy.ts`: the `ExportStrategy` interface (`export(input, options): Promise<ExportResult[]>`), the `ExportResult` type (reuse the existing shape from `export-all-command.ts`), the normalized input types (`single`: `{ conversationId, messages, format, out? }`; `batch`: `{ chats: ChatInfo[], outDir }`), and the injected-`fetchChat` constructor contract. No imports from `src/cli/` — only `core/types.ts` and `infrastructure/` modules.
- [x] 1.2 Implement the unified format dispatch: `formatConversation({ messages, title, conversationId, format, includeMetadata })` delegating to `formatChatAsMarkdown` / `formatChatAsJson` (byte-identical delegation; json ignores `title`/`includeMetadata`).
- [x] 1.3 Implement the unified filename strategy: `filenameFor({ kind: "single", conversationId, format })` → `gemini-chat-<id>-<YYYY-MM-DD>.<md|json>` (moved verbatim from `export-command.ts:95-99`); `filenameFor({ kind: "batch", title })` → sanitized-title form (moved verbatim from `export-all-command.ts:120-128`).
- [x] 1.4 Implement `SingleExport`: resolve output path (`--out` or default filename), `ensureDir` on the parent, format via 1.2, `writeTextFile`, return one `ExportResult`. Interface accepts an id list + output directory parameters from day one (used later by `chat-list-bulk-actions`); the current single-id CLI path populates a one-element list.
- [x] 1.5 Implement `BatchExport`: per-profile listing with `Promise.allSettled` + warn/skip, `--since` filtering (moved verbatim from `export-all-command.ts:113-118`), per-chat loop with `[i/N]` progress + `OK`/`FAILED` (`:75-102`), per-chat try/catch error collection (`:96-101`), `index.md` generation (`:130-167`), and the final summary (`:169-181`) — all moved verbatim from the command class.

## 2. Context wiring and thin adapters

- [x] 2.1 Add `exportStrategies: { single: ExportStrategy; batch: ExportStrategy }` to `CliCommandContext` in `src/cli/command-registry.ts`; construct both adapters once in `src/cli/index.ts` with `fetchChat` wired to `fetchChatForRequest` and the logger injected.
- [x] 2.2 Collapse `export-command.ts`: keep `EXPORT_FLAGS` arg parsing, `resolveProfile`, and the fetch call; delete `defaultFilename` (`:95-99`) and the inline format+write block (`:72-79`); delegate to `context.exportStrategies.single`. Output stays byte-equivalent (confirmation line included).
- [x] 2.3 Collapse `export-all-command.ts`: keep `EXPORT_ALL_FLAGS` arg parsing and the initial listing call; delete `sanitizeFilename`, `writeIndex`, `printSummary`, `applyDateFilter`, and the inline batch loop; delegate to `context.exportStrategies.batch`.
- [x] 2.4 If `refactorings-phase2-01` has not landed yet, merge its `profileLifecycle` field with this change's `exportStrategies` field into one `CliCommandContext` edit (both deltas modify the same `CommandRegistry` requirement — do not archive two conflicting copies).

## 3. Tests and gates

- [x] 3.1 Create `tests/services/export-strategy.test.ts`: single/batch delegation returns `ExportResult[]`; markdown/json bytes identical to direct formatter calls; single and batch filename rules (including the 60-char/trailing-dash sanitization); one failing chat recorded and batch continues; per-profile listing warn-and-continue (one skipped; all failing → empty-list path); index.md content and summary lines byte-match the pre-change format; module imports no `src/cli/` path.
- [x] 3.2 Run `tests/cli/commands/export-command.test.ts` and `tests/cli/commands/export-all-command.test.ts` unchanged — every existing assertion (filenames, progress, index, summary, exit codes, `--help`) must pass without editing expected output.
- [x] 3.3 Run `bun test` — record the new baseline and update `openspec/changes/chat-list-bulk-actions/tasks.md` if the total moved.
- [x] 3.4 Run `bun run typecheck` and `bash scripts/lint-path-mediation.sh` — both clean (writes go through `infrastructure/io.ts`; no new `node:fs`/`node:path` imports).
- [x] 3.5 If `chat-list-bulk-actions` landed first, re-baseline the `export-command.ts` line references in tasks 2.2/1.4 before editing, and verify `SingleExport`'s id-list + out-dir parameters match the comma-id `--out-dir` flow bulk-actions added.
