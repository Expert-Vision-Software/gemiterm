## Context

The GemiTerm Bun TypeScript CLI completed its Maestro migration in the recent `v2-install-migration` and `cross-platform-build-and-ci` changes. Three small but real spec-conformance gaps remain in the `continue`, `delete`, and `list` commands that were called out in the Maestro Phase 4 plan (`Phase-04-Commands.md:11, 31, 47`):

1. `continue-command.ts:50-69` and `:75-130` never call `ProfileAuthManager.findProfileForConversation`; the `SendMessageCommand` is sent to the default profile regardless of where the conversation actually lives. In a multi-profile setup (e.g. a user with a `work` and a `personal` profile) the message goes to the wrong account.
2. `delete-command.ts:51-77` has the same defect for `DeleteConversationCommand`.
3. `list-command.ts:129-136` calls `formatChatList(chats)` without the new Profile column that the spec requires when `--all-profiles` is set. Multi-profile users can list chats from every profile but cannot tell which profile owns which conversation in the text output.

Compounding problem #1: `ProfileAuthManager.findProfileForConversation` in `src/services/profile-auth-manager.ts:46-60` is itself broken. The method body iterates over all profiles, checks `profileManager.getStatus(name).isActive` for each, and returns the **first** active profile. The `conversationId` argument is never used. The method signature is correct (`findProfileForConversation(conversationId: string): string | null`) but the implementation is the first-active-wins fallback, which is a silent no-op for single-profile users and an outright wrong-profile return for multi-profile users. The 8 unit tests in `tests/services/profile-auth-manager.test.ts:88-223` currently encode the BUGGY behavior; updating them is part of the fix.

