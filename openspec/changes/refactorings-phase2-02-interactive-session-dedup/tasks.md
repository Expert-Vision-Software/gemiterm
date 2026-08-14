## 1. Shared command invoker

- [ ] 1.1 Create `src/cli/utils/command-invoker.ts` exporting `invokeCommand(commandName, args, context)`: dynamic `import("../command-registry.ts")`, `new CommandRegistry()`, `registerAllCommands()`, `getHandler(commandName)`, throw `Error` naming the missing command when absent, else `await handler.execute(args, context)`.
- [ ] 1.2 In `src/cli/commands/fetch-command.ts`, delete the private `invokeListCommand` (`:71-83`); the no-id path calls `invokeCommand("list", [], context)` after printing the existing `No conversation ID specified. Listing conversations:` notice.
- [ ] 1.3 In `src/cli/commands/continue-command.ts`, delete the private `invokeListCommand` (`:149-161`); the no-id path (`:84-87`) calls `invokeCommand("list", [], context)` with the same notice.
- [ ] 1.4 In `src/cli/commands/list-command.ts`, replace the inline registry block (`:243-245` — dynamic import + `new CommandRegistry()` + `registerAllCommands()`) in the interactive action dispatch with `invokeCommand(<action name>, <args>, context)`.
- [ ] 1.5 Tests in `tests/cli/utils/command-invoker.test.ts`: registered command executes with `(args, context)`; unknown command rejects with an Error naming the command; the `list` notice text is unchanged when routed through the helper.

## 2. Shared chat session dispatch

- [ ] 2.1 Create `src/cli/utils/chat-session.ts` exporting `startChatSession(params)` with `{ effectiveMessage, conversationId?, profileName?, getGeminiClient, logger }` plus a first-turn hook for the `Conversation ID: <id>` print. Non-null message → one-shot send (append when `conversationId` present, else `startNewChat`); null message → `runInteractiveLoop` with a `messageHandler` built from the same params, using the existing `InteractiveLoopDeps` injection (`deps.text`, `CancellationError`) exactly as the commands do today.
- [ ] 2.2 In `src/cli/commands/new-command.ts`, delete `sendNonInteractive`/`startInteractive` (`:74-112`); `execute` becomes arg-parse + conflict checks + `loadEffectivePrompt` + `startChatSession({ effectiveMessage: message, profileName: options.profile, ... })`.
- [ ] 2.3 In `src/cli/commands/continue-command.ts`, delete `sendNonInteractive`/`startInteractive` (`:100-132`); `execute` becomes arg-parse + `resolveProfile` + `loadEffectivePrompt` + `startChatSession({ effectiveMessage: message, conversationId, profileName, ... })`.
- [ ] 2.4 Tests in `tests/cli/utils/chat-session.test.ts`: non-null message sends one-shot with `Model:` label; null message enters REPL (mock `runInteractiveLoop`/`deps.text`); `conversationId` selects `sendMessage` (append) vs `startNewChat`; first-turn hook prints `Conversation ID:` only for new chats.
- [ ] 2.5 Verify byte-equivalence: run `tests/cli/commands/{new,continue,fetch}-command.test.ts` and `tests/cli/utils/interactive-prompt.test.ts` with zero edits to expected output.

## 3. Gates

- [ ] 3.1 Run `bun test` — baseline 657 pass / 0 fail plus the new helper tests; update the baseline number in `openspec/changes/chat-list-bulk-actions/tasks.md` if the total moved.
- [ ] 3.2 Run `bun run typecheck` and `bash scripts/lint-path-mediation.sh` — both clean.
- [ ] 3.3 If `chat-list-bulk-actions` landed before this change, re-baseline the `list-command.ts` line references in task 1.4 before editing (the browser dispatch block will have moved).
