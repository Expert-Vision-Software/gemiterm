## Context

gemiterm v2.1.1 ships with four hand-rolled `node:readline` prompt sites: the chat REPL in `src/cli/utils/interactive-prompt.ts:14-64` (which creates a long-lived `readline.createInterface` and recursively calls `rl.question`), and three single-shot helpers in `src/cli/commands/{auth,delete,profile}-command.ts` (each constructs a new readline interface, calls `rl.question` once, and closes the interface). None of them validate input, none of them handle non-TTY callers explicitly, none of them are themeable, and the 5-option `auth` profile menu forces users to memorize letter keys (`A`/`D`/`S`/`R`/`X`) instead of using arrow-key navigation.

Separately, the `list` command (`src/cli/commands/list-command.ts`, 226 lines) is purely non-interactive. Its 11 flags cover every reasonable query (search, sort, date filter, pagination, profile scope, output format, file output) but they're all-or-nothing per invocation. A human who wants to *browse* their chats — "show me the last 20, let me arrow through, sort by date or alphabetically, filter by typing — and once I find the one I want, export it" — has to issue multiple `gemiterm list` invocations with different flags. There's no way to navigate, re-sort, or re-filter without restarting the command.

`@inquirer/prompts@^8.5.2` (modern Inquirer.js) is the de-facto Node CLI prompt library, ESM-only, Bun-compatible, and provides exactly the prompt types gemiterm needs: text input (`@inquirer/input`), confirmation (`@inquirer/confirm`), single-select list (`@inquirer/select`). `@inquirer/core@^11.2.1` (transitively bundled, but called out for clarity) provides the `createPrompt` factory and the React-style hooks (`useState`, `useEffect`, `useKeypress`, `useRef`, `useMemo`, `usePagination`, `usePrefix`) needed to build the custom chat-list browser prompt. Both are pure runtime dependencies — no path/IO mediation exemptions required, and no duplication of gemiterm's existing dependencies (`chalk`, `cli-table3`, `commander`, `gemini-reverse`).

The 623-test / 1241-`expect()` baseline (verified `bun test` 2026-06-12, 11.61s) must remain at 0 fail. The existing test strategy bypasses readline via `spyOn(command, "promptInput")` and `spyOn(command, "promptConfirmation")`; preserving the method names on the command classes as facade-delegating shims keeps that strategy working with zero test changes. The existing `list-command` tests (in `tests/cli/list-command.test.ts` and `tests/integration/commands/list.test.ts`) must continue to pass without modification, which is the regression-test gate for the non-interactive contract.

## Goals / Non-Goals

**Goals:**
- Replace every `node:readline` import in `src/` with `@inquirer/prompts` calls routed through a single facade.
- Add a TUI chat-list browser to the `list` command, opt-in via `--interactive/-i`, that supports paging, interactive sorting, and interactive filtering.
- Preserve the chat REPL's public contract (`runInteractiveLoop`, `MessageHandler`, `MessageHandlerResult`, `InteractiveLoopOptions`, the `/exit` and `/quit` slash commands, the recursive message loop).
- Preserve the `auth`/`delete`/`profile` command classes' public contract (the `execute(args, context)` signature and the `promptInput` / `promptConfirmation` private method names) so that all 623 existing tests pass with zero modifications.
- Preserve the `list` command's non-interactive contract byte-for-byte: `gemiterm list` (no flags) emits the same 4-column text table; `gemiterm list --format json` emits the same `{ chats: ChatInfo[] }` JSON; `gemiterm list --search foo` forwards the search term; `gemiterm list --path out.txt` writes to the file. The only way to enter the TUI is `gemiterm list -i`.
- Guarantee the `debate-with-gemini` skill and other agent skills see byte-for-byte identical stdout and exit codes from `gemiterm new "msg"`, `gemiterm continue <id> "msg"`, and `gemiterm list --format json`.
- Guarantee that no Inquirer prompt is ever invoked in a non-TTY context; the facade throws a typed `NonInteractiveError` instead.
- Preserve the current Ctrl+C behaviour: `Ctrl+C` in the REPL or the TUI produces a clean exit with code 0; `Ctrl+C` in a one-shot prompt produces a `CancellationError` the caller can render as `chalk.dim("Cancelled.")`.

