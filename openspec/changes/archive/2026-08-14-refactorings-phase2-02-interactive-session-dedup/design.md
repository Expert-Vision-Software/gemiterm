## Context

Phase 2 of the architecture review proposed a full "InteractiveSession — `startChat(params)`" module for the chat commands. Revalidation (2026-08-14) against post-phase-1 HEAD found the doc's core premise obsolete:

- The ~30-line spillover/prompt-file/arg-guard duplication the doc targeted **already exists as extracted helpers**: `src/cli/utils/prompt-file.ts` (71 lines: `loadEffectivePrompt`, `spillOverToTempFile`, `loadPromptFromFile`) and `src/cli/utils/long-arg-guard.ts` (28 lines: `checkArgLength`). Both commands call `loadEffectivePrompt(message, options.promptFile)` in one line (`new-command.ts:65`, `continue-command.ts:91`).
- `interactive-prompt.ts` is a clean 72-line REPL loop (`runInteractiveLoop(messageHandler, options, deps)`) with a testable `InteractiveLoopDeps` injection point — already deep.

What is actually still duplicated (verified):

- `invokeListCommand` — byte-identical private methods at `continue-command.ts:149-161` and `fetch-command.ts:71-83` (dynamic import of `CommandRegistry`, `new CommandRegistry()`, `registerAllCommands()`, `getHandler("list")`, `"No conversation ID specified. Listing conversations:\n"` notice, `execute([], context)`). A third partial site at `list-command.ts:243-245` repeats the import+construct+register boilerplate for interactive action dispatch (fetch/export/continue routing).
- Mode branch — `new-command.ts:67-71` and `continue-command.ts:93-97` both implement `if (message) sendNonInteractive(...) else startInteractive(...)` with parallel private-method pairs that build a `messageHandler` closure and call `runInteractiveLoop` (new: `new-command.ts:74-112`; continue: `continue-command.ts:100-132`). Signatures differ only by `conversationId` (continue-only) and `profileName` plumbing.

## Goals / Non-Goals

**Goals**

- Delete the verbatim `invokeListCommand` twins and generalize the third registry-boilerplate site behind one `invokeCommand(commandName, args, context)` helper.
- Delete the duplicated mode-branch/method-pair shape behind one `startChatSession(params)` helper.
- Zero user-visible change — byte-equivalent output, prompts, exit codes, REPL semantics.

**Non-Goals**

- No new "InteractiveSession" module over the REPL — `interactive-prompt.ts` stays as-is.
- No changes to `prompt-file.ts`, `long-arg-guard.ts`, `prompts.ts` facade, or `interactive-prompt.ts`.
- No CLI flag changes, no `startChat`-style new public surface — the helper is internal.
- No touching `list-command.ts`'s interactive browser logic beyond routing its action dispatch through the shared invoker (multi-select/bulk work belongs to the in-flight `chat-list-bulk-actions` change).

## Decisions

1. **One `invokeCommand(commandName, args, context)` helper in a new `src/cli/utils/command-invoker.ts`.** It owns the dynamic import, registry construction, `registerAllCommands()`, lookup, and execution. *Alternative:* put it in `gemini-queries.ts` — rejected; that module is about data fetching (`listChatsForRequest` / `fetchChatForRequest`), not command dispatch, and mixing them recreates the shallow-module problem this phase is fixing. *Alternative:* a singleton registry exported from `command-registry.ts` — rejected; dynamic import is deliberate (keeps `command-registry` out of the hot path and preserves current load behavior).

2. **`startChatSession(params)` in a new `src/cli/utils/chat-session.ts`, parameterized — not a god-object.** `params` carries `{ effectiveMessage, conversationId?, profile?, getGeminiClient, logger }`. With `effectiveMessage` non-null it performs the one-shot send; null enters the REPL. `conversationId` presence selects `sendMessage` vs `startNewChat` semantics exactly as the two commands do today. *Alternative:* the phase-2 doc's full `InteractiveSession.startChat` owning spillover/guard/prompt-file too — rejected; those already live in `prompt-file.ts` and would be re-shallowed, not deepened, by a second owner.

3. **Keep per-command output construction at the call sites where it genuinely differs.** `new` prints `Conversation ID: <id>` on first turn; `continue` targets an existing conversation. The helper threads a `onFirstTurn`-style hook rather than branching internally on command identity. *Alternative:* unify the printing inside the helper — rejected; it would couple the helper to two commands' cosmetic choices and risk byte drift.

4. **Behavior-neutral spec strategy: ADDED requirements only.** The `FetchCommand`/`ContinueCommand`/`NewCommand` requirements' user-visible contracts are untouched, so they are not MODIFIED; the two new seams get their own ADDED requirements in the `commands` capability, following the phase-1 precedent (`Shared Command Argument Parsing`, `Shared Prompt Spillover`).

## Risks / Trade-offs

- [Risk] The dynamic-import behavior of `invokeCommand` could subtly change module load order. → Mitigation: the helper performs the identical `await import("../command-registry.ts")` the call sites perform today; existing command tests (which spy on registry dispatch) must pass unchanged.
- [Risk] `chat-list-bulk-actions` (in flight) also edits `list-command.ts` interactive dispatch. → Mitigation: this change routes only the existing `:243-245` boilerplate through `invokeCommand` and does not touch the action-menu semantics; if bulk-actions lands first, re-baseline the line references in tasks before implementing.
- [Risk] Mode-branch unification could byte-drift REPL banners. → Mitigation: banner strings move verbatim; the existing `tests/cli/utils/interactive-prompt.test.ts` and command tests assert the current text.

## Migration Plan

1. Land `command-invoker.ts` + re-point continue/fetch/list in one commit; run `bun test`.
2. Land `chat-session.ts` + re-point new/continue in a second commit; run `bun test`.
3. Rollback is a plain revert per commit; no persisted state.

## Open Questions

- None blocking.
