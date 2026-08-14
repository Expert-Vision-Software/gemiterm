## Context

Phase-2 item #3 (`docs/refactorings-phase-2.html`), revalidated 2026-08-14 against post-phase-1 HEAD:

- Verbatim duplications confirmed: `writeOutput` (`list-command.ts:159-162` ↔ `fetch-command.ts:120-123`); the sort switch (`list-command.ts:108-122` `applySort` ↔ `prompts.ts:210-221` browser `filteredSorted`).
- Date-filter is a re-implementation, not a duplicate: two bounds (`list-command.ts:124-139`, `after`/`before`, filter-callback with per-bound invalid-date pass-through) vs one bound (`export-all-command.ts:113-118`, `since`, whole-array short-circuit).
- All four output commands hand-roll stdout-vs-file dispatch.
- Profile-resolution gap (approved-plan finding): `listChatsForRequest` (`gemini-queries.ts:12-34`) — no-profile default hits only the default profile (`:33`); `--all-profiles` fan-out uses fail-fast `Promise.all` (`:27`), so one inaccessible profile aborts everything. The pre-mediator `ListChatsQueryHandler` used `Promise.allSettled` with warn+skip (see `docs/re-implement-through-v2-7-2.md` `05da155`); the phase-1 mediator removal regressed this.
- Line counts at HEAD: list 296, fetch 132, export 108, export-all 190. All four use the shared `parseCommandArgs`.
- Sequencing: `-04` lands after `refactorings-phase2-03` (render's export paths delegate to `exportStrategies`) and assumes 01/02 have landed (their context fields exist).

## Goals / Non-Goals

**Goals**

- One `render(data, sink)` call replaces the four format-then-write patterns.
- One sort function (list + browser consume it); one date-filter function covering both bound shapes.
- One stdout-vs-file dispatch with the exact current confirmation-line behavior.
- Default all-profiles listing with warn-and-continue (`Promise.allSettled`), unless `--profile` is explicit.
- Single-profile output byte-identical; multi-profile default output deterministic (PROFILE column when >1 profile configured).
- `tests/integration/commands/list.test.ts` updated deliberately for the multi-profile default.

**Non-Goals**

- No new output formats (CSV etc.) — the render strategies make them cheap later; none added now.
- No changes to the browser's UX (sort cycling, filters, paging) — only its sort implementation source changes.
- No changes to `fetch`'s output text.
- No changes to `resolveProfile`'s per-conversation routing (`profile-resolution.ts`) — that throws-on-unresolvable contract stays; only the *listing* default changes.
- No rework of the `export-strategy` seam (03's scope); `render` forwards to it.

## Decisions

1. **`ChatOutput` is a stateless plain module in `src/cli/utils/chat-output.ts`, not a context-injected service.** It holds no state, performs no I/O beyond the mediated `writeTextFile`, and its seams (sort/filter/format) are pure functions — plain imports keep it testable without DI and avoid a third `CommandRegistry` field delta on top of 01's `profileLifecycle` and 03's `exportStrategies`. *Alternative:* context injection for symmetry — rejected; three additive context fields in one phase is interface-area growth the review is trying to avoid, and a pure module needs no injection.

2. **Data union: `ChatList | Conversation | BatchExport`.** `{ kind: 'chat-list', chats }`, `{ kind: 'conversation', conversationId, messages }`, `{ kind: 'batch-export', ... }`. Sink `{ format, out? }`. Export-shaped kinds forward to the `export-strategy` seam (03) rather than formatting inline — `render` is the single entry, the strategy remains the export brain. *Alternative:* render everything inline including exports — rejected; duplicates 03's dispatch and breaks its seam.

3. **PROFILE column rule: render 5 columns iff `--all-profiles` is set OR more than one profile is configured.** Single-profile setups keep the 4-column table byte-identical (the overwhelmingly common case, and the one the integration suite pins). Multi-profile defaults show ownership, which is the information the new default exists to surface. *Alternative:* always 5 columns — rejected; breaks single-profile byte-equivalence for no informational gain. *Alternative:* column iff the *result* spans multiple profiles — rejected; non-deterministic on chat distribution (a second empty profile would flip the table shape run to run).

4. **`listChatsForRequest` default flips to all-profiles; `--profile` wins; explicit `--all-profiles` stays as a no-op-for-compat accepted flag.** Fan-out switches to `Promise.allSettled` with per-profile `logger.warn` + skip; empty aggregate falls through to the existing `No conversations found.` path. *Alternative:* keep default-profile default and only fix the fan-out — rejected; the approved plan's requirement is "default to all profiles unless profile specified". *Alternative:* drop `--all-profiles` — rejected; scripts in the wild pass it; keeping it accepted (now redundant) is the compatible choice.

5. **One date-filter function, two bound shapes, current pass-through semantics.** `filterChatsByDate(chats, { after?, before?, since? })` — invalid date strings leave the list unfiltered (both current implementations already do this), `since` is sugar for `after` with `>=` semantics preserved per call site. *Alternative:* harden invalid dates into errors — rejected; a silent behavior change outside this change's mandate.

6. **Browser consumes `sortChats` but keeps its own render.** The browser's row rendering, paging, and filters are UX concerns that stay in `prompts.ts`; only the sort comparator source is shared. *Alternative:* move the browser's whole filteredSorted pipeline into ChatOutput — rejected; couples a TUI to an output module.

## Risks / Trade-offs

- [Risk] The BREAKING default changes scripted `gemiterm list` output in multi-profile setups. → Mitigation: single-profile byte-equivalence is preserved and pinned by tests; the change is flagged BREAKING in the proposal; `--profile <name>` restores exact per-profile output; CHANGELOG entry required at implementation time.
- [Risk] `chat-list-bulk-actions` (in flight) leans on the current `list` byte-equivalence contract. → Mitigation: its proposal's conformance note is re-read when it lands; the bulk browser itself is already multi-profile aware (profile filter `p`, PROFILE column), so the new default feeds it compatible data. If it lands first, re-baseline this change's line refs.
- [Risk] Three changes (01/03/04) all touch `commands`-spec requirements; MODIFIED blocks can conflict at archive time. → Mitigation: recommended order 01 → 02 → 03 → 04; 04's deltas are written against the post-01/post-03 requirement text; archive sequentially, re-syncing specs between archives.
- [Risk] Fan-out to N profiles multiplies API calls on every bare `gemiterm list`. → Mitigation: same call volume as today's explicit `--all-profiles`; profiles are typically few; failures no longer abort the whole command (strict improvement).

## Migration Plan

1. Land `chat-output.ts` (sort/filter/render) + list/fetch re-pointing with single-profile equivalence — tests green.
2. Land the `listChatsForRequest` default + fan-out fix + integration-expectation updates in the same change (the behavior and its tests move together).
3. 03 (if not already landed) then routes export rendering through `render()`; bulk-actions composes last.
4. Rollback is a revert; no persisted state.

## Open Questions

- None blocking. (Whether `render()` grows a `csv` format later is a future change; the strategy union is closed for now.)