**Non-Goals:**
- Adding a global `--json` / `--no-color` flag. The `commander-cli-parser` design defers this; we follow suit.
- Adding a spinner during model latency. That requires a custom `@inquirer/core` prompt wrapping the model call; defer to a follow-up.
- Replacing `cli-table3` output for status / fetch (the TUI replaces the `list` text table only for the interactive path).
- Adding new slash commands beyond `/exit` and `/quit`. The chat REPL is the only place they would be visible, and the existing two are sufficient.
- Using the legacy `inquirer` package. `@inquirer/prompts` only.
- A multi-line / `editor` prompt for the chat REPL. `--prompt-file` already covers long messages.
- The chat-list browser as the default behaviour of `gemiterm list`. It's strictly opt-in via `-i`/`--interactive`. Defaulting to TUI would break the agent skill's `gemiterm list --format json` flow on systems where `process.stdin.isTTY` is `true` but the output is piped (e.g. a CI job that just happens to allocate a TTY for the build agent). Opt-in keeps the contract clean.
- Bulk-export / multi-select ("pick N chats, export them all in one shot") inside the TUI. The `gemiterm export-all` command already exists for that. A `checkbox` prompt for multi-select is a follow-up change.
- The TUI supporting a "mark for later" / pinned-chats view. The chat list already has a `PIN` column; the TUI renders the column but doesn't add interaction. Follow-up.

## Decisions

### D1. Single facade module instead of direct `@inquirer/prompts` imports

**Decision:** Every prompt call goes through `src/cli/utils/prompts.ts`. The facade exports `text`, `confirm`, `select`, and `browser` (the custom chat-list browser prompt); command code never imports from `@inquirer/prompts` or `@inquirer/core` directly.

**Why:** The TTY gate, the shared theme, the `AbortController` propagation, and the error-class mapping are all cross-cutting concerns. Inlining them at every call site would mean 4+ copies of the same boilerplate and a high risk of one site forgetting the TTY check. The facade is the single chokepoint that protects the rest of the CLI from Inquirer's TTY-only assumption.

**Alternatives considered:**
- *Direct imports at every call site.* Rejected: would scatter the TTY check, and a single missed check at a future call site would crash Inquirer on a non-TTY input. Hard to audit.
- *Wrap each call site in its own helper inside the command file.* Rejected: still scatters the theme and the cancellation contract; harder to change the theme in one place.

### D2. TTY gate throws a typed `NonInteractiveError` (subclass of `GemitermError`)

**Decision:** Every facade entry checks `process.stdin.isTTY !== true` and throws `NonInteractiveError` with a message that includes the suggested non-interactive invocation (e.g. `gemiterm new "Your message"`, `gemiterm list -i requires a TTY; use --format json for machine-readable output`). `GemitermError` already has a `render()` path in the CLI top-level error handler.

**Why:** Inquirer's modern API has no built-in non-TTY fallback. Calling any `@inquirer/prompts` function on a piped stdin blocks indefinitely waiting for raw keypress events that never come. A typed error at the boundary is cleaner than letting the process hang. `GemitermError` is the existing convention for user-recoverable errors in this codebase (`src/core/errors.ts`).

**Alternatives considered:**
- *Read from a `GEMITERM_NONINTERACTIVE` env var instead of `isTTY`.* Rejected: the env var is set by external tooling, not by the TTY status, and would require users to opt in. The TTY check is automatic and matches the convention used by `git`, `npm`, and other well-behaved CLIs.
- *Fall back to defaults silently when non-TTY.* Rejected: would silently produce wrong answers (e.g. confirming a `delete` operation with the default `true`). Loud failure is safer.

### D3. Preserve `promptInput` and `promptConfirmation` as facade-delegating shims

