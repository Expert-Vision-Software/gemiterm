## Why

Phase-2 item #4 (`docs/refactorings-phase-2.html`, "Deepen the Interactive Chat Session") proposed consolidating a ~30-line spillover-to-temp-file block claimed to be duplicated verbatim between `new-command.ts` and `continue-command.ts`. Revalidation against the post-phase-1 codebase shows that premise is **obsolete**: the spillover flow, arg guard, and prompt-file loading were already extracted into `src/cli/utils/prompt-file.ts` (`loadEffectivePrompt`) and `src/cli/utils/long-arg-guard.ts` (`checkArgLength`) — both commands now call `loadEffectivePrompt` in one line. What actually remains duplicated today:

1. **`invokeListCommand` is byte-identical in two files** — `continue-command.ts:149-161` and `fetch-command.ts:71-83` (dynamic `import("../command-registry.ts")` + `new CommandRegistry()` + `registerAllCommands()` + `getHandler("list")` + execute + the same "No conversation ID specified" notice). A third partial site shares the same import+construct+register boilerplate for action dispatch in `list-command.ts:243-245`.
2. **The interactive/non-interactive mode branch is structurally duplicated** — `if (message) sendNonInteractive(...) else startInteractive(...)` with parallel private-method pairs in `new-command.ts:67-71` and `continue-command.ts:93-97`.

This change removes exactly those two duplications. It is deliberately re-scoped down from the phase-2 doc's full "InteractiveSession" deepening — no new module over the REPL itself (`interactive-prompt.ts` is a clean 72-line loop that stays as-is).

## What Changes

- **New shared command invoker** `src/cli/utils/command-invoker.ts` exporting `invokeCommand(commandName, args, context)`: owns the dynamic `CommandRegistry` import, construction, `registerAllCommands()`, handler lookup, and execution. `continue-command.ts` and `fetch-command.ts` drop their verbatim twin `invokeListCommand` methods and call `invokeCommand("list", [], context)`; `list-command.ts`'s interactive action dispatch uses the same helper instead of its inline import+construct+register block.
- **New shared chat session dispatch** `src/cli/utils/chat-session.ts` exporting `startChatSession(params)`: owns the interactive/non-interactive mode branch and the `messageHandler` construction shared by `new` and `continue` (one-shot send when an effective message exists; REPL via `runInteractiveLoop` otherwise), parameterized on optional `conversationId` (continue) and `profile` (new/continue).
- **`new-command.ts` and `continue-command.ts` shrink to arg-parsing + profile resolution + one `startChatSession` call.** No behavior moves in or out of the prompt layer — interactive I/O continues to route through the `prompts.ts` facade and `runInteractiveLoop`'s `InteractiveLoopDeps` injection point.
- **Pure dedup — zero user-visible change.** Flags, output text, exit codes, prompt behavior, REPL semantics, and `--prompt-file` handling are byte-equivalent to the current baseline.

## Capabilities

### New Capabilities

(None.)

### Modified Capabilities

- `commands`: ADDED requirements for the two shared helpers — a `Shared Command Invocation Helper` requirement (the `invokeCommand` seam replacing the duplicated `invokeListCommand` methods and the `list-command` inline registry block) and a `Shared Chat Session Dispatch` requirement (the `startChatSession` seam owning the mode branch). These follow the established pattern of the phase-1 `Shared Command Argument Parsing` and `Shared Prompt Spillover` requirements. No existing requirement's user-visible behavior changes; `FetchCommand`, `ContinueCommand`, and `NewCommand` keep their documented contracts.

## Impact

- **Code touched**
  - `src/cli/utils/command-invoker.ts` — **new** (~20 lines).
  - `src/cli/utils/chat-session.ts` — **new** (~60 lines).
  - `src/cli/commands/continue-command.ts` (170 lines) — deletes `invokeListCommand` (`:149-161`) and the `sendNonInteractive`/`startInteractive` pair (`:100-132`); net shrink.
  - `src/cli/commands/fetch-command.ts` (132 lines) — deletes `invokeListCommand` (`:71-83`).
  - `src/cli/commands/new-command.ts` (121 lines) — deletes its `sendNonInteractive`/`startInteractive` pair (`:74-112`).
  - `src/cli/commands/list-command.ts` (296 lines) — the interactive action-dispatch block (`:243-245`) routes through `invokeCommand`.
  - `tests/cli/commands/{continue,fetch,new,list}-command.test.ts` — existing assertions pass unchanged; new unit tests for both helpers.
- **APIs / public surface** — none. Both helpers are internal `src/cli/utils` modules; no CLI flags or output change.
- **Dependencies** — none.
- **Sensitive areas** — the prompt layer is untouched except as a consumer: `chat-session.ts` calls `runInteractiveLoop` with the same `InteractiveLoopDeps` the commands build today. `prompt-file.ts`, `long-arg-guard.ts`, `interactive-prompt.ts`, and `prompts.ts` are not modified.
- **Test baseline** — 657 pass / 0 fail at HEAD; count grows by the new helper tests. Update the baseline number in open changes' `tasks.md` if the total moves.
