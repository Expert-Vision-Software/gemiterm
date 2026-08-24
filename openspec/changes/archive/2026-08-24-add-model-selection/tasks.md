## 1. Wrapper seam

- [x] 1.1 Add `model?: string` as the third parameter of `GeminiClientService.sendMessage` (`src/services/gemini-client-wrapper.ts:265`); pass through `buildSession` (line 255) to `this.client!.newChat({ model })` only when the argument is a non-empty string; preserve `client.newChat()` (no args) when omitted or empty.
- [x] 1.2 Add `model?: string` as the second parameter of `GeminiClientService.startNewChat` (`src/services/gemini-client-wrapper.ts:299`); same conditional passthrough as 1.1.
- [x] 1.3 Add a new `getDefaultModel()` method to `GeminiClientService` (`src/services/gemini-client-wrapper.ts`). Resolution order: trimmed `process.env.GEMITERM_MODEL` when non-empty, else the literal `"gemini-3-flash"`. Synchronous, no network, no `init()` requirement. Available on factory instances and on instances returned by `forProfile`.
- [x] 1.4 Add a focused unit test asserting that `sendMessage` and `startNewChat` pass `{ model: <name> }` to `client.newChat` when supplied; pass no options when the argument is empty or omitted. Mock the SDK via the existing `_deps` injection seam (`gemini-client-wrapper.ts:90-95`).

## 2. Chat-session helper

- [x] 2.1 Extend `StartChatSessionParams` (`src/cli/utils/chat-session.ts:9-21`) with `model?: string`; pass it to every `client.sendMessage` (line 46, line 70) and `client.startNewChat` (line 55, line 75) call site.
- [x] 2.2 Update `runWithRotationRetry`-wrapped call at `src/cli/utils/chat-session.ts:44-50` so the rotation-retry path also threads `model` (i.e. closure capture).

## 3. CLI flag and env-var plumbing

- [x] 3.1 Add `--model/-m <name>` to `NEW_FLAGS` in `src/cli/commands/new-command.ts:15-19`. Update `NEW_USAGE` (`new-command.ts:21-29`) to document the new flag. Reject `--model ""` with `Error: --model requires a non-empty value.` and exit 1. Pass `options.model` to `startChatSession` (line 71-87).
- [x] 3.2 Add `--model/-m <name>` to `CONTINUE_FLAGS` in `src/cli/commands/continue-command.ts:20-24`. Update `CONTINUE_USAGE` (line 26-38) to document the new flag. Reject `--model ""` with the same error. Pass `options.model` to `startChatSession` (line 102-114).
- [x] 3.3 Read `process.env.GEMITERM_MODEL` in `src/infrastructure/cli-parser.ts` (`parseGlobalArgs`, line 36-69) and expose it through the parsed-result type. Trim; treat whitespace-only as unset.
- [x] 3.4 Extend the `CliCommandContext` interface in `src/cli/command-registry.ts` with `defaultModel?: string`. Construct it in `src/cli/index.ts:setupServices` from the env-var read in 3.3 (or from `"gemini-3-flash"` when unset).
- [x] 3.5 Implement per-call resolution in `NewCommand` and `ContinueCommand`: `options.model` (CLI, if non-empty) → `context.defaultModel` (CLI-wide, if set) → `"gemini-3-flash"` (the implicit default). The resolved string is what gets passed to `startChatSession`.

## 4. ModelsCommand default-aware output

- [x] 4.1 Update `ModelsCommand.execute` (`src/cli/commands/models-command.ts:5-31`) to call `client.getDefaultModel()` in addition to `client.listModels()`. Suffix the matching model line with ` (default)` (case-sensitive equality). Append the hint line `Use --model <name> (or set GEMITERM_MODEL=<name>) to select. The default is currently <name>.` when `getDefaultModel()` returns a non-empty string.
- [x] 4.2 Add a unit test for `ModelsCommand` covering: (a) `(default)` suffix and hint line when a default exists, (b) no suffix and no hint when the default is empty, (c) `--help` makes no `listModels()` call.

## 5. README + CHANGELOG

