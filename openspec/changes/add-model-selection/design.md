## Context

GemiTerm drives the consumer Gemini web app via `gemini-web-sdk@^2.2.0`. The SDK is built around a `ChatSession` created by `client.newChat(opts?: { model?, ... })`. Today `src/services/gemini-client-wrapper.ts:256` calls `this.client!.newChat()` with **no options at all**, so the wire request carries `Model.UNSPECIFIED` ("Any — Gemini chooses") and the server picks the default for the account tier. After the v2.4.0 SDK upgrade the catalog is entirely `gemini-3-*` (per `CHANGELOG.md:93`), and on free-tier accounts the implicit selection is now Gemini 3 Pro — which has a much tighter per-account quota than Flash. The result, observed on 2026-08-24, is `GeminiAPIError("Gemini usage limit reached; try again later or switch model")` thrown on the first call (the message is set at `gemini-client-wrapper.ts:144`). The CLI has no flag, env var, or config field that lets a user switch models. The error text already tells the user to "switch model"; this change makes that actionable.

`openspec/changes/add-model-selection/proposal.md` carries the why/what. This document carries the how.

## Goals / Non-Goals

**Goals**

- Add `--model/-m <name>` to `new` and `continue`. Pass the value through `src/cli/utils/chat-session.ts` to `GeminiClientService.sendMessage` / `startNewChat` as an optional `model?` second/third argument; the wrapper forwards it to `client.newChat({ model })`.
- Read `GEMITERM_MODEL` from the process environment at the CLI boundary (`src/cli/index.ts` / `src/infrastructure/cli-parser.ts`); propagate the resolved value as `CliCommandContext.defaultModel`; `ModelsCommand` consumes it for the `(default)` marker and hint line.
- Switch the implicit default from `Model.UNSPECIFIED` to `Model.BASIC_FLASH` (`gemini-3-flash`). Behavior change; called out in CHANGELOG `Changed`.
- Make `gemiterm models` display-aware: list every model, suffix the resolved-default line with ` (default)`, append a hint line.
- Preserve all existing call-site behavior when neither `--model` nor `GEMITERM_MODEL` is supplied *and* the wire call is allowed to use `Model.UNSPECIFIED` — except for the implicit-default flip above. The "pre-change no-options behavior" is preserved for callers that explicitly pass an empty string or omit the argument.
- Preserve the existing error-translation table (`AuthError` → `AuthenticationError`, `UsageLimitExceeded` → `"Gemini usage limit reached..."`, `ModelInvalid` → `"Model is invalid or unavailable"`, etc.) at `gemini-client-wrapper.ts:133-162` — `ModelInvalid` is the path an invalid `--model` value will take, so the existing branch is what makes "garbage in, typed error out" work.

**Non-Goals**

- No new client-side retry / backoff for `UsageLimitExceeded`. Preserves the cancel-on-error doctrine (`openspec/changes/archive/2026-08-18-cancel-auth-on-browser-close/design.md:15`). The user-facing mitigation is `--model`, not hidden retries.
- No client-side validation of model names against the SDK's static `models()` catalog. The catalog is explicitly **not** the account reality (`AGENTS.md:55`, `docs/auth-cookie-lifecycle.md:662`); pre-validating would mislead and would let bad names reach the wire anyway if the catalog drifts.
- No `--model` on `fetch` / `delete` / `export` / `export-all` / `list` / `status` / `auth` / `install-browser` / `install-skills` — none of those generate content. No `--model` on the in-flight `summarize` command either; it is a local-only summarizer (`openspec/changes/chat-list-bulk-actions/specs/commands/spec.md:204-208`).
- No persistent per-profile `defaultModel`. Display-only in this change; a follow-up change may add `gemiterm config set default-model` later.
- No `node:fs` / `node:path` / `node:os` import added outside the existing exemptions (`scripts/lint-path-mediation.sh`). Path-mediation lint must still pass.
- No edits to `src/auth/`, `src/services/playwright-cli-driver.ts`, or `src/auth/browser-refresher.ts`. The `bun run check:auth-gate` regression gate must not fire.
- No change to the `GeminiAPIError` text. The existing `"Gemini usage limit reached; try again later or switch model"` becomes actionable, not wrong.

## Decisions

### D1. Thread `model?: string` through the wrapper's public surface; do not modify `GeminiClientConfig`.

The wrapper exposes two methods that construct a chat session: `sendMessage(conversationId, message)` at `gemini-client-wrapper.ts:265` and `startNewChat(message)` at line 299. Both go through `buildSession(conversationId, metadata?)` at line 255, which is the single seam where `this.client!.newChat()` is invoked. We add an optional `model?: string` parameter to both public methods and thread it through `buildSession` to `this.client!.newChat({ model })`. We do **not** add `model` to `GeminiClientConfig` (`gemini-client-wrapper.ts:63-66`) because model selection is per-call (the user can switch models turn-to-turn inside a REPL), not per-client. Adding it to `GeminiClientConfig` would bake a model into the SDK instance and force re-construction on model change. SDK-side, `GeminiClientDeps.Gemini` is `any`-typed (`gemini-client-wrapper.ts:9`), so the wrapper's typed surface is the only place we need to type the new argument.

