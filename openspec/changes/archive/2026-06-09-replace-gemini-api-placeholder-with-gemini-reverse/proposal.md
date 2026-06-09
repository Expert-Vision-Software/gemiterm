## Why

`src/services/gemini-client-wrapper.ts` is a hand-rolled placeholder that talks
to `gemini.google.com` over `fetch()` with hard-coded URL paths
(`/app/api/chat/history`, `/app/api/chat/<id>/send`, `/app/api/models`, …) and
URL-encoded form bodies. Those endpoints and shapes are educated guesses — the
real Gemini web app uses a different RPC and streaming protocol, so today the
CLI is structurally a stub against a real (changing) Google surface. We need
to swap the in-tree HTTP client for the community-maintained
[`gemini-reverse`](https://www.npmjs.com/package/gemini-reverse) library
(rynn-k/Gemini-Reverse), which already implements the live Gemini web protocol
(including cookie auto-refresh, streaming, model discovery, and per-account
sessions). This is a prerequisite for actually shipping v2.0.0 against the
real Gemini web app.

## What Changes

- **Add `gemini-reverse` as a runtime dependency** in `package.json` and
  document the minimum supported version pinned in `tasks.md`.
- **Replace the body of `src/services/gemini-client-wrapper.ts`** so that
  `GeminiClientService` composes a `GeminiClient` from `gemini-reverse`
  instead of issuing `fetch()` calls. The public class signature and the two
  interfaces it implements (`IGeminiClientService` in
  `src/core/command-handlers.ts`, `IGeminiClientQueryService` in
  `src/core/query-handlers.ts`) **do not change** — all call sites in
  `src/cli/index.ts`, `src/services/profile-auth-manager.ts`, and the command
  / query handlers keep working without edits.
- **Map `gemini-reverse` types into our domain types** in
  `src/services/gemini-client-wrapper.ts`:
  - `ChatInfo` (ours) ← `ChatInfo` from `gemini-reverse` (`cid` → `id`,
    `is_pinned` → `isPinned`, `timestamp` preserved, optional `profile` added
    for the multi-profile case).
  - `Message[]` (ours) ← `ChatHistory.turns` from `readChat(cid, limit)` (role
    `"user"` vs `"model"`, content flattened from `text` / `parts[].text`,
    `conversationId` injected).
  - `string[]` of model display names (ours) ←
    `AvailableModel[]` from `listModels()` (use `display_name` with `model_id`
    as fallback).
- **Map `gemini-reverse` errors into our error hierarchy** in
  `src/core/errors.ts` (re-export shim or constructor translation in the
  wrapper):
  - `AuthError` → `AuthenticationError` (with the same "run `gemiterm login`"
    message).
  - `UsageLimitExceeded` / `TemporarilyBlocked` / `ModelInvalid` →
    `GeminiAPIError` with a domain-specific message prefix.
  - `TimeoutError` → `GeminiAPIError` ("Request to Gemini timed out").
  - `APIError` / other `GeminiError` subclasses → `GeminiAPIError` with the
    original `message` and `cause` set to the underlying error.
- **Preserve multi-profile behavior**: `forProfile(name)` still returns a new
  `GeminiClientService` instance bound to that profile's cookies loaded from
  `CookieStorageService`. The underlying `GeminiClient` is constructed
  per-profile, so the upstream cookie auto-refresh watchdog is scoped to that
  profile's session.
- **Preserve initialization sequencing**: the wrapper's `init()` is called
  once after the `GeminiClient` is constructed and before any I/O. `init()`
  configures `timeout`, `autoRefresh: true`, `refreshInterval: 540000` (9
  minutes, matching upstream defaults), and `autoClose: false` so the process
  stays warm during a CLI session.
- **Add a unit test file `tests/services/gemini-client-wrapper.test.ts`** that
  mocks the `gemini-reverse` `GeminiClient` class via a module mock and
  verifies the mapping/translation for `listChats`, `fetchChat`, `sendMessage`,
  `startNewChat`, `deleteChat`, `listModels`, `forProfile`, and the
  `AuthError → AuthenticationError` translation. Reuse the existing
  test-factory style from `tests/services/cookie-storage-service.test.ts`.

No public CLI surface, command output, config file format, or persisted cookie
file format changes. The v1.4.1 → v2.0.0 upgrade path stays intact.

## Capabilities

### New Capabilities

None. This change is a drop-in implementation swap; no new user-visible
capability is introduced. If we ever need to expose `gemini-reverse` features
the wrapper doesn't currently surface (Gems, file uploads, deep research,
streaming `--json`), those would be a separate change with their own
`specs/<name>/spec.md`.

### Modified Capabilities

None. The requirements in `openspec/specs/conversations/spec.md`,
`openspec/specs/multi-profile-conversations/spec.md`, `openspec/specs/commands/`
(every command that talks to Gemini), and `openspec/specs/auth/spec.md` are
unaffected — the `IGeminiClientService` / `IGeminiClientQueryService` contract
and observable behavior of every command are preserved. This is an
implementation-detail refactor only.

## Impact

- **Dependencies**: adds `gemini-reverse` to `dependencies` in
  `package.json`. Confirms Bun runtime can resolve and load the package (it's
  pure Node.js, no native bindings).
- **Source files**:
  - **Modified**: `src/services/gemini-client-wrapper.ts` (full rewrite of
    internal implementation; public class signature unchanged).
  - **Modified**: `src/core/errors.ts` — add `translateGeminiError(e: unknown):
    GemitermError` helper (or extend the wrapper to perform the mapping
    inline; decided in `design.md`).
  - **New**: `tests/services/gemini-client-wrapper.test.ts`.
- **Call sites (no edits expected, verified during implementation)**:
  - `src/cli/index.ts` (3× `IGeminiClientService` / `IGeminiClientQueryService`
    consumers and the factory `new GeminiClientService({ secure1psid: "" }, …)`).
  - `src/services/profile-auth-manager.ts` (consumes `IGeminiClientService`).
  - `src/core/command-handlers.ts`, `src/core/query-handlers.ts` (consume the
    interfaces, not the class).
- **Sensitive-area check**: `AGENTS.md` flags four files as regression-gate
  files for auth flow; this change touches `src/services/gemini-client-wrapper.ts`
  only, which is **not** one of those four. The four flagged files
  (`playwright-cli-driver.ts`, `cookie-monitor.ts`, `auth-service.ts`,
  `cookie-storage-service.ts`) are not modified by this change. The wrapper
  consumes `CookieStorageService` via its existing constructor parameter, so
  the auth pipeline keeps working.
- **Tests**: target stays at the 432/432 baseline. The new test file is
  expected to add coverage (post-implementation count > 432).
- **Build**: `bun run build` (which currently fails for unrelated reasons
  captured in the `cross-platform-build-and-ci` change) is unaffected by
  this change.
- **No new environment variables.** `gemini-reverse` honors
  `GEMINI_COOKIE_PATH`; we do not set it, so the library uses its default
  temp directory.
- **No config-file or cookie-file format change.** v1.4.1 users upgrading
  to v2.0.0 will not need to re-authenticate.
