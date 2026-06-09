## 1. Dependency setup

- [x] 1.1 Run `npm view gemini-reverse version` (or
  `bun pm view gemini-reverse version` if available) and pin the latest
  stable in `package.json` `dependencies` (placeholder in design: `^0.5.0`).
- [x] 1.2 Run `bun install` and confirm `node_modules/gemini-reverse/`
  resolves and `package.json` `dependencies` lists the package.
- [x] 1.3 Open `node_modules/gemini-reverse/index.d.ts` and confirm the
  exported types match the names used in `design.md` (`GeminiClient`,
  `ChatInfo`, `ChatSession`, `ModelOutput`, `AvailableModel`, `ChatHistory`,
  `AuthError`, `APIError`, `TimeoutError`, `UsageLimitExceeded`,
  `TemporarilyBlocked`, `ModelInvalid`, `GeminiError`). Update
  `design.md` (open question Q1) and the import list in
  `src/services/gemini-client-wrapper.ts` if any name differs.
- [x] 1.4 Run `bun run typecheck` and confirm the existing 432-test
  baseline project still type-checks (no behavior change yet — package
  is installed but not imported anywhere).

## 2. Wrapper rewrite — composition

- [x] 2.1 In `src/services/gemini-client-wrapper.ts`, replace the import
  block: add `import { GeminiClient } from "gemini-reverse";` and the
  named error classes (`AuthError`, `APIError`, `TimeoutError`,
  `UsageLimitExceeded`, `TemporarilyBlocked`, `ModelInvalid`,
  `GeminiError`) per `design.md` Decision 5. Keep the existing imports
  for our domain types and our error classes.
- [x] 2.2 Replace the `GeminiClientConfig` interface to mirror the
  upstream constructor's option shape:
  `interface GeminiClientConfig { secure1psid: string; secure1psidts?: string | null }`.
  Keep the field names `secure1psid` / `secure1psidts` (matching
  `src/cli/index.ts:98,110` and `cookie-storage-service.ts`) — the
  wrapper adapts them to upstream's `secure_1psid` / `secure_1psidts`
  at construction time.
- [x] 2.3 Add a private field `private readonly client: GeminiClient;`
  and construct it in the constructor as
  `new GeminiClient({ secure_1psid: config.secure1psid, secure_1psidts:
  config.secure1psidts ?? null })`. The `client` is **not** initialized
  in the constructor — see task 2.5.
- [x] 2.4 Replace the placeholder fields `authenticated` and the
  methods `buildHeaders`, `buildCookieHeader`, `requestApi`,
  `ensureAuthenticated` with the upstream-backed implementation.
- [x] 2.5 Add an async public method `init(): Promise<void>` that
  awaits `this.client.init({ timeout: 300_000, autoClose: false,
  autoRefresh: true, refreshInterval: 540_000 })`. Guard with
  `this.initialized` so re-entry is a no-op.
- [x] 2.6 Make `listChats`, `fetchChat`, `sendMessage`, `startNewChat`,
  `deleteChat`, `listModels` all async-call into `this.client.*` and
  wrap each call in a `try { … } catch (e) { throw translateError(e); }`
  (translateError defined in task 2.8). Ensure `init()` is awaited
  implicitly on first call (a per-instance `initPromise: Promise<void>`
  field that `init()` populates; methods `await this.initPromise` before
  any I/O — keeps the contract simple and avoids races).
- [x] 2.7 Keep `forProfile(profileName)` returning a new
  `GeminiClientService` bound to the profile's cookies (per
  `design.md` Decision 2). The per-profile wrapper is constructed with
  its own `GeminiClient` instance; `init()` is called on the new
  instance (not the parent) the first time it is used.
- [x] 2.8 Implement the private `translateError(e: unknown):
  GemitermError` per `design.md` Decision 5's table. Use
  `instanceof` against the upstream error classes. Always set
  `cause = e` (when `e` is an `Error`) on the returned
  `GemitermError` so the existing `logger.debug(\`${op} failed: ${error}\`)`
  call sites in command/query handlers see the underlying message via
  `error.cause?.message`.
- [x] 2.9 Implement the private mapping helpers
  (`toDomainChatInfo`, `toDomainMessages`, `toDomainModelName`) per
  `design.md` Decision 3. Apply post-filter (`search` / `limit` /
  `offset`) in `listChats` exactly as the placeholder does at
  `gemini-client-wrapper.ts:148-160`.
- [x] 2.10 Preserve the public class fields and methods consumed by
  callers: `logger`, `cookieStorageService`, `profileName`, and
  `isAuthenticated()`. `isAuthenticated()` returns `true` once
  `init()` has resolved and `this.client` is ready, `false`
  otherwise (mirrors the existing `authenticated` flag).

## 3. Call-site wiring (CLI startup)

- [x] 3.1 In `src/cli/index.ts`, after the `factoryClient` is
  constructed (around line 110), add a single `await
  factoryClient.init()` before the command registry is built. The
  factory instance has empty cookies; this should resolve without
  error (upstream `init()` tolerates empty cookies — confirm via the
  test in task 5.4).