**Decision:** The private `promptInput(prompt: string): Promise<string>` method on `AuthCommand` and `ProfileCommand` (and the `promptConfirmation` method on `DeleteCommand`) is preserved. Each becomes a one-liner that delegates to the facade.

**Why:** `tests/cli/auth-command.test.ts:91, 104, 118, 132, 155, 190, 211` and `tests/cli/profile-command.test.ts` use `spyOn(command as any, "promptInput").mockResolvedValue("X")` to bypass readline. Preserving the method name keeps that pattern working with zero test changes. The shim is ~3 lines per command, no runtime cost.

**Alternatives considered:**
- *Refactor tests to `mock.module("../../cli/utils/prompts.ts", …)` instead.* Rejected: 623 tests would need updates, with a high risk of subtle regressions in the auth flow's multi-step menu. The shim approach is strictly less invasive.
- *Move the prompts to a base class and have commands extend it.* Rejected: 1-2 lines saved per command at the cost of an inheritance hierarchy for a single method. Not worth it.

### D4. Replace the 5-letter auth profile menu with `prompts.select`

**Decision:** The `auth` command's profile management menu (currently `[A]dd` / `[D]elete` / `[S]et default` / `[R]ename` / `[X]exit`) is replaced with a `prompts.select` over 5 named choices with descriptions.

**Why:** Arrow-key navigation is more discoverable and faster than letter-key recall. The `select` prompt is exactly what Inquirer was designed for. It also unlocks per-option descriptions (e.g. "Rename an existing profile and migrate its cookies") which the letter-key menu cannot show.

**Alternatives considered:**
- *Keep the letter-key menu for muscle-memory compatibility.* Rejected: this is a power-user CLI, not a public API; the menu is invoked rarely and only when ≥2 profiles exist. Discoverability wins.
- *Use `prompts.expand` (single-key shortcuts).* Rejected: still requires memorization; `select` is strictly better here.

### D5. Replace `rl.question("You: ")` with `prompts.text({ message: "You" })` in the REPL

**Decision:** The chat REPL's input prompt is `prompts.text({ message: "You" })`. The "Thinking…" line, the "Model:" header, and the model response rendering stay as `console.log` calls (no Inquirer wrapping). The recursive loop, the `/exit` / `/quit` handling, and the `MessageHandler` signature are unchanged.

**Why:** A custom `@inquirer/core` prompt that wraps the model call would let us put the spinner inside the prompt lifecycle, but it would also mean rebuilding the loop from scratch (a 50-line rewrite vs a 10-line replacement). The current design — `input()` for collection, `console.log` for output, recursive `prompt()` call for the loop — is well-understood and matches Inquirer's own examples. A follow-up change can build a custom prompt if the lack of a spinner becomes a real complaint.

**Alternatives considered:**
- *Build a custom `@inquirer/core` prompt that owns the whole loop.* Rejected for this change; over-engineering for the v1 UX. Deferred.
- *Use the `@inquirer/editor` prompt for multi-line.* Rejected: would pull in `chardet` + `iconv-lite` for a feature nobody asked for. `--prompt-file` is the established way to send long messages.

### D6. Shared theme via `makeTheme`

**Decision:** The facade constructs a `Theme` extension that matches gemiterm's chalk palette: prefix idle = `chalk.cyan("?")`, prefix done = `chalk.green(figures.tick)`, error = `chalk.red`, description = `chalk.cyan.dim`, help tip hidden (returns `undefined` from `style.keysHelpTip`).

**Why:** Inquirer's default theme uses `styleText('cyan', '?')` and `styleText('green', figures.tick)` (no chalk), which produces slightly different shades from the rest of gemiterm's chalk output. By overriding the theme to use chalk for prompt chrome, prompts feel native to the existing CLI. The `chalk` styles already in use (cyan, green, red, dim, blue) are reused verbatim.

**Alternatives considered:**
- *Let Inquirer own its theme and accept the visual inconsistency.* Rejected: the rest of the CLI (banner, tables, slash-command output) uses chalk; mixing two color systems is jarring.
- *Switch the whole CLI from `chalk` to `styleText`.* Out of scope: would touch 17 files and is not a prompt concern.

