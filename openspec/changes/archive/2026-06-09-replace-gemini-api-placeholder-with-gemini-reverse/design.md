## Context

`src/services/gemini-client-wrapper.ts` is a 304-line placeholder that talks
to `gemini.google.com` over `fetch()` with hand-typed `URLSearchParams` bodies
and guessed endpoint paths. The class implements two interfaces:

- `IGeminiClientService` (`src/core/command-handlers.ts:92`) — `deleteChat`,
  `sendMessage`, `startNewChat`, `profileHasConversation`, `forProfile`.
- `IGeminiClientQueryService` (`src/core/query-handlers.ts:56`) — `listChats`,
  `fetchChat`, `listModels`.

`GeminiClientService` is currently constructed in one place
(`src/cli/index.ts:98,110`) and consumed in three (`src/cli/index.ts:116-153`,
`src/services/profile-auth-manager.ts:22-54`, plus all command/query handlers
that depend on the interfaces — never on the class directly).

The proposed replacement is the npm package
[`gemini-reverse`](https://www.npmjs.com/package/gemini-reverse) by
[rynn-k](https://github.com/rynn-k/Gemini-Reverse). It exposes:

- `class GeminiClient` with constructor
  `({ secure_1psid, secure_1psidts?, proxy?, cookies? })` and async
  `init({ timeout?, autoClose?, closeDelay?, autoRefresh?, refreshInterval?,
  verbose?, watchdogTimeout? })`.
- `client.listChats(): ChatInfo[]` (fields: `cid`, `title`, `is_pinned`,
  `timestamp`).
- `client.readChat(cid: string, limit?: number): Promise<ChatHistory | null>` —
  `ChatHistory.turns: { role, text, parts? }[]`.
- `client.startChat(opts?): ChatSession` — session with
  `sendMessage({ prompt, … }): Promise<ModelOutput>`,
  `readHistory(limit?): Promise<ChatHistory | null>`, `cid`, `rcid`.
- `client.generateContent({ prompt, … }): Promise<ModelOutput>` for
  single-shot.
- `client.deleteChat(cid: string): Promise<void>`.
- `client.listModels(): AvailableModel[]` (fields: `model_id`, `model_name`,
  `display_name`, `description`, `capacity`, `is_available`, …).
- Error classes: `GeminiError` (base), `AuthError`, `APIError`, `TimeoutError`,
  `UsageLimitExceeded`, `TemporarilyBlocked`, `ModelInvalid`.

`src/core/errors.ts` defines `GemitermError` (base), `AuthenticationError`,
`CookieExpiredError`, `GeminiAPIError`, `ConversationNotFoundError`,
`ConversationPendingError`. Callers expect these types in `try/catch` blocks
(e.g. `command-handlers.ts:120`, `query-handlers.ts:138`).

## Goals / Non-Goals

**Goals:**

- Replace the placeholder `fetch()`-based HTTP client with a real Gemini web
  protocol client that talks to the live service.
- Keep the public class signature of `GeminiClientService` and the two
  interfaces it implements bit-identical, so all 11 CLI commands, the
  `ProfileAuthManager`, and the command/query handlers need zero edits.
- Translate `gemini-reverse` exceptions into our `GemitermError` subclasses so
  the existing error-handling in command handlers keeps working.
- Preserve the per-profile session model: each profile gets its own
  `GeminiClient` (and therefore its own auto-refresh watchdog) bound to the
  cookies loaded by `CookieStorageService`.
- Add a unit test file that mocks `gemini-reverse` and verifies the mapping
  and error translation in isolation, so we don't need a real Google account
  in CI.
- Stay at the 432/432 test baseline (and add new tests on top of it).

**Non-Goals:**

- Surfacing `gemini-reverse` features the wrapper doesn't currently expose
  (Gems, file uploads, deep research, streaming, image/video output, candidate
  selection). These are deferred to a follow-up change.
- Changing the cookie storage file format or the v1.4.1 → v2.0.0 migration
  story.
- Touching any of the four regression-gate files flagged in `AGENTS.md`
  (`playwright-cli-driver.ts`, `cookie-monitor.ts`, `auth-service.ts`,
  `cookie-storage-service.ts`).
- Resolving the existing `bun run build` breakage (that's the
  `cross-platform-build-and-ci` change).
- Re-shaping `IGeminiClientService` or `IGeminiClientQueryService` — those
  are part of the `conversations` / `multi-profile-conversations` /
  `commands` capability contracts and are explicitly preserved.

## Decisions

### Decision 1: `gemini-reverse` over hand-rolled or other libraries

We pick `gemini-reverse@^0.x` (pin the exact range in `tasks.md` based on
current npm at implementation time) because:

- It is the only widely-used library that wraps the live Gemini web protocol
  (same upstream as our `playwright-cli`-driven auth).
- It handles cookie auto-refresh in the background (the upstream `1PSIDTS`
  cookie rotates on a timer; hand-rolling this is a known footgun).
- It is pure JavaScript with no native bindings, so Bun resolves it cleanly.

**Alternatives considered:**

- *Port Python `gemiterm` v1.4.1's `gemini_webapi` usage.* Rejected: that
  project is the Python equivalent, not a Node package.
- *Re-implement the HTTP client in TypeScript.* Rejected: the upstream
  protocol changes and the auth flow is non-trivial; this is the path that
  produced the placeholder we're replacing.
- *Use Google's official `generativelanguage` SDK.* Rejected: that's a
  different product (AI Studio API key model) — `gemiterm` is explicitly a
  CLI for the consumer web app, not the AI Studio API.

### Decision 2: Compose `GeminiClient` per-instance, not per-CLI

The current placeholder holds cookies on a `GeminiClientConfig` and uses
`fetch()` directly. The new wrapper holds a `GeminiClient` instance from
`gemini-reverse` as a private field, and calls `listChats()` / `readChat()` /
`startChat()` / `deleteChat()` / `listModels()` on it.

`forProfile(name)` constructs a brand-new `GeminiClientService` with a
brand-new `GeminiClient` bound to the profile's cookies. This is what
`gemini-reverse` is designed for (one client = one logged-in account) and
naturally scopes the upstream auto-refresh watchdog to that profile.

**Why not a single shared `GeminiClient` and pass cookies per call?** The
upstream API bakes cookies into the client at construction time and runs the
refresh watchdog against that single account. A shared client would mean the
"current" profile is implicit state, and `forProfile()` could race the
watchdog. Per-instance is the upstream-idiomatic and race-free model.

### Decision 3: Translation layer is a private helper, not a public module

Mapping `gemini-reverse` types into our domain types (`ChatInfo`, `Message`,
model display names) and translating exceptions into `GemitermError`
subclasses lives as **private methods** on `GeminiClientService`, not as
exported functions in a new module. Reasons:

- Only `GeminiClientService` needs them.
- Keeping the translation local makes the wrapper's contract surface minimal
  — `core/types.ts` stays the only public domain-types module, and
  `core/errors.ts` stays the only public error module.
- It avoids leaking the `gemini-reverse` import path into more than one file
  (which simplifies future swaps if we ever need to replace this library
  again).

The private helpers we will introduce:

- `toDomainChatInfo(raw: geminiReverse.ChatInfo, profileName?: string):
  ChatInfo` — maps `cid → id`, `is_pinned → isPinned`, preserves `timestamp`
  and `title`, adds `profile` when `profileName` is set (matches existing
  placeholder behavior on `gemini-client-wrapper.ts:144`).
- `toDomainMessages(history: geminiReverse.ChatHistory, conversationId:
  string): Message[]` — flattens `turns[].text ?? turns[].parts[].text` and
  normalizes `role` to `"user" | "model"`.
- `toDomainModelName(model: geminiReverse.AvailableModel): string` — returns
  `display_name || model_name || model_id`.
- `translateError(e: unknown): GemitermError` — see Decision 5.

### Decision 4: `init()` is exposed on the wrapper, not lazy

The placeholder's constructor sets `this.authenticated = !!config.secure1psid`
and never makes a network call. `gemini-reverse`'s `GeminiClient.init()` is
async and does perform I/O (probe models, set up refresh watchdog). To keep
the wrapper's construction synchronous (the factory in `src/cli/index.ts:98,110`
calls `new GeminiClientService(…)` without `await`), we add an explicit async
`init(): Promise<void>` on the wrapper that:

1. Awaits `this.client.init({ timeout: 300_000, autoClose: false,
   autoRefresh: true, refreshInterval: 540_000 })`.
2. Is called once at CLI startup (in `src/cli/index.ts` after the factory
   is constructed and before the first user command) — the call site edit
   is a 2-line addition.
3. Is idempotent (`this.initialized` guard) so re-entry from test setup is
   safe.
4. `forProfile()` returns a wrapper whose `init()` is also lazily awaited
   before its first call (or eagerly awaited in the same place; decided in
   the implementation based on call-site symmetry).

The factory in `src/cli/index.ts` constructs the wrapper with
`secure1psid: ""` (a placeholder until a profile is selected). For that
factory instance, `init()` is called with empty cookies and we treat that as
"deferred" — `init()` is still awaited, but the underlying `GeminiClient` is
not used for I/O until a profile is selected (the per-profile wrappers
constructed via `forProfile()` do the real I/O).

**Why not lazy `init()` on first call?** Two reasons: (a) the existing
`ProfileAuthManager` and command handlers can call methods concurrently
during a multi-profile operation, and lazy init is racy without a mutex; (b)
explicit init at startup makes the `await` visible in `src/cli/index.ts` and
keeps the lifecycle linear.

### Decision 5: Error translation mapping

Add a private `translateError(e: unknown): GemitermError` to the wrapper
(per Decision 3). Mapping:

| `gemini-reverse` class  | Translated to                        | Message                                              |
|-------------------------|--------------------------------------|------------------------------------------------------|
| `AuthError`             | `AuthenticationError`                | `"Session expired or invalid. Please run 'gemiterm login' again."` (matches the existing message at `gemini-client-wrapper.ts:83`) |
| `TimeoutError`          | `GeminiAPIError`                     | `"Request to Gemini timed out"`                      |
| `UsageLimitExceeded`    | `GeminiAPIError`                     | `"Gemini usage limit reached; try again later or switch model"` |
| `TemporarilyBlocked`    | `GeminiAPIError`                     | `"Temporarily blocked by Gemini; try a proxy or wait"` |
| `ModelInvalid`          | `GeminiAPIError`                     | `"Model is invalid or unavailable"`                  |
| `APIError`              | `GeminiAPIError`                     | `e.message` (with `cause = e`)                       |
| any other `GeminiError` | `GeminiAPIError`                     | `e.message` (with `cause = e`)                       |
| anything else           | `GeminiAPIError`                     | `"Unexpected error: " + String(e)`                   |

The `cause` field on `GeminiAPIError` is supported by `Error` since ES2022
and is the right channel for the underlying error so the existing
`logger.debug(\`${operation} failed: ${error}\`)` calls in
command/query handlers still see the original message via
`error.cause?.message`.

We do **not** re-export `gemini-reverse` error classes from `core/errors.ts`.
That would leak the library's type surface into our public module, which
violates the "translate, don't re-export" principle and increases the blast
radius of any future library swap.

### Decision 6: `sendMessage` and `startNewChat` return types stay text-only

`IGeminiClientService.sendMessage(cid, msg): Promise<string>` and
`startNewChat(msg): Promise<{ response: string; conversationId: string }>`
return plain text today. `gemini-reverse` returns a rich `ModelOutput` with
candidates, images, videos, thoughts, deep-research plans, and an `rcid` we
can use as the conversation ID.

We keep the wrappers text-only for this change and pull
`output.text.toString()`. Surfacing candidates / media / `rcid` is a
follow-up change (and a new capability spec) — it requires deciding how
`gemiterm chat --json` should serialize them, which is out of scope here.

For `startNewChat`, the `conversationId` we return comes from the
`ChatSession.cid` after `client.startChat().sendMessage(...)` returns
(equivalently `output.rcid` is also a valid candidate — we pick `cid` to
match the existing `cid` field on `ChatInfo` from `listChats`).

### Decision 7: Test strategy — module mock, not real network

Add `tests/services/gemini-client-wrapper.test.ts` that:

- Uses `bun:test`'s `mock.module("gemini-reverse", …)` to install a fake
  `GeminiClient` class whose constructor records its arguments and whose
  methods return fixtures.
- Spies on the fake's `listChats` / `readChat` / `startChat` / `deleteChat` /
  `listModels` / `init` methods to assert that the wrapper calls them with
  the right arguments and translates the return values into our domain
  types.
- Asserts the `AuthError → AuthenticationError` and the other error
  translations by injecting the relevant `gemini-reverse` error class
  instances and catching them.
- Verifies `forProfile(name)` constructs a *new* `GeminiClient` bound to
  that profile's cookies (asserted via a counter on the mock constructor).

This mirrors the test style of
`tests/services/cookie-storage-service.test.ts` and keeps the test
self-contained (no network, no Playwright, no `playwright-cli`).

The factory instance in `src/cli/index.ts:110` uses an empty
`secure1psid: ""` and is used only as a `forProfile` factory; it is not
exercised directly. We add a separate, small test for "empty-cookies client
constructs but does not throw" to lock in the invariant.

### Decision 8: Dependency version

Pin `gemini-reverse` to `^0.5.0` (or whatever the latest stable is at
implementation time — task 1 of `tasks.md` re-validates this against
`npm view gemini-reverse version` and updates the `package.json` entry
accordingly). The `^0.5.0` placeholder is to convey "use the latest 0.x" in
the `tasks.md` pin — implementers should re-check the registry.

## Risks / Trade-offs

- **[Upstream library is unofficial / can break]** → Mitigation: we wrap it
  in `GeminiClientService` and translate errors. If `gemini-reverse`
  changes its public API, the blast radius is the wrapper file only. We
  also pin to `^0.x` (not `^1.0.0` yet) to acknowledge pre-1.0 churn.
- **[Cookie auto-refresh race with multi-profile use]** → Mitigation:
  per-instance `GeminiClient` per profile (Decision 2). Each profile's
  watchdog runs against its own session, no shared state.
- **[Bun resolution of npm package]** → Mitigation: `gemini-reverse` is
  pure JS (no native bindings, no `node-gyp`). Task 1 in `tasks.md` adds
  a `bun test` smoke step that imports the package from a placeholder
  `src/services/__smoke__/import-gemini-reverse.test.ts` to catch any
  resolution issue early. The smoke test is removed after the real tests
  are in place.
- **[Loss of placeholder-specific `search` / `limit` / `offset` filtering
  in `listChats`]** → Mitigation: `gemini-reverse`'s `listChats()` returns
  a fully populated array. The wrapper applies the same post-filter (case-
  insensitive `search` on `title`, then `offset` slice, then `limit` slice)
  after mapping, preserving the existing behavior at
  `gemini-client-wrapper.ts:148-160`.
- **[Empty-cookies factory instance crashes `init()`]** → Mitigation:
  `gemini-reverse`'s `init()` tolerates null/empty `secure_1psid` (it
  defers actual I/O until a method is called). We add a smoke test
  asserting the factory instance constructs and `init()` resolves without
  throwing.
