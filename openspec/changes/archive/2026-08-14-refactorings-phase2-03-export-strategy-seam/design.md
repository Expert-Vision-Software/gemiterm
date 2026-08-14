## Context

Phase-2 item #5 (`docs/refactorings-phase-2.html`), revalidated 2026-08-14 against post-phase-1 HEAD:

- `export-command.ts` (108 lines): inline format+write at `:72-79` (branches on `options.format` between `formatChatAsJson(messages, id)` and `formatChatAsMarkdown(messages, id, id, includeMetadata)`), `defaultFilename` at `:95-99` (`gemini-chat-<conversationId>-<YYYY-MM-DD>.<ext>`, ext by format), has `--format` (`:24`).
- `export-all-command.ts` (190 lines): hardcoded markdown at `:85-92`, `sanitizeFilename` at `:120-128` (title-sanitized, 60-char cap, trailing-dash strip, `.md`), batch loop `:75-102` with `[i/N]` progress (`:77-78`, `OK`/`FAILED` tails), per-chat try/catch error collection (`:96-101`), `writeIndex` `:130-167`, `printSummary` `:169-181`, `applyDateFilter` `:113-118`. No `--format` flag.
- Formatter asymmetry: `formatChatAsMarkdown(messages, title, conversationId?, includeMetadata?)` vs `formatChatAsJson(messages, conversationId)` (`formatters.ts:27-32`, `:58-60`).
- No export seam exists anywhere in `src/` (only `PlaywrightStrategy` in the playwright driver, unrelated). Data access is already mediated by `src/cli/utils/gemini-queries.ts` + `profile-resolution.ts` — the doc's client-access framing was misleading; the gap is formatting + filename + write.
- In-flight `chat-list-bulk-actions` plans comma-separated ids + `--out-dir/-d` on `gemiterm export` and a new `summarize` command/formatter.

Sequencing: this change is `-03` — lands after `refactorings-phase2-01/-02` and before `refactorings-phase2-04` (whose `ChatOutput.render()` delegates export paths to this seam). It assumes 01's `profileLifecycle` context field exists; if 01 has not landed, merge the field additions into one edit.

## Goals / Non-Goals

**Goals**

- One seam, two real adapters (`SingleExport`, `BatchExport`) behind `export(input, options): Promise<ExportResult[]>`.
- Hide the formatter asymmetry behind one internal format-dispatch signature; formatters stay byte-identical engines in `infrastructure/formatters.ts`.
- One filename strategy with two documented rules (single: id-based + format-aware ext; batch: title-sanitized + `.md`).
- Move batch iteration / progress / error collection / index generation out of the command class.
- Warn-and-continue: per-chat failures (existing semantics) and per-profile listing failures (new) never abort the batch.
- Byte-equivalent CLI behavior; zero flag changes.
- Forward-compatible with `chat-list-bulk-actions`: `SingleExport` accepts an id list + out-dir at the interface level from day one.

**Non-Goals**

- No new output formats (CSV/HTML) — the seam makes them cheap later; this change adds none.
- No CLI surface changes (`--out-dir`, comma ids belong to `chat-list-bulk-actions`).
- No changes to `formatters.ts` exports or signatures.
- No changes to data fetching (`gemini-queries.ts` fan-out defaults belong to `refactorings-phase2-04`).
- No `export-all --format json` — batch stays markdown-only, as today.

## Decisions

1. **Interface returns `ExportResult[]` from both adapters.** `SingleExport` returns a one-element array; `BatchExport` returns one entry per chat. *Alternative:* distinct return types per adapter — rejected; a uniform result array is what both commands' summary/reporting code consumes, and it keeps "two adapters, one interface" honest.

2. **The strategy owns format + filename + write; fetching stays injected.** Adapters receive a `fetchChat(conversationId, profileName?) => Promise<Message[]>` callback (wired to `fetchChatForRequest` at the composition root). *Alternative:* strategy imports `gemini-queries.ts` directly — rejected; `src/services/` must not depend on `src/cli/utils/` (layering), and the callback keeps the adapter unit-testable with fake fetchers. *Alternative:* commands fetch and pass prepared conversations — rejected for batch, because "batch iteration" is exactly the concern moving out of the command class.

3. **Format dispatch reconciles the asymmetry with a normalized internal record.** Internal signature: `formatConversation({ messages, title, conversationId, format, includeMetadata }): string` — json ignores `title`/`includeMetadata`, markdown uses all four; the mismatch disappears behind the record. `formatChatAsMarkdown` / `formatChatAsJson` remain the engines (byte-identical output guaranteed by delegating, not reimplementing). *Alternative:* change the formatters' signatures to match — rejected; that touches `formatters.ts` spec surface and every existing formatter test for zero behavioral gain.

4. **Filename strategy = one module function with two rules, not one merged rule.** `filenameFor({ kind: 'single', conversationId, format })` → `gemini-chat-<conversationId>-<YYYY-MM-DD>.<md|json>`; `filenameFor({ kind: 'batch', title })` → sanitized-title form. The two current behaviors are deliberately different (id is already filesystem-safe; titles are not) — unifying the *implementation*, not the *rule*. *Alternative:* sanitize ids too — rejected; changes the single-export default filename (byte-equivalence break).

5. **BatchExport listing does its own `allSettled` fan-out over profiles.** The current `listChatsForRequest` all-profiles path fails fast (`Promise.all`, `gemini-queries.ts:27`); the batch adapter therefore performs its own per-profile listing with `Promise.allSettled` + warn/skip. *Alternative:* fix `listChatsForRequest` here — rejected; that shared-seam fix (including the all-profiles *default* change) is owned by `refactorings-phase2-04`. Design note for 04: when its fan-out helper lands, `BatchExport` should delegate to it and drop the private copy.

6. **Context injection over constructor injection.** `context.exportStrategies = { single, batch }` built in `src/cli/index.ts`, matching the phase-2 doc and the 01 precedent (`profileLifecycle`). *Alternative:* constructor-inject adapters in `registerAllCommands()` — rejected; inconsistent with the context pattern every non-installer command now follows.

## Risks / Trade-offs

- [Risk] Byte-drift in filenames/progress/index during the move. → Mitigation: every existing `tests/cli/commands/{export,export-all}-command.test.ts` assertion must pass unedited; the strategy's own tests assert the exact filename patterns and index shape.
- [Risk] Overlap with `chat-list-bulk-actions` on `export-command.ts`. → Mitigation: this change touches format+write internals only; bulk-actions' comma-id parsing and `--out-dir` flag land on top of the thin adapter. If bulk-actions lands first, re-baseline line refs; either order converges on the same seam.
- [Risk] Two context-field deltas (`profileLifecycle` in 01, `exportStrategies` here) modify the same `CommandRegistry` requirement. → Mitigation: sequencing is 01 → 03; 03's delta is written against the post-01 field list; if they land out of order, merge both fields in one edit before archiving either.
- [Risk] `src/services/` module depending on CLI-layer types (`ChatInfo`). → Mitigation: fetcher + types are injected/plain-domain; the module imports only `core/types.ts` and `infrastructure/` modules, keeping layering clean.

## Migration Plan

1. Land `export-strategy.ts` + context field + thin adapters in one change; existing export tests pass unedited.
2. `refactorings-phase2-04` then routes `ChatOutput.render()`'s export paths through this seam; bulk-actions composes on the same adapters.
3. Rollback is a single revert; no persisted state, no config format change.

## Open Questions

- None blocking. (Whether `summarize` from bulk-actions becomes a third adapter or a formatter inside `SingleExport` is bulk-actions' call; the seam accommodates both.)