- [x] 3.2 Confirm `src/cli/index.ts:89-104` (`getGeminiClient()`) and
  the per-profile `forProfile()` chain at lines 116-153 need **no
  other edits** — the wrapper's signature is unchanged. If
  `getGeminiClient()` caches the singleton, add an `await init()`
  on the cached value the first time it is requested.
- [x] 3.3 Run `bun run typecheck` and confirm `tsc --noEmit` passes
  with the new wrapper.
- [x] 3.4 Confirm no other file under `src/` imports
  `gemini-client-wrapper.ts` *or* `gemini-reverse` outside of the
  wrapper itself. `AGENTS.md` path-mediation lint should remain
  clean (the wrapper does not import `node:fs` / `node:path` /
  `node:os`).

## 4. Test setup

- [x] 4.1 Create `tests/services/gemini-client-wrapper.test.ts` using
  `bun:test`. Use `mock.module("gemini-reverse", …)` to install a
  fake `GeminiClient` class before the wrapper is imported. Mirror
  the style of `tests/services/cookie-storage-service.test.ts` (no
  external network, deterministic fixtures).
- [x] 4.2 Add fixtures for the upstream types: a `mockChatInfo` with
  `cid` / `title` / `is_pinned` / `timestamp`, a `mockChatHistory`
  with a couple of `turns` (one `user`, one `model`, plus a turn that
  uses `parts[].text` to exercise the fallback in
  `toDomainMessages`), a `mockAvailableModel` with `display_name` and
  one without (to exercise the `display_name || model_name ||
  model_id` fallback).
- [x] 4.3 Cover the happy path: `listChats` filters by `search`,
  respects `limit` / `offset`, sorts by `timestamp` desc, attaches
  `profile` when `forProfile` was used; `fetchChat` flattens
  `parts[].text` correctly; `sendMessage` returns `output.text`;
  `startNewChat` returns `output.text` and the `ChatSession.cid`;
  `deleteChat` calls `client.deleteChat(cid)`; `listModels` returns
  display names with the fallback chain.
- [x] 4.4 Cover the error translations: instantiate
  `new AuthError(…)`, `new TimeoutError(…)`,
  `new UsageLimitExceeded(…)`, `new TemporarilyBlocked(…)`,
  `new ModelInvalid(…)`, `new APIError(…)`, plus a plain
  `Error("boom")` and assert each one is translated to the
  expected `GemitermError` subclass with the expected message.
- [x] 4.5 Cover `forProfile`: assert a brand-new `GeminiClient` is
  constructed (counter on the mock constructor) and the new
  instance's `listChats` is scoped to the profile's cookies
  (assert the constructor received the loaded cookies for the named
  profile).
- [x] 4.6 Cover `init()` idempotency: call `init()` twice on the
  same wrapper and assert the underlying `GeminiClient.init` was
  called exactly once.
- [x] 4.7 Cover the empty-cookies factory case: construct with
  `secure1psid: ""` and call `init()` — assert it resolves without
  throwing and `isAuthenticated()` returns `true` after init.

## 5. Validation

- [x] 5.1 Run `bun run test` and confirm the existing 432 tests all
  pass (no regression) plus the new `gemini-client-wrapper.test.ts`
  cases (target: ~25 new cases; total ≥ 432 + 25).
- [x] 5.2 Run `bun run typecheck` (`tsc --noEmit`) and confirm zero
  errors.
- [x] 5.3 Run `bun run lint:mediation` and confirm the
  path-mediation lint is still clean (the wrapper does not import
  `node:fs` / `node:path` / `node:os`).
- [x] 5.4 Manual smoke: run `bun run src/cli/index.ts list --help` (or
  another command that exercises the wrapper constructor) and
  confirm it starts without crashing — no real network call needed,
  this just exercises the `new GeminiClientService(…)` + `init()`
  path with empty cookies.
- [x] 5.5 (Optional, only if a Google account is available locally)
  Run `bun run src/cli/index.ts auth --profile smoke` and then
  `bun run src/cli/index.ts list --profile smoke` against a real
  account, confirm the `gemini-reverse`-backed `listChats` returns
  real chats. Not a CI gate — the unit tests in section 4 are the
  CI gate.

## 6. Commit & document

- [x] 6.1 Stage only the intended files: `package.json`,
  `bun.lockb` (or `bun.lock`), `src/services/gemini-client-wrapper.ts`,
  `src/cli/index.ts` (if task 3.1 added an `await init()`), and the
  new `tests/services/gemini-client-wrapper.test.ts`. Confirm with
  `git status` and `git diff --staged` before committing.
- [x] 6.2 Commit with a conventional-commit message, e.g.
  `feat(gemini): replace placeholder HTTP client with gemini-reverse`.
  Reference this OpenSpec change in the body:
  `Replaces src/services/gemini-client-wrapper.ts placeholder fetch()
  client with the gemini-reverse npm library. Preserves the public
  IGeminiClientService / IGeminiClientQueryService contract and all
  11 CLI commands. See openspec/changes/replace-gemini-api-placeholder-with-gemini-reverse/`.
- [x] 6.3 Do **not** push (per `AGENTS.md`).