Constraints:
- **SENSITIVE AREA** (per the maintainer's note): `src/services/playwright-cli-driver.ts`, `src/services/cookie-monitor.ts`, and `src/services/auth-service.ts` are off-limits. This change touches only `profile-auth-manager.ts`, `gemini-client-wrapper.ts`, the three CLI command files, `core/types.ts`, `core/command-handlers.ts` (interface only), `infrastructure/formatters.ts`, and the test files. No cookie-capture or browser-lifecycle code is modified.
- **Baseline gate:** 432/432 tests must continue to pass; the change adds new tests on top.
- **No CLI-breaking changes**: the `profile` field added to `ChatInfo` is optional, and the Profile column only renders when the user passes `--all-profiles`. Existing serialized JSON output is byte-compatible.
- **Public method signatures MUST NOT change** for `findProfileForConversation(conversationId: string): string | null` — it is wired into the registry and the test fixtures assert this exact shape.

Stakeholders: multi-profile end users (the primary beneficiaries of the fix), single-profile users (whose behavior must not change), maintainers reviewing the test-file changes (need clear documentation that the 8 changed tests document a bug, not a regression), and the auth/playwright maintainers (who do not need to touch their code).

## Goals / Non-Goals

**Goals:**
- `findProfileForConversation(conversationId)` MUST actually inspect each profile's chat list to find the one that owns the conversation; it MUST return `null` when no profile owns it.
- `continue` and `delete` commands MUST look up the owning profile before sending the `SendMessageCommand` / `DeleteConversationCommand`, MUST route the request to that profile's GeminiClient, and MUST surface a clear `AuthenticationError` with remediation guidance when no profile owns the conversation.
- `list --all-profiles` MUST render a Profile column in the text table and a `profile` field on each `ChatInfo` in the JSON output; `list` without `--all-profiles` MUST behave exactly as today (4 columns, no `profile` field on chats).
- The 8 existing `profile-auth-manager.test.ts` tests MUST be updated to encode the new correct behavior. The test count for that file increases (8 → 11+) after the change.
- The 432/432 baseline test count MUST continue to pass; the new tests are added on top.

**Non-Goals:**
- Modifying `src/services/playwright-cli-driver.ts`, `src/services/cookie-monitor.ts`, or `src/services/auth-service.ts`. The cookie-capture and browser-lifecycle paths are not touched.
- Auto-migrating the per-profile conversation cache across logins. The cache is built fresh on every `findProfileForConversation` call (or per-session, if the simpler in-memory cache is chosen).
- Adding a new `--profile <name>` flag to `continue` or `delete` for explicit override. The error message in the help text mentions it as a possible follow-up, but it is not implemented in this change.
- Changing the public surface of `IGeminiClientService` in a breaking way. The new per-profile routing is additive: either the interface gains a `profileName` field on the existing payload, or a profile-scoped client constructor is added; either way, all existing callers keep working.
- Multi-profile interactive flows (a session that switches profiles mid-conversation). Out of scope; the change is for one-shot `continue` and `delete` invocations.

## Decisions

### D1. `findProfileForConversation` uses a per-profile chat-list lookup, not first-active-wins

The current implementation at `src/services/profile-auth-manager.ts:46-60` returns the first active profile in the loop, ignoring `conversationId`. The new implementation iterates over all profiles, calls a new `profileHasConversation(profileName, conversationId): Promise<boolean>` helper on `GeminiClientService` for each, and returns the first profile that returns `true`. If no profile returns `true`, the method returns `null` (the caller's cue to throw `AuthenticationError`).

This is the only correct semantic: a profile's `isActive` flag (cookies are fresh) tells you nothing about whether the conversation lives in that profile. The current code confuses "active" (has valid cookies) with "owns the conversation" (the conversation ID is in that profile's server-side chat list). These are independent properties.

**Why this approach over a fingerprint in the cookies themselves?** The conversation ID is generated server-side by Gemini; the local cookies do not contain it. There is no client-side signal that says "this conversation belongs to this account". The only authoritative answer is the server, and the only way to ask the server is to use that profile's cookies to call `listChats()` and look for the ID. The cookie-based cache path (D2) optimizes this for the common case.

**Alternative considered:** Read the profile's `storage_state.json` and look for the conversation ID in the cookies' metadata. Rejected: the conversation ID is server-side state, not stored in the cookies.

**Alternative considered:** Embed a profile-aware lookup in the GeminiClientService constructor and route every command through it. Rejected: a step too far for this change; see D3 for the routing decision.

### D2. Conversation→profile cache is built on first lookup, scoped to the call

The naive implementation of D1 calls `listChats()` once per profile, which is N network round-trips (where N is the number of active profiles). For a user with 3 active profiles, `continue` would issue 3 GETs to `gemini.google.com/app/api/chat/history` before sending the message. This is unacceptable latency on every `continue` and `delete` call.

Mitigation: an in-memory `Map<string, string>` (conversationId → profileName) is built once per `findProfileForConversation` call by iterating over all profiles, calling `listChats()` for each, and recording each conversation ID's owning profile. The cache is then queried in a single `Map.get` per profile. Total work: still N `listChats` calls, but the iteration is `O(N + C)` where `C` is the total number of chats across all profiles, and the per-iteration cost is a `Map.has` check rather than a full loop. The cache is also reusable: a subsequent `findProfileForConversation` call within the same CLI invocation can reuse the cache (a follow-up task; this change scopes the cache to a single call for simplicity and to avoid stale-cache bugs after a delete).

The cache is not persisted to disk. The Gemini conversation list is fetched fresh on every CLI invocation; the cache is purely a per-call optimization.

**Alternative considered:** Persist the cache to disk under `%APPDATA%\gemiterm\conversation-cache.json` and reuse it across invocations. Rejected: stale-cache risk. A user who deletes a conversation from `work` would have the cache report the conversation as still being in `work` on the next `gemiterm delete`. Refreshing the cache is the same cost as the fresh call; persistence is not worth the staleness surface.

**Alternative considered:** Build the cache on first `list-chats` query (which already iterates per profile in `--all-profiles` mode) and stash it in the mediator. Rejected: couples `list` and `continue`/`delete` lifecycle. The per-call cache is self-contained and easy to reason about.

### D3. Per-profile routing is exposed via an additive `profileName` field on the command payloads, not a profile-scoped GeminiClient constructor

The `IGeminiClientService` interface in `src/core/command-handlers.ts:90-94` exposes `deleteChat`, `sendMessage`, and `startNewChat` — none of which takes a profile. The `IGeminiClientQueryService` in `src/core/query-handlers.ts:56-60` exposes `listChats`, `fetchChat`, `listModels` — also none takes a profile. To route `continue` to a non-default profile, one of two shapes is needed:

(a) **Additive `profileName` field** on `SendMessageCommandPayload` and `DeleteConversationCommandPayload`. The `SendMessageCommandHandler` and `DeleteConversationCommandHandler` read `payload.profileName` and forward it to a per-profile-aware method on the service (or to a factory that builds a per-profile `GeminiClientService`).

(b) **Profile-scoped client constructor** on the command. The command builds a `GeminiClientService` with the resolved profile's cookies (`cookieStorageService.loadCookiesForProfile(profileName)`) and passes it explicitly to the mediator or to a new `IGeminiClientService.forProfile(name)` method.

The chosen approach is **(a) with a thin factory helper**: add `profileName?: string` to `SendMessageCommandPayload` and `DeleteConversationCommandPayload`; add a `forProfile(name: string)` method to `GeminiClientService` that returns a new instance configured with that profile's cookies (does not mutate `this`); the `SendMessageCommandHandler` and `DeleteConversationCommandHandler` resolve the profile name from the payload, build the per-profile client via `forProfile`, and call its `sendMessage` / `deleteChat`. The mediator continues to own the **default-profile** client for backwards compatibility, and the command payload carries the **explicit** profile for multi-profile routing.

Why (a) over (b):
- (a) keeps the mediator wiring unchanged for the default profile. The existing `SendMessageCommandHandler` is constructed with a single `IGeminiClientService` in `src/cli/index.ts` (or wherever the handlers are registered) and the existing flow keeps working.
- (a) localizes the per-profile routing inside the handler. The handler is the only place that needs to know "this is a multi-profile call", which is exactly where the knowledge belongs.
- (b) would require either passing a per-profile client into the command's `execute(args, context)` (a new `CliCommandContext` field — invasive) or building a per-profile client inside the command and calling the mediator with a custom command handler. Both are more wiring than (a).
- The `forProfile` factory method on `GeminiClientService` is a small, additive change to the class (it does not change the existing constructor signature).

**Alternative considered:** Construct the per-profile client inside the command and call the method directly (bypass the mediator for the actual API call). Rejected: breaks the mediator pattern that the rest of the CLI uses; the `IGeminiClientService` injection at the handler boundary is the right place to inject the per-profile instance.

**Alternative considered:** Make `IGeminiClientService` carry a `forProfile` method, and have the handler call it on its injected instance. The injected instance is the default-profile client; `forProfile` returns a new instance. This is the same as (a) — the payload's `profileName` field is the trigger. The "expose via interface" detail is implementation, not design.

### D4. `ChatInfo.profile` is optional; `formatChatList` only renders the column when the flag is set

The `ChatInfo` type at `src/core/types.ts:9-14` gains `profile?: string`. The `ListChatsQueryResult.chats` array is unchanged in shape (each chat may or may not have a `profile` field). The `ListChatsQueryHandler` propagates the profile name to each chat when `payload.allProfiles === true`; otherwise, the chats are returned without a `profile` field (matches today's behavior exactly).

`formatChatList(chats)` keeps its 4-column layout (ID / TITLE / DATE / PIN) when called with no second argument — every existing caller's output is byte-identical. A new optional second argument `options?: { includeProfileColumn?: boolean }` flips on a 5th `PROFILE` column (width 14 chars, matching the style of the other columns).

`list-command.ts:130` changes from `formatChatList(chats)` to `formatChatList(chats, { includeProfileColumn: options.allProfiles })`. The flag is plumbed through cleanly.

**Why the column is gated on `--all-profiles`:** In single-profile mode the Profile column would always show the same value for every row — a column of identical strings is noise. The column only earns its space in multi-profile mode where the rows differ.

**Why the JSON `profile` field is also gated:** JSON consumers (scripts, future web tools) that only deal with single-profile flows would see a `profile: "default"` field appear on every chat after this change, even though they don't need it. Gating on `allProfiles` keeps the JSON shape byte-compatible for the single-profile case.

**Alternative considered:** Always include the `profile` field on every chat in JSON output. Rejected: changes the JSON contract for single-profile users. Backward compat wins.

**Alternative considered:** Always include the `profile` field, default to the active profile name. Rejected: same reasoning — single-profile users don't need the field, and the field is undefined for any chat fetched without `--all-profiles`.

### D5. The 8 existing `profile-auth-manager.test.ts` tests are updated; the change IS the fix

The 8 unit tests in `tests/services/profile-auth-manager.test.ts:88-223` (in the `describe("findProfileForConversation")` block) currently assert:
- "returns first active profile" — the BUG.
- "returns null when no active profiles" — still correct under the new implementation.
- "returns null when no profiles exist" — still correct under the new implementation.

The first test encodes the bug. Updating it to assert "returns the profile whose chat list contains the conversation ID" is the fix, not a regression. The new test ("returns first active profile" → "returns the profile that owns the conversation") is part of the 3-4 new tests added in the same `describe` block, and the test count goes from 8 → 11+.

The PR body MUST explicitly call this out: "the 8 existing tests document the bug; updating them to encode the correct per-profile lookup is the fix." The task list (group 3) includes a "document the test change in the test file's leading comment" sub-task to make this discoverable to reviewers.

**Why we don't keep the old test as a separate `@deprecated` block:** it asserts wrong behavior. Leaving it in place would be a perpetual foot-gun for any future maintainer who runs `bun test` and sees a green light while the bug is present in production. The right move is to delete the wrong assertion and replace it with the correct one.

### D6. When no profile owns the conversation, the command throws `AuthenticationError` with a remediation message

If `findProfileForConversation(conversationId)` returns `null`, the command (`continue` or `delete`) throws `AuthenticationError` with this message:

> "Could not find a profile that owns conversation '<id>'. Run 'gemiterm list --all-profiles' to see which profile it belongs to, then 'gemiterm continue <id> <msg> --profile <name>' to specify the profile explicitly."

The error is thrown at the command layer (after the lookup, before the mediator send), so the user sees the message in the standard error-handling path that all CLI commands use (the `try/catch` in `continue-command.ts:112-116` and `delete-command.ts:77-81`). The exit code is non-zero (the existing error path sets `process.exitCode = 1` or `process.exit(1)`).

**Why not silently fall back to the default profile:** that hides the bug. A user with two profiles, a typo'd conversation ID, and a silent fallback to the default profile would conclude "I sent a message to a non-existent chat and the server accepted it" — worse than a hard error. The hard error tells the user exactly what went wrong and how to fix it.

**Why `AuthenticationError` specifically (not `ValidationError` or a new error class):** the conversation-ownership check is logically a "is this profile authenticated to act on this conversation" check; the existing `AuthenticationError` class in `src/core/errors.ts` is the right semantic. The error code stays the same so existing error-handling middleware doesn't need to change.

**Alternative considered:** Print a warning and fall back to the default profile. Rejected: see above — silently doing the wrong thing is worse than failing loud.

**Alternative considered:** Introduce a new `ConversationNotFoundError` class. Rejected: the message is the same shape as `AuthenticationError`, the user's remediation is the same, and adding a new error class for one call site is over-engineering. The follow-up could add `--profile <name>` to override, and the error class can be split later if needed.

### D7. No separate test file for `profileHasConversation`; coverage is via the integration tests for `continue` and `delete`

`GeminiClientService` (`src/services/gemini-client-wrapper.ts`) has no direct unit tests today; the existing coverage for its methods is the integration test suites for `list`, `fetch`, and the other commands that go through the mediator. Adding a unit test file `tests/services/gemini-client-wrapper.test.ts` is a separate change (the maintainer can add one when direct service-level unit tests are needed across the board). For this change, the new `profileHasConversation` helper is exercised by:

- `tests/integration/commands/continue.test.ts` (new tests in group 10 of `tasks.md`): 2 tests covering "resolves the profile that owns the conversation" and "errors when no profile owns the conversation".
- `tests/integration/commands/delete.test.ts` (new tests in group 10): 2 tests covering the analogous delete paths.
- `tests/services/profile-auth-manager.test.ts` (new tests in group 3): 3-4 tests that mock `GeminiClientService.profileHasConversation` to return `true`/`false` and assert the `findProfileForConversation` behavior.

The mock-based unit tests for `findProfileForConversation` are the primary gate for the helper's behavior, and the integration tests for `continue` and `delete` are the gate for the end-to-end flow.

**Why no separate test file for `profileHasConversation`:** the helper is one method on `GeminiClientService`; unit-testing it would require mocking the entire HTTP layer (the existing service uses `fetch` directly, not a `HttpClient` interface). The mock surface is larger than the code being tested, which is a smell. The integration coverage is the right gate for this change.

**Alternative considered:** Mock `fetch` in a `tests/services/gemini-client-wrapper.test.ts` test. Rejected: too much mock surface for a 1-line helper; the integration tests are sufficient and more representative of real usage.

## Risks / Trade-offs

- **Risk:** The cookie-based conversation→profile cache is built fresh on every `findProfileForConversation` call, which is N `listChats` calls. → **Mitigation:** the cache is built once per call, so the cost is bounded; subsequent calls within the same CLI invocation can short-circuit on a hit. For the typical `gemiterm continue <id> <msg>` invocation (one call, two profiles), the latency is 2 GETs + 1 POST. The optimization is to keep the cache in the `Mediator` instance for the lifetime of the CLI process (a follow-up; not in this change because it changes the mediator contract).

- **Risk:** The 8 existing `profile-auth-manager` tests changing behavior could be flagged as a "test regression" by code reviewers who skim the diff. → **Mitigation:** the test file's leading comment (added in group 3, sub-task 3.1 of `tasks.md`) explicitly states: "The 8 tests in `describe('findProfileForConversation')` previously asserted the BUGGY 'first active profile' behavior; they have been updated to assert the CORRECT per-profile-lookup behavior. See `openspec/changes/command-spec-conformance/proposal.md` for context." The PR body will also call this out.

- **Risk:** Adding `profile?: string` to `ChatInfo` is a type change that could ripple to consumers that do `exactOptionalPropertyTypes` checks. → **Mitigation:** the field is optional and unset when `allProfiles` is false; consumers that ignore unknown fields (the standard JSON behavior) keep working. The 432/432 baseline test count includes consumers that iterate `chats` and assert specific fields — those tests are the regression gate for the type change.

- **Risk:** Multi-profile users on WSL (where Chromium is WSL-local, per `src/services/install-browser-service.ts:124-141`) might see inconsistent results if one profile's cookies are for a host-Windows Chromium and another is for a WSL-Linux Chromium. → **Mitigation:** out of scope. The existing single-profile path already handles WSL cookie storage (the per-profile lookup is the same code path, just iterating N profiles instead of 1).

- **Risk:** The `SendMessageCommandPayload.profileName` and `DeleteConversationCommandPayload.profileName` fields are optional, but a future change could add a third command that needs the field and forget to thread it. → **Mitigation:** the spec (`specs/multi-profile-conversations/spec.md`) explicitly states the routing contract for the three commands in this change. The `IGeminiClientService` interface does not grow a profile parameter (D3), so future commands follow the same pattern by adding `profileName` to their payload and using `forProfile` on the injected client.

- **Risk:** The `formatChatList` signature change (adding an optional second arg) could be a TypeScript error in any consumer that calls `formatChatList(chats)` with a different second-arg shape. → **Mitigation:** the new parameter is a single object `{ includeProfileColumn?: boolean }`; TypeScript allows passing no argument or passing an object literal; existing calls (`formatChatList(chats)`) compile without change. The `bun test` baseline run is the regression gate.

- **Trade-off:** The per-profile cache is per-call, not per-session. → **Accepted:** a per-session cache requires the `Mediator` to know about the cache, which couples concerns. The per-call cost is bounded (N `listChats` calls per `findProfileForConversation` call, where N is the number of active profiles — usually 1 or 2). The follow-up to make the cache per-session is a small change to the mediator's constructor; it can be done in a separate change without breaking the API.

- **Trade-off:** The `forProfile` method on `GeminiClientService` creates a new instance per call. Each instance is a thin wrapper around the profile's cookies; the underlying `fetch` is created per request, not per instance. → **Accepted:** the alternative (caching a single `fetch` and swapping cookies per request) is more complex for no measurable gain; the per-call cost is one object allocation and one method call.

## Migration Plan

The change is **purely additive at the public surface** and **behavior-changing at the fix boundary**. Deploy steps:

1. Land the change behind a feature branch.
2. Run `bun test` and confirm the 432/432 baseline still passes; the new tests raise the count to 432+12 = 444+ (8 updated profile-auth-manager tests + 3-4 new = 11-12 in that file; 2+2 new continue/delete integration tests; 2 new list integration tests).
3. Land on `main` after CI passes. No data migration is required: the profile storage layout, cookie storage layout, and config dir layout are unchanged. The `ChatInfo` JSON output for single-profile users is byte-identical (the `profile` field is absent).
4. Update the user-facing `gemiterm --help` and the README to mention the new Profile column in `list --all-profiles` output (a one-line addition to the existing `--all-profiles` flag description in `list-command.ts:215`).

**Rollback strategy:**
- Revert the commit. The `profile?: string` field on `ChatInfo` is the only additive type change; reverting removes it, which is a non-breaking deletion for consumers that ignore unknown fields. The `findProfileForConversation` fix is the load-bearing piece; reverting restores the buggy behavior, but the 432 baseline is preserved (the existing tests that encoded the bug still pass).
- No data is at risk. The change does not modify any on-disk state.

**Deploy verification:**
- A multi-profile user (`gemiterm auth --profile work && gemiterm auth --profile personal`, then `gemiterm list --all-profiles`) sees a Profile column. The JSON output includes `profile: "work"` / `profile: "personal"` on each chat.
- A `gemiterm continue <id> <msg>` against a conversation owned by `work` actually sends to `work` (verified by reading the response and confirming it references the work account's data).
- A `gemiterm continue <unknown-id> <msg>` exits non-zero with the remediation message.
- A `gemiterm delete <id> --force` against a conversation owned by `work` deletes from `work`, not from `personal`.
- A single-profile user (the 99% case) sees no change in any output shape.

## Open Questions

- **Q1:** Should the per-profile conversation cache be lifted into the `Mediator` (or a shared `ConversationOwnershipCache` service) so that a `gemiterm list --all-profiles` call followed by a `gemiterm continue <id>` reuses the cache? **Decision:** not in this change. The follow-up is a small change to `Mediator`'s constructor and the `ListChatsQueryHandler`; the cache can be invalidated by writing to it (delete a conversation → remove from the map). Out of scope for a spec-conformance change; tracked in a follow-up.

- **Q2:** Should `findProfileForConversation` short-circuit on the active profile if `conversationId` is `undefined` (a degenerate case where the caller forgot to pass the argument)? **Decision:** no. The method signature requires a `string`; passing `undefined` is a TypeScript error. The current 8 tests already cover the cases the change needs.

- **Q3:** Should the `forProfile` factory on `GeminiClientService` be exposed on the `IGeminiClientService` interface, or kept as a concrete-class-only method (the handler downcasts to `GeminiClientService`)? **Decision:** expose on the interface. The interface is a contract; the concrete class is the implementation. Adding `forProfile(name: string): IGeminiClientService` to the interface keeps the handler type-safe and lets test mocks implement the method.

- **Q4:** Should the error message include the list of active profiles as a hint? E.g. "Could not find a profile that owns conversation '<id>'. Active profiles: ['work', 'personal']. Run 'gemiterm list --all-profiles'…" **Decision:** no, in this change. Listing the active profiles leaks information about the user's setup in a multi-user log scenario. The remediation message stays generic; the user can run `gemiterm list --all-profiles` to see the active profiles themselves.

- **Q5:** Should the Profile column in `formatChatList` show the default profile with a `*` marker (matching the profile table convention in `formatProfileTable` at `src/infrastructure/formatters.ts:92`)? **Decision:** not in this change. The Profile column in the chat list is for disambiguation, not for marking the default; mixing the two would confuse the column's purpose. A follow-up could add a separate "DEFAULT" column or a `*` suffix if the maintainer wants the marker.

- **Q6:** Should the integration tests for `continue` and `delete` mock the `ProfileAuthManager` and `GeminiClientService` separately, or use a single integration-level mock at the mediator boundary? **Decision:** the existing integration tests in `tests/integration/commands/continue.test.ts` and `delete.test.ts` (when they exist) mock at the mediator boundary (`spyOn(context.mediator, "send")`). The new profile-lookup tests follow the same pattern: mock the mediator to simulate a "profile found" or "profile not found" response, and assert the command's behavior. This keeps the test surface consistent with the existing 432-test baseline.

- **Q7:** Does the per-profile routing break the `--all-profiles` flag in `list`? Today `list --all-profiles` already routes through the mediator with `allProfiles: true` in the payload; the new behavior propagates the active profile name into each `ChatInfo.profile` field. The `formatChatList` call gets the flag and renders the column. **Decision:** no breakage; the change is purely additive at the rendering layer.

- **Q8:** Should the `profileHasConversation` helper be `async` (the current `listChats` is `async`)? **Decision:** yes. The helper is a thin wrapper around `listChats`, which awaits `fetch`. Marking the helper `async` keeps the call-site clean (`await geminiClient.profileHasConversation(name, id)`). The alternative (a sync helper that returns a `Promise<boolean>` from a non-`async` function) is just a wrapper around `Promise.resolve(...)` and adds no value.
