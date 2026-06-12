## 1. Setup and dependencies

- [x] 1.1 Run `bun add @inquirer/prompts@^8.5.2` and confirm the package installs under Bun with `engines.node >= 20.17.0` satisfied.
- [x] 1.2 Verify `node_modules/@inquirer/prompts/package.json` exports the expected `input`, `confirm`, `select`, `Separator`, and error class names. Verify `@inquirer/core` is also installed and exports `createPrompt`, `useState`, `useEffect`, `useKeypress`, `useRef`, `useMemo`, `usePagination`, `usePrefix`, `makeTheme`, `isUpKey`, `isDownKey`, `isEnterKey`, `isBackspaceKey`, `isNumberKey`, `isTabKey`, `isShiftKey`, `Separator`, `ValidationError`, `AbortPromptError`, `CancelPromptError`, `ExitPromptError`, and the `Theme` type.

## 2. Facade module

- [x] 2.1 Create `src/cli/utils/prompts.ts` with the typed error hierarchy: `NonInteractiveError extends GemitermError`, `CancellationError extends GemitermError`.
- [x] 2.2 Implement the shared theme using `chalk.cyan` for the idle prefix, `chalk.green(figures.tick)` for the done prefix, `chalk.red` for errors, and `undefined` from `style.keysHelpTip` to hide the help line.
- [x] 2.3 Implement the module-level `AbortController` and the exported `getAbortSignal(): AbortSignal`.
- [x] 2.4 Implement the TTY gate as a private `requireTty(commandHint: string): void` that throws `NonInteractiveError` with the suggested non-interactive invocation in the message.
- [x] 2.5 Implement the `text(opts)` function, wrapping `@inquirer/input` with the TTY gate, the shared theme, the abort signal, and `ExitPromptError` / `AbortPromptError` mapped to `CancellationError`.
- [x] 2.6 Implement the `confirm(opts)` function, wrapping `@inquirer/confirm` with the same gate, theme, signal, and error mapping.
- [x] 2.7 Implement the `select<T>(opts)` function, wrapping `@inquirer/select` with the same gate, theme, signal, and error mapping. Accept a choices array of `{ value, label, description?, disabled? }` and translate to Inquirer's `Choice` shape internally.

## 3. Facade unit tests

- [x] 3.1 Create `tests/cli/utils/prompts.test.ts` with a `describe("TTY gate")` block: tests that `text`, `confirm`, `select`, and `browser` all throw `NonInteractiveError` when `process.stdin.isTTY` is not `true`.
- [x] 3.2 Add tests that the `NonInteractiveError` message contains the suggested non-interactive invocation.
- [x] 3.3 Add tests for the error class hierarchy: `NonInteractiveError` and `CancellationError` are both subclasses of `GemitermError` and have `name` set to the class name.
- [x] 3.4 Add a test for `getAbortSignal()` returning an `AbortSignal` that can be aborted.

## 4. Chat REPL migration

- [x] 4.1 Replace the `rl.question` call in `src/cli/utils/interactive-prompt.ts` with `await prompts.text({ message: "You" })` from the facade.
- [x] 4.2 Wrap the existing `messageHandler` call in `console.log(chalk.dim("Thinking…"))` immediately before the await, then `console.log(chalk.blue.bold("Model:"))` + `console.log(result.response)` on success, then a blank `console.log("")`.
- [x] 4.3 Keep the `/exit` and `/quit` slash command handling at the top of the input handler. Keep the recursive `prompt()` structure. Keep the outer `await new Promise<void>((resolve) => …)` on `rl.on("close", …)` — replace the readline `close` listener with a `process.on("SIGINT", …)` or a facade signal listener that resolves the promise and prints `chalk.dim("\nGoodbye.")`.
- [x] 4.4 Keep the `runInteractiveLoop`, `MessageHandler`, `MessageHandlerResult`, and `InteractiveLoopOptions` exports byte-equivalent.
- [x] 4.5 Remove the `import { createInterface } from "node:readline"` line.