### D7. AbortSignal propagation through a module-level `AbortController`

**Decision:** The facade exposes `getAbortSignal(): AbortSignal` backed by a module-level `AbortController`. The CLI top-level handler (`src/cli/index.ts:175-181`) wires `process.on("SIGINT", () => abort())` so any active prompt unwinds. Each facade call passes the signal to Inquirer's context. The CLI top-level error handler catches the resulting `ExitPromptError` and exits 0, matching the current Ctrl+C behaviour.

**Why:** Inquirer rejects with `ExitPromptError` on SIGINT. By mapping this to a clean exit at the CLI boundary, command code never has to handle Ctrl+C explicitly — the in-flight prompt is aborted, any awaiting `messageHandler` continues, the `await runInteractiveLoop(...)` resolves, and the CLI exits 0. This matches the current `rl.close()` → `Goodbye.` → `process.exit(0)` flow exactly.

**Alternatives considered:**
- *Let each call site catch `ExitPromptError` and decide.* Rejected: every call site would duplicate the same mapping. Centralised at the boundary is cleaner.
- *Use the existing mediator's `ExitRequested` query.* Rejected: the mediator is a typed dispatch for command/query messages, not a global shutdown channel. Mixing concerns would muddy the mediator's role.

### D8. Chat-list browser is a single `createPrompt` prompt, with sequential post-pick prompts for the action menu

**Decision:** The TUI is built as a custom `@inquirer/core` prompt (`prompts.browser`) using `createPrompt` + `useState` + `usePagination` + `useKeypress`. It owns all internal mode state (browse / search / sort) and resolves with a discriminated union:
- `{ kind: 'pick', chat: ChatInfo, action: 'view' | 'export-markdown' | 'export-json' | 'copy-id' }` — the user picked a chat and an action.
- `{ kind: 'quit' }` — the user pressed `q` or `esc`.

The "pick a chat → pick an action → execute" flow is composed in the caller (`list-command.ts` `runInteractiveBrowser` function) using a `while` loop that alternates between the `browser` prompt and (when a chat is picked) the facade's `select` prompt for the action menu. The post-pick action menu is a plain `prompts.select`; the action execution (view / export / copy) is plain code. This is the "main loop returning to a top-level menu" pattern from the Inquirer demo.

**Why:** A single `createPrompt` prompt gives smooth cursor navigation, real-time filter rendering, and instant mode transitions (search box, sort menu) without the readline-interface thrash of sequential prompts. The "main loop after the prompt resolves" pattern is the only documented way to do "pick chat → pick action → loop back" because Inquirer doesn't support prompt-within-prompt (each `createPrompt`d function owns its own readline interface; two can't be alive simultaneously). The post-pick `select` for the action menu is intentionally a separate prompt — it doesn't need smooth cursor + custom keybindings, just a clean 5-option menu.

**Alternatives considered:**
- *Build the whole TUI + action menu in one `createPrompt` prompt.* Rejected: would mean the action menu has to be re-implemented as an internal mode in the browser prompt, with its own state, keypress handlers, and rendering. The "outer loop, sequential prompts" pattern is simpler and reuses `prompts.select` directly.
- *Use multiple sequential `prompts.select` calls for browse + filter + sort.* Rejected: 4 separate readline interfaces with "first-render" flashes between each would feel clunky. The custom prompt is the only way to get a smooth single-screen TUI.
- *Use `prompts.search` (async-source autocomplete) for the browse view.* Rejected: `search` is hard-wired to `loop: false` and has a 700ms type-ahead debounce. The cursor stays in the middle of the visible page; this is awkward for "scroll through 200 chats" workflows. The custom prompt with `usePagination` gives proper `loop: true` (or `loop: false`, configurable), explicit page-size control, and the standard "cursor at top/middle/bottom" pointer behavior.
- *Use `prompts.checkbox` for multi-select "export these N chats" workflows.* Out of scope: this is a follow-up change. The TUI's action menu picks one chat and one action per invocation.

