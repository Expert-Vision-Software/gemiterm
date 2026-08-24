## Why

Free-tier users are hitting `Gemini usage limit reached; try again later or switch model` immediately on `gemiterm continue` and `gemiterm new`, even with a fresh session. The cause is upstream: `src/services/gemini-client-wrapper.ts:256` calls `this.client!.newChat()` with no model option, so the underlying `gemini-web-sdk` sends `Model.UNSPECIFIED` and the server picks the default for the account tier. On a free-tier Google account that default is now Gemini 3 Pro (per the `gemini-web-sdk@2.2.0` Model enum — every constant is `gemini-3-*` after the v2.4.0 upgrade recorded in `CHANGELOG.md:93`), and Pro has a much tighter per-account quota than Flash. The CLI has no way to switch tiers — no flag, no env var, no config field. The error message that surfaces (`gemini-client-wrapper.ts:144`) already tells the user to "switch model", but offers no path to do so. This change makes model selection a first-class capability and switches the implicit default to Flash so free-tier users stop getting rate-limited on the first turn.

## What Changes

- **`--model/-m <name>` flag on `new` and `continue`.** Accepts any of: a `model_name` string (`gemini-3-pro`, `gemini-3-flash`, `gemini-3-lite`), a `model_id` string, or any value the upstream SDK accepts as `ModelInput`. **Not validated client-side** — passed through to `gemini-web-sdk`'s `newChat({ model })`; upstream `ModelInvalid` surfaces as a typed `GeminiAPIError` via the existing `translateError` branch at `gemini-client-wrapper.ts:149-151`. `--model ""` is rejected with `Error: --model requires a non-empty value.` and exit 1.
- **`GEMITERM_MODEL` env var.** Read once at process start in `src/infrastructure/cli.ts` / `src/infrastructure/cli-parser.ts`. Falls back when `--model` is not supplied. CLI flag wins over env var.
- **Implicit default flips from `Model.UNSPECIFIED` to `Model.BASIC_FLASH` (`gemini-3-flash`).** **BREAKING** for any user (notably paid-tier Plus/Advanced) who was implicitly getting their tier-default. Mitigated by `--model gemini-3-pro-plus` / `--model gemini-3-pro-advanced`. Called out in the CHANGELOG `Changed` block. This is the actual fix for the reported rate-limit symptom.
- **`gemiterm models` becomes a default-aware view.** Each listed model prints verbatim; the currently-resolved default is suffixed with `(default)`; a hint line is appended: `Use --model <name> (or set GEMITERM_MODEL=<name>) to select. The default is currently <name>.`
- **No client-side retry/backoff on `UsageLimitExceeded`** — preserves the existing cancel-on-error doctrine (`openspec/changes/archive/2026-08-18-cancel-auth-on-browser-close/design.md:15`). The user-facing mitigation is model selection, not hidden retries.
- **No new commands.** `--model` does NOT apply to `fetch`/`delete`/`export`/`export-all`/`list`/`status`/`auth`/`install-browser`/`install-skills` (they don't generate content) or to `summarize` (in-flight change — local-only, no Gemini call).
- **No "set default model" subcommand** in this change — per stakeholder direction, the default indicator in `gemiterm models` is **display-only**. Future follow-up may add per-profile persistent default.

## Capabilities

### New Capabilities

None. The change only modifies requirements within existing capabilities.

### Modified Capabilities

- `commands`: extend the `NewCommand` requirement to accept `--model/-m`; extend the `ContinueCommand` requirement to accept `--model/-m`; extend the `ModelsCommand` requirement to render the resolved-default marker and the hint line; update `UsageSpec` documentation for both commands.
- `conversations`: extend the `GeminiClientService.sendMessage` requirement to accept an optional `model?: string` parameter and pass it to `client.newChat({ model })`; extend `GeminiClientService.startNewChat` the same way; add a new `GeminiClientService.getDefaultModel` requirement returning the resolved default (`GEMITERM_MODEL` env var when non-empty, else `Model.BASIC_FLASH`); extend the `listModels` requirement's mapping so the default marker is consumable downstream.

## Impact

- **Code touched**
  - `src/services/gemini-client-wrapper.ts` — `GeminiClientConfig` unchanged; `sendMessage` / `startNewChat` gain `model?: string` (second/third positional or options object — implementation choice; thread through `buildSession` to `this.client!.newChat({ model })`); new `getDefaultModel()` method. Existing `translateError` already handles `ModelInvalid`.
  - `src/cli/utils/chat-session.ts` — `StartChatSessionParams` gains `model?: string`; passed to `client.sendMessage` / `client.startNewChat` at lines 46 and 55.
  - `src/cli/commands/new-command.ts` — `NEW_FLAGS` gains `{ key: "model", long: "--model", short: "-m", ... }`; usage block updated; rejection of `--model ""`; pass `options.model` to `startChatSession`.
  - `src/cli/commands/continue-command.ts` — same additions.
  - `src/cli/commands/models-command.ts` — query `getDefaultModel()`, decorate matching line with `(default)`, append hint line.
  - `src/cli/command-registry.ts` — extend `CliCommandContext` with `defaultModel?: string`.
  - `src/cli/index.ts` — read `process.env.GEMITERM_MODEL` (non-empty) and propagate via `setupServices` to the context; also resolve the same env var (or `Model.BASIC_FLASH`) into a single `defaultModel` constant the wrapper's `getDefaultModel()` can return without re-reading env per call.
  - `src/infrastructure/cli-parser.ts` — accept the env var read for `parseGlobalArgs`.
- **APIs / public surface**
  - `GeminiClientService.sendMessage` and `startNewChat` gain an optional second parameter (model name) — additive; existing call sites continue to compile.
  - `GeminiClientService` gains a new `getDefaultModel(): string` method.
  - `CliCommandContext` gains `defaultModel?: string` — additive.
  - The implicit default model flips from `Model.UNSPECIFIED` to `Model.BASIC_FLASH` for every existing `gemiterm new` / `gemiterm continue` invocation that does not pass `--model` or `GEMITERM_MODEL`. **BREAKING** behavior change.
- **Dependencies** — none. `gemini-web-sdk@^2.2.0` already supports `newChat({ model })` (`node_modules/gemini-web-sdk/index.d.ts:383-388`) and `Model.BASIC_FLASH` (`index.d.ts:31-45`).
- **Multi-profile** — unchanged. Each profile's `GeminiClientService.forProfile` already constructs an independent wrapper, so model selection is per-call and per-profile-safe.
- **Auth-sensitive paths** — none touched. No edits to `src/auth/`, `src/services/playwright-cli-driver.ts`, or `src/auth/browser-refresher.ts`. The `bun run check:auth-gate` regression gate does not fire.
- **Path mediation** — no new `node:fs` / `node:path` / `node:os` imports outside the existing exemptions in `scripts/lint-path-mediation.sh`. The path-mediation lint passes.
- **Standing traps preserved**
  - Static `models()` table divergence (`AGENTS.md:55`, `docs/auth-cookie-lifecycle.md:662`) — we do not probe auth with it, and we do NOT validate `--model` values against it; the value flows through to the SDK.
  - Cancel-on-error doctrine (`openspec/changes/archive/2026-08-18-cancel-auth-on-browser-close/design.md:15`) — preserved; no in-tree retry/backoff on `UsageLimitExceeded`.
  - `GeminiAPIError("Gemini usage limit reached; try again later or switch model")` text at `gemini-client-wrapper.ts:144` — preserved unchanged; the "switch model" hint it already mentions becomes actionable with this change.