## 5. Chat REPL unit tests

- [x] 5.1 Create `tests/cli/utils/interactive-prompt.test.ts` that mocks the facade module with `mock.module("../../cli/utils/prompts.ts", …)` and drives a 3-message sequence followed by `/exit`.
- [x] 5.2 Assert that the `messageHandler` callback is called with the trimmed user input for each of the 3 messages.
- [x] 5.3 Assert that the loop resolves after the `/exit` input.
- [x] 5.4 Assert that empty input does NOT invoke the `messageHandler`.
- [x] 5.5 Add a test that a `CancellationError` from the facade resolves the loop with no `messageHandler` call.

## 6. Auth command migration

- [x] 6.1 Replace the letter-key menu in `src/cli/commands/auth-command.ts` `showProfileMenu` (lines 75-85) with a `prompts.select` over the 5 options. Each option has `value: <letter>`, `label: <description>`, and `description: <hint>`.
- [x] 6.2 Replace the `promptInput("Select an option")` call (line 88) with a dispatch on the `select` return value. Keep the switch statement and the 5 case branches (`A`/`D`/`S`/`R`/`X`).
- [x] 6.3 Replace the `promptInput` call inside the `A` branch (line 93) with `await prompts.text({ message: "Enter profile name", validate: v => /^[a-zA-Z0-9_-]+$/.test(v) || "Invalid profile name" })`.
- [x] 6.4 Replace the `promptInput` call inside the `D` branch (line 103) with `await prompts.text({ message: "Enter profile name to delete" })`.
- [x] 6.5 Replace the `promptInput` call inside the `D` branch for the confirm (line 108) with `await prompts.confirm({ message: `Delete profile '${trimmed}'?`, default: false })`. Map `true` → delete, `false` → print `chalk.dim("Cancelled.")` and return `null`.
- [x] 6.6 Replace the `promptInput` call inside the `S` branch (line 118) with `await prompts.text({ message: "Enter profile name to set as default" })`.
- [x] 6.7 Replace the `promptInput` calls inside the `R` branch (lines 129, 134) with `await prompts.text({ message: "Enter current profile name" })` and `await prompts.text({ message: "Enter new profile name", validate: v => /^[a-zA-Z0-9_-]+$/.test(v) || "Invalid profile name" })` respectively.
- [x] 6.8 Reduce the `promptInput` private method (lines 170-178) to a one-line shim: `private promptInput(prompt: string): Promise<string> { return text({ message: prompt }); }`.
- [x] 6.9 Remove the `import { createInterface } from "node:readline"` line.

## 7. Delete command migration

- [x] 7.1 Replace the `rl.question` call in `src/cli/commands/delete-command.ts:132` with `await prompts.confirm({ message: `Delete conversation '${id}'?`, default: false })`.
- [x] 7.2 Reduce the `promptConfirmation` private method to a one-line shim: `private promptConfirmation(question: string): Promise<boolean> { return confirm({ message: question, default: false }); }`.
- [x] 7.3 Remove the `import { createInterface } from "node:readline"` line.

## 8. Profile command migration

- [x] 8.1 Replace the `rl.question` call in `src/cli/commands/profile-command.ts:220` with `await prompts.text({ message: prompt })` from the facade.
- [x] 8.2 Reduce the `promptInput` private method (lines 217-225) to a one-line shim: `private promptInput(prompt: string): Promise<string> { return text({ message: prompt }); }`.
- [x] 8.3 Remove the `import { createInterface } from "node:readline"` line.

## 9. Chat-list browser prompt (new)