- [x] 5.1 Update the `### gemiterm new [message]` section in `README.md` (line 234-249) to document `-m, --model <name>`. Add an example: `gemiterm new --model gemini-3-flash "Explain the CAP theorem"`.
- [x] 5.2 Update the `### gemiterm continue <conversation_id> [message]` section in `README.md` (line 250-264) to document `-m, --model <name>`.
- [x] 5.3 Update the `### gemiterm models` section in `README.md` (line 312-318) to document the `(default)` marker and the hint line.
- [x] 5.4 Add a `### gemiterm new [message]` / `### gemiterm continue` flag-table row for `--model` and a new top-level mention of `GEMITERM_MODEL` (in the `## Configuration` section if one exists; otherwise as a short paragraph after the Commands table).
- [x] 5.5 Add a CHANGELOG `Changed` entry under a new `[Unreleased]` block: implicit default for `gemiterm new` / `gemiterm continue` flips from `Model.UNSPECIFIED` to `Model.BASIC_FLASH` (`gemini-3-flash`). Note that Plus/Advanced users can opt back into their tier default with `--model gemini-3-pro-plus` / `--model gemini-3-pro-advanced` or by setting `GEMITERM_MODEL`.
- [x] 5.6 Add a CHANGELOG `Added` entry: `--model/-m` flag on `new` and `continue`; `GEMITERM_MODEL` env var; `gemiterm models` shows the resolved default and a hint line.

## 6. Tests

- [x] 6.1 Extend `tests/services/gemini-client-wrapper.test.ts` with the model-pass-through cases from 1.4.
- [x] 6.2 Extend `tests/unit/cli-parser.test.ts` (or the equivalent test file for `parseGlobalArgs`) to assert that `GEMITERM_MODEL` is read, trimmed, and exposed on the parsed result; whitespace-only is treated as unset; unset returns the implicit default.
- [x] 6.3 Add unit tests for the per-call resolution in `NewCommand` and `ContinueCommand`: `--model` wins, env-var default next, implicit default last; `--model ""` rejects.
- [x] 6.4 Add a unit test for `getDefaultModel()` env-var behavior (the scenarios from `openspec/changes/add-model-selection/specs/conversations/spec.md`): env set, env trimmed, env whitespace-only, env unset, no-network, process-wide consistency between factory and `forProfile` instances, env-change reflection across calls.
- [x] 6.5 If integration tests exist for `new` / `continue` / `models`, extend them with a smoke-level case asserting `--model` plumbing and the `(default)` / hint output. If none exist, document the gap and skip (the unit tests in 6.1–6.4 cover the same surfaces with lower ceremony).

## 7. Verification

- [x] 7.1 `bun run typecheck` — passes (no new `node:fs` / `node:path` imports; types tightened only on the wrapper's public surface; SDK calls remain `any`-typed).
- [x] 7.2 `bun run lint:mediation` — passes (no new exemptions to `scripts/lint-path-mediation.sh`).
- [x] 7.3 `bun run check:auth-gate` — passes by default (no `src/auth/` files touched, no `playwright-cli-driver.ts` edits, no `browser-refresher.ts` edits).
- [x] 7.4 `bun test --isolate` — full suite passes; 1067 pass, 2 skip, 0 fail.
- [x] 7.5 Manual smoke: `gemiterm new --help` documents `--model`; `gemiterm continue --help` documents `--model`; `GEMITERM_MODEL=gemini-3-pro gemiterm new "hi"` produces a response; `gemiterm new "hi" --model ""` errors with `Error: --model requires a non-empty value.` and exits 1; `gemiterm models` shows `(default)` on the resolved-default line and appends the hint line.

## 8. Spec deltas

- [x] 8.1 Verify `openspec/changes/add-model-selection/specs/commands/spec.md` covers `NewCommand` (MODIFIED, with `--model` plumbing + scenarios), `ContinueCommand` (MODIFIED, same), and `ModelsCommand` (ADDED, with `(default)` marker + hint line).
- [x] 8.2 Verify `openspec/changes/add-model-selection/specs/conversations/spec.md` covers `sendMessage` (MODIFIED, with `model?` parameter + scenarios), `startNewChat` (MODIFIED, same), and `getDefaultModel` (ADDED, with env-var scenarios including trim, whitespace-only, unset, no-network, process-wide, env-change reflection).
- [x] 8.3 Run `openspec validate add-model-selection` (or `openspec validate --change add-model-selection`) and resolve any findings before archive.
