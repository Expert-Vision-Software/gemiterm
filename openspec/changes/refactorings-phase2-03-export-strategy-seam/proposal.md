## Why

`export-command.ts` (108 lines) and `export-all-command.ts` (190 lines) each independently implement the "format then write" pattern with no seam between them. `export-all` inlines batch iteration (`:75-102`), progress reporting (`:77-78`), error collection (`:96-101`), and index-file generation (`writeIndex`, `:130-167`) inside the command class. The format decision is asymmetric — `formatChatAsMarkdown(messages, title, conversationId?, includeMetadata?)` takes 4 params while `formatChatAsJson(messages, conversationId)` takes 2 (`src/infrastructure/formatters.ts:27-32`, `:58-60`) — so callers must know each formatter's shape. The filename logic is similar-but-different in two places (`sanitizeFilename` at `export-all-command.ts:120-128` vs `defaultFilename` at `export-command.ts:95-99`). Adding a new export format today would touch both command files and the formatters module.

Revalidation corrections vs the phase-2 doc (`docs/refactorings-phase-2.html` #5): the doc's filename line references were stale (now `120-128` / `95-99`), and its framing overlooked that client access is already mediated — commands fetch via `src/cli/utils/gemini-queries.ts` and `src/cli/utils/profile-resolution.ts`. The missing seam is specifically **formatting + filename + write**, not data access.

## What Changes

- **New `ExportStrategy` seam** (`src/services/export-strategy.ts`): one interface `export(input, options): Promise<ExportResult[]>` with two real adapters behind it — `SingleExport` (one conversation → one file) and `BatchExport` (many conversations → directory with `index.md`). Two variants behind one interface is the "two adapters = real seam" principle.
- **Unified format dispatch inside the strategy** — the markdown(4-param)/json(2-param) formatter asymmetry is reconciled behind one internal conversation-formatting signature; adapters pick the formatter by format type. `formatChatAsMarkdown` / `formatChatAsJson` remain the rendering engines (their output is byte-equivalent) and stay in `src/infrastructure/formatters.ts`.
- **Unified filename strategy** — the single-export id-based default (`gemini-chat-<conversationId>-<YYYY-MM-DD>.<ext>`, ext by format) and the batch title-sanitized form (`gemini-chat-<sanitized-title>-<YYYY-MM-DD>.md`) become two documented rules of one strategy instead of two private methods in two command files.
- **BatchExport owns what the command class owns today** — batch iteration, `[i/N]` progress lines, per-chat error collection, `index.md` generation, and the final summary move into the adapter.
- **Warn-and-continue batching** — a chat (or profile) that fails during batch iteration logs a warning and the batch proceeds with the rest; the existing per-chat try/catch semantics (`:96-101`) are preserved and extended to the profile-listing step of the batch.
- **`export-command.ts` and `export-all-command.ts` become thin adapters** — parse args, fetch via the existing `gemini-queries` helpers, delegate to `context.exportStrategies.single` / `.batch`. All user-visible behavior (filenames, progress lines, index content, summary, exit codes) is byte-equivalent.
- **`CliCommandContext` gains `exportStrategies: { single, batch }`** — constructed once in `src/cli/index.ts`.
- **Forward-compatibility with `chat-list-bulk-actions` (in flight)** — the `SingleExport` adapter accepts an id list and an output directory from day one, so the bulk-actions change (comma-separated ids + `--out-dir` on `gemiterm export`) composes through the same seam without re-editing command internals. If bulk-actions lands first, re-baseline line references before implementing this change.

## Capabilities

### New Capabilities

- `export-strategy`: The `ExportStrategy` seam — the `SingleExport` / `BatchExport` adapters, the unified format dispatch (formatter asymmetry hidden), the unified filename strategy, warn-and-continue batch iteration with progress/error/index reporting, and the context injection of the adapters.

### Modified Capabilities

- `commands`: `ExportCommand` and `ExportAllCommand` requirements change at the spec level — they MUST delegate formatting/filename/write work to the injected strategy adapters instead of implementing it inline, and the batch path's profile-listing step gains warn-and-continue semantics. All user-visible output stays byte-equivalent. The `CommandRegistry` requirement's `CliCommandContext` field list gains `exportStrategies`.

## Impact

- **Code touched**
  - `src/services/export-strategy.ts` — **new** module (interface, `SingleExport`, `BatchExport`, shared format dispatch, shared filename strategy).
  - `src/cli/command-registry.ts` — `CliCommandContext` gains `exportStrategies`.
  - `src/cli/index.ts` — construct the adapters (with the `gemini-queries` fetchers and logger injected) once; add to context.
  - `src/cli/commands/export-command.ts` (108 lines) — drops `defaultFilename` (`:95-99`) and the inline format+write block (`:72-79`); delegates to `context.exportStrategies.single`.
  - `src/cli/commands/export-all-command.ts` (190 lines) — drops `sanitizeFilename` (`:120-128`), `writeIndex` (`:130-167`), `printSummary` (`:169-181`), and the inline batch loop (`:75-102`); delegates to `context.exportStrategies.batch`.
  - `src/infrastructure/formatters.ts` — NOT modified (strategy delegates to the existing formatters).
  - `tests/services/export-strategy.test.ts` — **new**; existing `tests/cli/commands/{export,export-all}-command.test.ts` assertions pass unchanged.
- **APIs / public surface** — `CliCommandContext` gains one field (additive). No CLI flag changes in this change. `ExportResult` shape reused from the existing export-all implementation.
- **Coordination** — in-flight `chat-list-bulk-actions` modifies `export-command.ts` (comma ids, `--out-dir`) and adds a summarize formatter. This change is sequenced **before** `refactorings-phase2-04-chat-output-pipeline` (whose `render()` delegates to this seam) and designed so bulk-actions composes through it; if bulk-actions lands first, re-baseline.
- **Path mediation** — writes go through `infrastructure/io.ts` (`writeTextFile`, `ensureDir`); the strategy adds no direct `node:fs` usage.
- **Dependencies** — none.
- **Test baseline** — 657 pass / 0 fail at HEAD; count grows by the new strategy tests. Update open changes' baseline numbers if the total moves.