- [x] 9.1 In `src/cli/utils/prompts.ts`, import `createPrompt`, `useState`, `useEffect`, `useKeypress`, `useRef`, `useMemo`, `usePagination`, `usePrefix`, `makeTheme`, `isUpKey`, `isDownKey`, `isEnterKey`, `isBackspaceKey`, `Separator` from `@inquirer/core`.
- [x] 9.2 Define the `BrowserResult` discriminated union: `{ kind: 'pick', chat: ChatInfo, action: <pending> } | { kind: 'quit' }`.
- [x] 9.3 Define the `BrowserConfig` type: `{ chats: ReadonlyArray<ChatInfo>; initialFilter?: string; initialSort?: 'recent' | 'oldest' | 'alpha'; pageSize?: number; loop?: boolean; }`.
- [x] 9.4 Build the `browser` prompt using `createPrompt<BrowserResult, BrowserConfig>((config, done) => { … })`. Use `useState` for `mode: 'browse' | 'search'`, `filter: string`, `sort: 'recent' | 'oldest' | 'alpha'`, `active: number`. Use `useMemo` for the filtered + sorted + rendered rows. Use `usePagination` with `pageSize: 15` and `loop: true` for the visible page. Use `useKeypress` for the `↑`/`↓`/`n`/`p`/`g`/`G`/`/`/`s`/`enter`/`q`/`esc` handlers.
- [x] 9.5 Implement the `filter` substring match: `chats.filter(c => c.title.toLowerCase().includes(filter.toLowerCase()))`.
- [x] 9.6 Implement the `sort` comparator: `recent` → `b.timestamp - a.timestamp`, `oldest` → `a.timestamp - b.timestamp`, `alpha` → `a.title.localeCompare(b.title)`.
- [x] 9.7 Render the row format: `> <id>  <date>  <title>  <pin>` for the active row, `  <id>  <date>  <title>  <pin>` for inactive rows. Use `chalk.dim` for the id, `chalk.cyan` for the date, no color for the title, `chalk.yellow` for the pin.
- [x] 9.8 Render the title bar: `Browse conversations (PageSize: <N> | <total> chats | Sort: <mode> | Filter: <filter-or-"none">)`.
- [x] 9.9 Render the bottom hint line: `↑↓ navigate · n/p page · g/G top/bottom · / filter · s sort · enter pick · q quit`.
- [x] 9.10 Return `[titleBar, page, hintLine]` (the `[string, string]` tuple form of `createPrompt`'s view function) so the `ScreenManager` renders the hint line below the cursor.
- [x] 9.11 On `enter` in browse mode: call `done({ kind: 'pick', chat: <highlighted>, action: <pending> })`.
- [x] 9.12 On `q` / `esc` in browse mode: call `done({ kind: 'quit' })`.
- [x] 9.13 On `/`: set `mode: 'search'`. While in search mode, render the search input below the title bar. On `enter` in search mode, set `mode: 'browse'` and apply the filter. On `esc` in search mode, set `mode: 'browse'` and clear the filter.
- [x] 9.14 On `s`: set `mode: 'sort'`. Render a 3-option `select`-like menu inline. On selection, set `sort: <new>` and `mode: 'browse'`. On `esc`, set `mode: 'browse'` without changing sort.
- [x] 9.15 Wrap the whole `browser` function in the TTY gate: `requireTty("gemiterm list -i requires a TTY; use --format json for machine-readable output")`.
- [x] 9.16 Export `browser` from `src/cli/utils/prompts.ts` alongside `text`, `confirm`, `select`.

## 10. Chat-list browser unit tests

- [x] 10.1 Create `tests/cli/utils/chat-list-browser.test.ts` with a `describe("browser prompt")` block.
- [x] 10.2 Test: arrow down moves the cursor. Use `@inquirer/testing`'s `render()` to drive `events.keypress({ name: 'down' })` and assert the screen output.
- [x] 10.3 Test: `/` opens the search input. Use `events.keypress('/')` then `events.type('react')` and assert the list narrows.
- [x] 10.4 Test: `s` opens the sort menu. Use `events.keypress('s')` then assert the menu is visible.
- [x] 10.5 Test: `enter` on a chat resolves with `{ kind: 'pick', chat, action: <pending> }`.
- [x] 10.6 Test: `q` resolves with `{ kind: 'quit' }`.
- [x] 10.7 Test: empty list resolves with `{ kind: 'quit' }` on `q` and shows `No conversations found.`.
- [x] 10.8 Test: TTY gate — when `process.stdin.isTTY` is not `true`, calling `browser()` throws `NonInteractiveError` with the expected message.

## 11. List command `--interactive` integration

- [x] 11.1 Add `interactive: boolean` to `ListCommandOptions` in `src/cli/commands/list-command.ts`.
- [x] 11.2 Add the `interactive` field to `DEFAULT_OPTIONS` with value `false`.
- [x] 11.3 In `parseArgs`, add the `case "--interactive": case "-i":` branch.
- [x] 11.4 In `parseArgs`, add a new check: if `options.interactive && (options.format !== DEFAULT_OPTIONS.format || options.path !== DEFAULT_OPTIONS.path)`, throw a `GemitermError` with the message `Cannot use --interactive with --format or --path.`.
- [x] 11.5 In `parseArgs`, add a new check: if `options.interactive && options.search`, accept it (the TUI will pre-fill the filter from `options.search`).
- [x] 11.6 In `parseArgs`, add a new check: if `options.interactive && options.sort !== DEFAULT_OPTIONS.sort`, accept it (the TUI will pre-select the sort).
- [x] 11.7 In `execute`, after the help check, add a new branch: if `options.interactive`, call a new private method `runInteractiveBrowser(chats, options)` and return.
- [x] 11.8 Implement `runInteractiveBrowser(chats, options)`:
  - Call `prompts.browser({ chats, initialFilter: options.search, initialSort: options.sort })`.
  - On `{ kind: 'pick', chat, action: <pending> }`: call a new private method `showActionMenu(chat)` which returns a `prompts.select` with 5 options (`view`, `export-markdown`, `export-json`, `copy-id`, `back`, `quit`). Map the selected action to a code branch:
    - `view` → invoke the `fetch` command (use the `CommandRegistry`) with `[chat.id, '--format', 'text']`.
    - `export-markdown` → invoke the `export` command with `[chat.id, '--format', 'markdown']`.
    - `export-json` → invoke the `export` command with `[chat.id, '--format', 'json']`.
    - `copy-id` → `console.log(chalk.cyan(chat.id))`.
    - `back` → no-op, re-enter the loop.
    - `quit` → break the loop.
  - On `{ kind: 'quit' }`: return.
  - Wrap the whole thing in a `while (true)` loop.
- [x] 11.9 Update the `showUsage` method in `list-command.ts` to document the new `--interactive, -i` flag.
- [x] 11.10 Update the `ListCommand` JSDoc (if any) to mention the new flag.

## 12. List command `--interactive` integration tests

- [x] 12.1 Add tests to `tests/cli/list-command.test.ts` (if not already covered) that verify `--interactive` enters the TUI when TTY and throws `NonInteractiveError` when not TTY.
- [x] 12.2 Add tests to `tests/cli/list-command.test.ts` that verify `--interactive --format json` throws `GemitermError` with the expected message.
- [x] 12.3 Add tests to `tests/cli/list-command.test.ts` that verify `--interactive --path out.txt` throws `GemitermError` with the expected message.
- [x] 12.4 Add a regression test that `gemiterm list` (no flags) still produces the same 4-column text table as the pre-change baseline. (The existing tests in `tests/integration/commands/list.test.ts` already cover this; verify they pass without modification.)
- [x] 12.5 Add a regression test that `gemiterm list --format json` still produces the same `{ chats: ChatInfo[] }` JSON document. (The existing tests already cover this; verify they pass.)
- [x] 12.6 Add a regression test that `gemiterm list --search foo` still forwards `search: "foo"` to the mediator. (The existing tests already cover this; verify they pass.)
- [x] 12.7 Add a regression test that `gemiterm list --path out.txt` still writes to the file. (The existing tests already cover this; verify they pass.)

## 13. AGENTS.md update

- [x] 13.1 Update the test baseline in `AGENTS.md` from `544 pass, 0 fail` to the new count (currently 623 / 0 / 1241 expect() calls, verified 2026-06-12). The new count after this change MUST still be 0 fail.
- [x] 13.2 Add a "Sensitive area — do not modify lightly" subsection for the prompt layer, mirroring the auth block: list the files (`src/cli/utils/prompts.ts`, `src/cli/utils/interactive-prompt.ts`, `src/cli/commands/auth-command.ts`, `src/cli/commands/delete-command.ts`, `src/cli/commands/profile-command.ts`, `src/cli/commands/list-command.ts`, the browser prompt lives in `src/cli/utils/prompts.ts`) and the test files (`tests/cli/utils/{prompts,interactive-prompt,chat-list-browser}.test.ts`).
- [x] 13.3 Add a note that the facade is the only module that imports from `@inquirer/prompts` or `@inquirer/core`, and that all interactive callsites (including the chat-list browser) must use the facade.
- [x] 13.4 Add a note about the `--interactive` opt-in flag for `gemiterm list` and the byte-equivalent non-interactive contract.

## 14. Quality gates

- [x] 14.1 Run `bun run typecheck` and confirm zero errors.
- [x] 14.2 Run `bun run lint:mediation` and confirm zero violations. The facade module does not need an exemption.
- [x] 14.3 Run `bun test` and confirm the baseline is intact: 0 fail. Update the test count in `AGENTS.md` and this change's `tasks.md` if it moves.
- [x] 14.4 Manually smoke test: `bun run dev` → `gemiterm new` (REPL, type a message, verify "Thinking…" → "Model:" → next prompt; type `/exit`, verify "Goodbye."). Then `gemiterm auth` with ≥2 profiles (verify the 5-option select menu, arrow-key navigation, Enter to confirm, then the per-branch prompts). Then `gemiterm profile delete <name>` (verify the confirm prompt, y/n behaviour). Then `gemiterm delete <id>` (verify the confirm prompt, y/n behaviour).
- [x] 14.5 Manually smoke test the chat-list browser: `bun run dev` → `gemiterm list -i` (TUI, arrow keys move cursor, `n`/`p` jump by page, `g`/`G` jump to top/bottom, `/` opens search, typing narrows the list, `enter` applies the filter, `s` opens sort menu, selecting a sort updates the list, `enter` on a chat opens the action menu, `view` invokes fetch, `export-markdown` writes a file, `export-json` writes a file, `copy-id` prints the id, `back` returns to the browser, `quit` exits, `q` exits, `esc` exits, `Ctrl+C` exits with code 0).
- [x] 14.6 Manually regression test: `gemiterm new "hello world"` from a clean TTY and verify the output contains `Conversation ID:` and `Model:` lines identical to the previous baseline. Repeat with `gemiterm continue <id> "follow up"`.
- [x] 14.7 Manually regression test: `gemiterm list` (no flags, no `--interactive`) from a clean TTY and verify the output is the same 4-column text table as the previous baseline. Repeat with `gemiterm list --format json` (verify the same JSON document), `gemiterm list --search foo` (verify the same filtered text table), `gemiterm list --all-profiles` (verify the PROFILE column), `gemiterm list --path out.txt` (verify the file is written with the same content).
- [x] 14.8 Manually regression test: `echo "x" | gemiterm new "hello"` (piped stdin) and verify the one-shot output is identical to the TTY case (no REPL banner, no prompt). Repeat with `echo "x" | gemiterm list -i` and verify the TTY gate produces the `NonInteractiveError` message and exit code 1.
