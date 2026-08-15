## Why

Four commands (list, fetch, export, export-all) each independently implement the "fetch data → format → write" pipeline. Revalidation against post-phase-1 HEAD confirms the duplication is real but narrower than the phase-2 doc (`docs/refactorings-phase-2.html` #3) claimed:

- `writeOutput` is duplicated **verbatim** between `list-command.ts:159-162` and `fetch-command.ts:120-123`.
- The sort switch (recent/oldest/alpha comparators) is duplicated **verbatim** between `list-command.ts:108-122` (`applySort`) and the chat-list browser in `src/cli/utils/prompts.ts:210-221`.
- Date-filtering is **re-implemented** (not verbatim) with divergent shapes: `list-command.ts:124-139` takes `(after, before)` two bounds; `export-all-command.ts:113-118` takes `(since)` one bound.
- Every command hand-rolls the stdout-vs-file dispatch (`if (out) writeOutput(...) else console.log(...)`).

Additionally, a **profile-resolution gap** (surfaced in plan review): `listChatsForRequest` (`src/cli/utils/gemini-queries.ts:12-34`) defaults to the default profile only when no `--profile` is given, and its `--all-profiles` path uses fail-fast `Promise.all` (`:27`) — one inaccessible profile aborts the whole listing. This regressed the pre-mediator `Promise.allSettled` + warn-and-skip behavior. Per the approved plan, this change owns that shared-seam fix.

## What Changes

- **New `ChatOutput` module** (`src/cli/utils/chat-output.ts`) exposing `render(data, sink)`: `data` is a typed union (`ChatList | Conversation | BatchExport`), `sink` is `{ format, out? }`. The module owns all formatting strategies (text table, JSON, markdown/json export), the sort and date-filter functions, and the single stdout-vs-file dispatch (`writeTextFile` + `Output written to: <path>` confirmation, or stdout).
- **Single sort home** — `sortChats(chats, order)` replaces both verbatim copies (`list-command.ts:108-122` and the browser's inline switch in `prompts.ts:210-221`); the browser consumes the shared function.
- **Single date-filter home** — `filterChatsByDate(chats, { after?, before?, since? })` unifies the two divergent implementations; invalid date strings keep the current pass-through semantics.
- **Single `writeOutput`** — the verbatim twin private methods in list/fetch are deleted; `render()` is the only stdout-vs-file dispatch.
- **Export paths delegate to the `ExportStrategy` seam** from `refactorings-phase2-03` (this change is sequenced after it); `render()` on `BatchExport` data forwards to `exportStrategies.batch`.
- **BREAKING: `gemiterm list` defaults to all profiles.** Unless `--profile` is explicitly given, the listing aggregates every configured profile, skipping inaccessible ones with a warning (`Promise.allSettled` semantics restored in `listChatsForRequest`). The `--all-profiles` flag remains accepted (now redundant with the default but preserved for script compatibility). In a **single-profile** setup the output remains byte-identical (4-column table); in **multi-profile** setups the default table gains the `PROFILE` column (5 columns). `tests/integration/commands/list.test.ts` expectations for the multi-profile default are deliberately updated — an intentional behavior change, not a regression.
- **`fetch` output paths route through `render()`** with byte-equivalent output.

## Capabilities

### New Capabilities

- `chat-output`: The `ChatOutput` module — the `render(data, sink)` interface, the owned format strategies, the shared sort and date-filter functions, the single stdout-vs-file dispatch, and the delegation of export-shaped data to the `export-strategy` seam.

### Modified Capabilities

- `commands`: `ListCommand` (all-profiles default with warn-and-continue; rendering via `ChatOutput`), `ListCommand Text Output Table` (PROFILE column rule: shown when `--all-profiles` is set or more than one profile is configured), `ListCommand non-interactive byte-equivalence contract` (re-scoped: single-profile byte-equivalence preserved; the multi-profile default intentionally changes), and `FetchCommand` (render delegation, behavior unchanged). ADDED requirement `Multi-Profile Listing Resilience` specs the `listChatsForRequest` default + `Promise.allSettled` warn/skip semantics.

## Impact

- **Code touched**
  - `src/cli/utils/chat-output.ts` — **new** module (`render`, `sortChats`, `filterChatsByDate`, the single write dispatch).
  - `src/cli/utils/gemini-queries.ts` — `listChatsForRequest` default flips to all-profiles (unless `profile` given) and the fan-out switches `Promise.all` → `Promise.allSettled` with per-profile warn/skip.
  - `src/cli/utils/prompts.ts` — browser's inline sort switch (`:210-221`) replaced by the shared `sortChats` (browser behavior unchanged).
  - `src/cli/commands/list-command.ts` (296 lines) — deletes `applySort` (`:108-122`), `applyDateFilter` (`:124-139`), `outputJson`/`outputText` (`:141-157`), `writeOutput` (`:159-162`); fetch → filter → sort → `render`.
  - `src/cli/commands/fetch-command.ts` (132 lines) — deletes `writeOutput` (`:120-123`) and the output helpers; delegates to `render`.
  - `src/cli/commands/export-command.ts` / `export-all-command.ts` — export-shaped rendering routes through `render()` → `exportStrategies` (thin layer on top of 03's adapters).
  - `tests/integration/commands/list.test.ts` — multi-profile default expectations updated (single-profile expectations untouched).
  - `tests/cli/utils/chat-output.test.ts` — **new**.
- **APIs / public surface** — no CLI flags added or removed (`--all-profiles` kept). **BREAKING** behavior: multi-profile default listing spans all profiles with a PROFILE column.
- **Coordination** — depends on `refactorings-phase2-03-export-strategy-seam` (render delegates export paths to it); the in-flight `chat-list-bulk-actions` change asserts "the non-interactive byte-equivalence contract for `gemiterm list` is untouched" — this change intentionally modifies that contract for the multi-profile default, so bulk-actions' conformance note needs a re-read if it lands after this change. Re-baseline line references if bulk-actions landed first.
- **Dependencies** — none beyond 03's seam.
- **Test baseline** — 657 pass / 0 fail at HEAD; count moves with the updated integration expectations + new module tests. Update open changes' baseline numbers.