- **[Per-call `GeminiClient` construction is heavier than per-call `fetch`]**
  → Mitigation: this is a CLI invoked once per user command, not a
  long-running daemon. Construction cost is negligible.
- **[Test count churn]** → The new test file adds tests but should not
  remove any of the 432 existing tests. `bun run test` after
  implementation must show `≥ 432` tests passing (target: 432 + ~25 new
  cases from the new file).

## Migration Plan

- **Deploy**: this is a `v2.0.0` change; deploy with the normal release
  process (handled by the `cross-platform-build-and-ci` change once
  that's implemented — out of scope here).
- **Rollback**: revert the single commit that swaps the wrapper; the
  previous `fetch()`-based implementation lives in `git` history. Cookie
  files in `%APPDATA%\gemiterm\` / `~/.config/gemiterm/` are unchanged.
- **User action**: none. No re-auth, no config migration, no new flags.
- **Operational note**: the first call after upgrade will hit
  `gemini-reverse`'s model probe and chat list, which performs a couple
  of HTTPS requests at startup. Latency is comparable to the placeholder.

## Open Questions

- **Q1**: At implementation time, confirm the latest published
  `gemini-reverse` version on npm and pin accordingly (placeholder:
  `^0.5.0`).
- **Q2**: Confirm Bun resolves `import { GeminiClient } from "gemini-reverse"`
  cleanly (no `bun install` quirks). This is the first non-Bun-first-party
  runtime dep we're pulling in.
- **Q3**: Decide whether `init()` failure should be fatal at CLI startup
  or deferred until first use. Default plan (per Decision 4): fatal
  at startup, with the error mapped to `GeminiAPIError` and surfaced as
  the standard CLI error.
- **Q4**: Should we expose a `--no-auto-refresh` flag to disable
  `gemini-reverse`'s cookie auto-refresh for debugging? Deferred to a
  follow-up; not in this change.