**Alternative considered:** a single `options: { model?: string }` object. Rejected for this change because the wrapper's existing positional signature is entrenched (call sites in `src/cli/utils/chat-session.ts:46, 55, 70, 75` and downstream tests use positional arguments). Adding an options object would force a coordinated call-site rewrite for one additive argument. If a third option is added later, that is the time to consolidate.

### D2. SDK call stays `any`-typed; wrapper's public types are tightened.

`GeminiClientDeps.Gemini` and `RawChatSession` are already `any`-typed (`gemini-client-wrapper.ts:9, 21, 60`). The SDK's `NewChatOptions` interface (`node_modules/gemini-web-sdk/index.d.ts:383-388`) declares `model?: ModelInput` where `ModelInput = string | ModelDef | ModelDict | AvailableModel | null`. Threading `string` is type-safe at the wrapper boundary because the SDK accepts `string` for `ModelInput`. No `// eslint-disable` comment required.

### D3. Resolution order is `--model` > `GEMITERM_MODEL` > implicit default `Model.BASIC_FLASH`. Resolved once per process, propagated via `CliCommandContext`.

CLI flag wins over env var (a common UX pattern; matches `OPENAI_DEFAULT_MODEL`-style env vars that `--model` overrides). The env var is read once at process start (`src/cli/index.ts:setupServices`), trimmed, and stored on the `CliCommandContext` as `defaultModel?: string`. `NewCommand` and `ContinueCommand` resolve per-call: if `options.model` (parsed from `--model`) is a non-empty string, use it; else use `context.defaultModel`; else use `"gemini-3-flash"` (the `model_name` of `Model.BASIC_FLASH`). This matches the spec delta's `Resolved model` semantics.

**Alternative considered:** resolving inside the wrapper on every call. Rejected — per-call env reads (`process.env.GEMITERM_MODEL`) hide config changes from tests and make the wiring harder to reason about. Per-process resolution at the CLI boundary is consistent with how `verbose` is handled (`src/cli/index.ts:120`).

### D4. `GEMITERM_MODEL` reading lives in `src/infrastructure/cli-parser.ts` (`parseGlobalArgs`) and is consumed in `src/cli/index.ts:setupServices`. Wrapper reads `process.env` itself only for `getDefaultModel`.

`parseGlobalArgs` is the canonical seam for global flags and env-var reads (`src/infrastructure/cli-parser.ts:36-69`). It already handles `GEMITERM_VERBOSE`. Adding `GEMITERM_MODEL` here keeps the env-read policy in one file. The wrapper's new `getDefaultModel()` reads `process.env.GEMITERM_MODEL` afresh on each call (per the spec scenario) so test stubs that mutate the environment are observed without needing to re-instantiate the wrapper.

**Alternative considered:** having `parseGlobalArgs` set a singleton and the wrapper read it. Rejected — the wrapper is constructed inside `CookieSession.forProfile` and may be re-instantiated per-call in some flows; reading `process.env` per call is cheaper than wiring a global.

### D5. No client-side model name validation. Pass through whatever the user supplied; let `ModelInvalid` surface as `GeminiAPIError`.

The SDK's `models()` table is **static and decoupled from account reality** (`AGENTS.md:55`, `docs/auth-cookie-lifecycle.md:662`). Rejecting names that are not in the static catalog would be a false negative — names that work for the user but are not in the SDK's static table would fail unnecessarily. Names that look syntactically valid but are not available for the user's account tier are correctly rejected by the SDK itself with `ModelInvalid`, which `translateError` at `gemini-client-wrapper.ts:149-151` already maps to `"Model is invalid or unavailable"`. This makes "garbage in, typed error out" work end-to-end without a parallel validation path to maintain.

**Alternative considered:** validating against the union of static `Model` enum constants (`gemini-3-pro`, `gemini-3-flash`, `gemini-3-lite`, …). Rejected for the same reason — Plus / Advanced tier models (`gemini-3-pro-plus`, etc.) might appear on a paid user but not in the SDK's free-tier static table.

### D6. `gemiterm models` adds the `(default)` marker and the hint line. No "set default" subcommand in this change.

The `ModelsCommand` requirement (added to `openspec/changes/add-model-selection/specs/commands/spec.md`) defines the exact output shape. The default model is queried from `client.getDefaultModel()`; if it returns a non-empty string, the matching line is suffixed with ` (default)` (case-sensitive equality against the values returned by `listModels()`) and a hint line is appended. If `getDefaultModel()` returns `""`, neither marker is applied. This matches the stakeholder direction "ensure `gemiterm models` denotes which one is set as default (not modifiable yet)".