### D9. `--interactive/-i` is a strict opt-in flag; default behaviour of `gemiterm list` is unchanged

**Decision:** The TUI is only entered when `gemiterm list --interactive` (or `gemiterm list -i`) is explicitly invoked. The default `gemiterm list` (no flags) continues to emit the same 4-column text table. The flag is incompatible with `--format` and `--path` (the TUI is its own output format); if both are present, the command exits 1 with a clear error.

**Why:** The non-interactive forms of `gemiterm list` are the agent and skill path. The `debate-with-gemini` skill calls `gemiterm list --format json` to discover chats; a `gemiterm` skill call like `gemiterm list --search foo` is a documented pattern. Defaulting the TUI when `process.stdin.isTTY === true` would break these flows in environments that happen to allocate a TTY (CI agents, OpenCode sessions, `script` recordings). Opt-in via an explicit flag is unambiguous: the agent path uses no flag, the human path uses `-i`. The contract is verifiable: existing `tests/integration/commands/list.test.ts` runs `gemiterm list` and `gemiterm list --format json` without `-i` and expects the byte-equivalent text / JSON output; the test continues to pass without modification.

**Alternatives considered:**
- *Default to TUI when `process.stdin.isTTY === true` and no other flags are set.* Rejected: ambiguous. A user running `gemiterm list | grep foo` in a terminal that allocates a PTY would get a TUI dump to the pipe (catastrophic). The "TTY + no flags" rule has too many false positives (CI agents, `script(1)`, terminal multiplexers). Opt-in is safer.
- *Use a separate subcommand (`gemiterm browse` or `gemiterm list browse`).* Rejected: hides the feature, adds a new top-level name to the registry, and splits the help text. A flag on the existing `list` command is more discoverable via `gemiterm list --help`.
- *Use `GEMITERM_BROWSER=1` env var instead of a flag.* Rejected: env vars aren't visible in `--help` and can't be combined with other flags. A flag is the standard CLI pattern.

### D10. Browser page size and loop mode are tuned for chat-list browsing

**Decision:** The browser uses `pageSize: 15` and `loop: true` for the main list view. The sort menu and the action menu are 3- and 5-option `select` prompts with the default `pageSize: 7`.

**Why:** 15 items per page fits comfortably on a 24-line terminal (15 + 4 chrome lines = 19 lines). `loop: true` is the right default for chat-list browsing — users arrow down past the last item to wrap to the first, and the visible window slides naturally. The research confirmed this is sub-ms on modern hardware for 1000+ items. Sort/action sub-menus are short (3-5 options) and don't need tuning; the default `pageSize: 7` keeps them compact.

**Alternatives considered:**
- *`pageSize: 10` to match a 20-line terminal minimum.* Rejected: 15 is more useful on typical 24+ line terminals; users on smaller terminals can resize.
- *`loop: false` for the main list.* Rejected: when scrolling through 200+ chats, wrapping is the expected `less`-like behavior. `loop: false` is a follow-up if a real user finds wrapping disorienting.

### D11. Browser keybindings match `less` and `vim` muscle memory

**Decision:** The browser's keybinding surface is:
- `↑` / `↓` (or `k` / `j` with `theme.keybindings: ['vim']`): move cursor one row.
- `n` / `p`: next / previous page (jump by `pageSize`).
- `g` / `G`: jump to top / bottom.
- `/`: open search box (enter filter mode).
- `s`: open sort sub-menu.
- `enter`: pick the highlighted chat; if no chat is picked yet, opens the action menu. After the action menu, the action executes and the loop re-enters the browser.
- `q` / `esc` / `Ctrl+C`: quit, resolving the prompt with `{ kind: 'quit' }`.
- `Tab`: (disabled) — to avoid conflict with the `/` filter shortcut on terminals that emit `Tab` for autocomplete.

**Why:** These map cleanly onto `less` (`g`/`G`/`q`/`/`), `vim` (`j`/`k`/`g`/`G`/`/`), and `fzf` (`/` filter, `enter` pick). The shortcuts are documented in a hint line at the bottom of the TUI so users don't have to memorize.

**Alternatives considered:**
- *Match `gh`/`gl` for "go home" / "go last" (GitHub CLI style).* Rejected: less muscle memory in the CLI world.
- *Add `r` for "reverse sort" as a separate shortcut.* Rejected: the sort sub-menu covers this; one extra keypress is worth the discoverability.
- *Add `?` for help.* Rejected: the hint line is always visible; a help overlay is a follow-up.

### D12. Browser filter is substring match against `title`, mirroring the non-interactive `--search` flag

**Decision:** The browser's interactive filter (`/` key) is a substring match (case-insensitive) against `chat.title`. The same data the non-interactive `--search` flag forwards to the mediator. As the user types, the list narrows in real time; `enter` applies the filter and returns to browse mode; `esc` clears the filter and returns to browse mode with the full list.

**Why:** The non-interactive `--search` flag forwards a search string to the mediator, and the mediator's `ListChatsQuery` handler does the actual matching (against whichever fields the upstream `gemini-reverse` library supports). For the interactive TUI, the in-memory filter is a substring match on `title` because the chats are already loaded into memory (the TUI doesn't need to refetch as the user types — that would be a network round-trip per keystroke and would feel laggy). The substring match is a strict superset of the prefix match that `prompts.select`'s built-in type-ahead search does, so users get the more permissive behavior they expect.

**Alternatives considered:**
- *Match against `id` as well as `title`.* Rejected: chat IDs are opaque strings like `c_abc123`; matching them is rarely what the user wants.
- *Match against the first message of the chat.* Out of scope: would require a `FetchChatQuery` per chat at list-load time. The current `ListChatsQuery` returns `ChatInfo` summaries without message content; extending the mediator to return message snippets is a follow-up.
- *Re-fetch from the mediator on each keystroke (substring match server-side).* Rejected: the TUI's whole point is responsiveness. The data is already in memory; a client-side filter is sub-ms.

## Risks / Trade-offs

- **Bun + Inquirer raw mode.** Bun's `process.stdin.setRawMode` is a no-op. The Inquirer README states interactivity (arrows, type-ahead) still works under Bun because the keypress events are emitted by `node:readline` regardless. If a regression appears (e.g. arrow keys don't work in the REPL on Bun), the fallback is to keep `node:readline` for the REPL and use Inquirer only for the menu/confirms. **Mitigation:** the task list includes a manual smoke test step (`bun run dev` → `gemiterm new` → type, use arrow keys, `/exit`; `gemiterm list -i` → arrow keys, `/` filter, `s` sort, `enter` pick) before the change is considered complete.
- **Test mock fragility.** If a future refactor inlines the `promptInput` shim (e.g. extracts it to a module-level function) the existing `spyOn(command, "promptInput")` tests would break. **Mitigation:** the shim is on the class instance, not on the module; `spyOn` works on instance methods. The shim is documented in the spec as part of the preserved contract.
- **Inquirer hangs on non-TTY.** Mitigated by the TTY guard at the facade boundary. The guard is checked *before* calling any Inquirer function, so Inquirer is never invoked in a non-TTY context. If the guard is ever bypassed (e.g. by a future test that mocks the facade), the test is responsible for using `@inquirer/testing`'s `render()`.
- **@inquirer/prompts ESM-only.** gemiterm is already ESM (`"type": "module"`, `package.json:5`). No change required.
- **Two color systems.** Inquirer's prompt chrome uses chalk via the theme; the rest of the CLI uses chalk directly. This is by design (D6) but means the prompt color tokens are not directly composable with the rest of the CLI's color tokens. A future change could consolidate to `styleText` project-wide, but that is out of scope.
- **Validation `validate` rejects with non-string values.** Inquirer's docs require `validate` to resolve with `true | string | false`; a rejected promise is treated as a code error. The facade's `text` exposes `validate` but enforces the `boolean | string` contract in its TypeScript signature, so misuse is a compile error.
- **Custom prompt complexity.** The `browser` prompt is a stateful TUI with 3 modes (browse / search / sort) plus an action menu outside the prompt. The implementation is ~150-200 lines of `useState` + `useKeypress` + `usePagination` glue. **Mitigation:** the prompt is fully unit-tested with `@inquirer/testing`'s `render()`, which mocks the readline interface and injects keypresses programmatically. The test surface covers: arrow-key navigation, the `/` filter keystroke, the `s` sort keystroke, the `enter` action, the `q` quit keystroke, the empty-list case, and the conflict with `--format` / `--path`.
- **List re-render cost on large chat histories.** Per the Inquirer research, `usePagination` is O(n) per render. For 1000+ chats, every keystroke that changes `active` triggers a full `items.map(renderItem)`. **Mitigation:** `useMemo` is used in the browser prompt to memoize the filtered + sorted + rendered rows. The actual cost is empirically sub-ms for 1000 items with a cheap `renderItem` (string concat + chalk styling). If real users with thousands of chats report lag, a follow-up can add `useMemo` per-row (a `Map<index, string>` keyed on `(item, isActive)`).
- **TTY detection on Windows + WSL.** Bun on Windows under WSL sometimes reports `process.stdin.isTTY === true` even when stdin is piped. The TTY gate may not catch this edge case. **Mitigation:** the gate is the first line of defense; if a TUI invocation hangs in this environment, the user can `Ctrl+C` to abort (the `AbortController` handler unwinds cleanly). A follow-up can add `process.stdin.readable === false` as a secondary check.