**Alternative considered:** adding a `gemiterm config set default-model <name>` subcommand. Deferred — out of scope per stakeholder direction; would also require persistent config storage, which is a larger scope.

### D7. Implicit default is `Model.BASIC_FLASH` (`gemini-3-flash`) unconditionally.

We map to the SDK's `Model.BASIC_FLASH` constant so the wire format matches the SDK's canonical identifier (`gemini-3-flash`). Paid-tier users who want Pro will pass `--model gemini-3-pro-plus` or set `GEMITERM_MODEL=gemini-3-pro-plus`. This is the actual fix for the rate-limit symptom; the implicit `Model.UNSPECIFIED` path is what got free-tier users routed to Pro server-side.

**Alternative considered:** making the implicit default tier-aware (Plus users get Plus Pro, Free users get Free Flash). Rejected — GemiTerm has no signal for the user's tier other than which Google account they're using, and probing that here would re-introduce the `models()`-as-probe anti-pattern that AGENTS.md flags. A simpler rule is also a more debuggable rule.

### D8. No retry / backoff on `UsageLimitExceeded`. The user-facing mitigation is `--model`.

The cancel-on-error doctrine (`openspec/changes/archive/2026-08-18-cancel-auth-on-browser-close/design.md:15`) applies here: classified errors are surfaced to the user; retry/backoff is not added in-tree. The upstream SDK has internal zombie-stream-watchdog retry-with-backoff that lives inside `gemini-web-sdk`, but it does **not** cover the `UsageLimitExceeded` path; that path throws synchronously. Adding in-tree retry would (a) silently re-route the user away from the model selection they should be making, (b) delay the actionable signal, and (c) introduce exponential-backoff bookkeeping that the SDK's other layer does not need.

## Risks / Trade-offs

- **[Behavior change for paid-tier users]** Switching the implicit default from `Model.UNSPECIFIED` to `Model.BASIC_FLASH` is observable as a quality regression for users who were implicitly getting their tier-default Pro model. **Mitigation:** CHANGELOG `Changed` block calls it out; `--model gemini-3-pro-plus` / `--model gemini-3-pro-advanced` is the opt-in.
- **[Implicit-default flip is per-process, not per-profile]** `getDefaultModel` is process-wide. A user with one work profile (Plus tier, expects Pro) and one personal profile (Free tier, expects Flash) cannot get different defaults without `GEMITERM_MODEL` / `--model`. **Mitigation:** accept this as a documented limitation; per-profile defaults are the deferred follow-up.
- **[No client-side validation]** A user can pass `--model garbage` and get a network round-trip before seeing `Model is invalid or unavailable`. **Mitigation:** the error message is typed and actionable; the SDK has the canonical source of truth.
- **[Env var read inside `getDefaultModel` is per-call]** A long-lived CLI that holds the context across many turns will re-read `process.env` on every `getDefaultModel()` call. **Mitigation:** `process.env` reads are O(1) syscall-free V8 calls; the cost is negligible. The alternative (caching) would make tests harder without a measurable benefit.
- **[No in-tree retry means an immediate, hard failure on rate limits]** Some users may prefer silent retries. **Mitigation:** the design choice preserves the cancel-on-error doctrine; the alternative would conflict with the standing design.
- **[SDK constant string drift]** If `gemini-web-sdk` renames `Model.BASIC_FLASH` (unlikely — the enum has been stable since `gemini-reverse` 2.1.0 and `gemini-web-sdk` 2.2.0 inherited it), `getDefaultModel` would return a stale string. **Mitigation:** the SDK's `Model` enum is part of the public contract; the upgrade smoke test at `tests/smoke/gemini-web-sdk-contract.test.ts` would catch a rename.

## Migration Plan

- **Roll-forward only.** The implicit-default flip is the only behavior change. No data migration, no file-format change, no on-disk state change. Users who do not pass `--model` or `GEMITERM_MODEL` will get `Model.BASIC_FLASH` server-side instead of the server-side default — for free-tier users this is the intended fix; for paid-tier users the CHANGELOG `Changed` block calls out the opt-in via `--model`.
- **Rollback.** Reverting `src/services/gemini-client-wrapper.ts` and the two command files restores the prior behavior. No data to roll back. `git revert` of the merge commit is sufficient.
- **No CHANGELOG bump in this PR.** The CHANGELOG edit lands with the implementation PR, not the proposal PR (per the repo's existing pattern — `CHANGELOG.md` is updated in the same commit that ships the change).

## Open Questions

None blocking. The two clarifying questions in the proposal (`## Rate Limits` docs scope; implicit default flip for paid-tier users) were resolved by the user during the plan-approval phase. The per-profile persistent default is explicitly deferred.