## Migration Plan

Single-step deployment:
1. Add `@inquirer/prompts@^8.5.2` to `package.json` via `bun add`.
2. Add the facade and the new spec.
3. Migrate the four `node:readline` call sites in one PR, preserving the shim method names.
4. Add the `browser` custom prompt and the `--interactive` flag to the `list` command.
5. Add the new unit tests (facade, REPL, browser, list-command's `--interactive` branch).
6. Run `bun run typecheck`, `bun run lint:mediation`, `bun test`. Baseline must stay at 623/0.
7. Manual smoke test:
   - `bun run dev` → `gemiterm new` (REPL, type, use arrow keys, `/exit`)
   - `bun run dev` → `gemiterm auth` (5-option select menu, arrow-key navigation)
   - `bun run dev` → `gemiterm profile delete <name>` (confirm, y/n)
   - `bun run dev` → `gemiterm delete <id>` (confirm, y/n)
   - `bun run dev` → `gemiterm list -i` (TUI, arrow keys, `/` filter, `s` sort, `enter` pick, action menu, view/export/copy)
8. Manual regression test:
   - `gemiterm new "hello world"` from a clean TTY (verifies `Conversation ID:` + `Model:`)
   - `gemiterm continue <id> "follow up"` from a clean TTY (same)
   - `gemiterm list` (no flags) from a clean TTY (verifies the same 4-column text table as the pre-change baseline)
   - `gemiterm list --format json` from a clean TTY (verifies the same `{ chats: ChatInfo[] }` JSON)
   - `gemiterm list --search "foo"` (verifies the mediator payload carries `search: "foo"`)
   - `gemiterm list --all-profiles` (verifies the PROFILE column)
   - `gemiterm list --path out.txt` (verifies the file is written)
9. Manual TTY regression:
   - `echo "x" | gemiterm new "hello"` (piped stdin; verifies no REPL banner, no prompt, the one-shot output is emitted)
   - `echo "x" | gemiterm list -i` (piped stdin; verifies the TTY gate produces `NonInteractiveError` and the suggested non-interactive invocation)

Rollback: the change is a single PR; reverting it removes the facade, the `browser` prompt, and the `--interactive` flag, and restores `node:readline` at the four call sites. No data migrations, no config changes, no schema changes.

## Open Questions

None. All design decisions are settled by the constraints above. The user-approved plan explicitly added a "much better UX for interactive mode on the `list` command" (paging, sorting, filtering) without breaking the agent- and skill-facing non-interactive mechanisms; D8–D12 capture the design for that UX.
