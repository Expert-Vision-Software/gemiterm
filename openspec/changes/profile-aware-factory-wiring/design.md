## Context

The current `ListChatsQueryHandler` (`src/core/query-handlers.ts:77-134`) was wired before the in-flight `profile-resolution-client-init` change (`commit 2ce3bd6`) generalized the `forProfile` pattern. As a result, the `list` command is the only command in the codebase whose query handler does not route through `commandClientService.forProfile(name)` for the per-profile path. The `getGeminiClient` factory at `src/cli/index.ts:82-100` already accepts an optional `profileName` argument and calls `profileAuthManager.ensureAuthenticated(targetProfile)` — the wiring defect is purely on the consumer side: `src/cli/index.ts:119` registers the factory with no arg (`async () => getGeminiClient()`) and `src/core/query-handlers.ts:91-98` calls `this.getGeminiClient()` without forwarding `profile` from the payload.

The other handlers (`FetchChatQueryHandler`, `SendMessageCommandHandler`, `StartNewChatCommandHandler`, `DeleteConversationCommandHandler`) consume the `clientService` wrapper and call `clientService.forProfile(name)` which awaits `getGeminiClient(name)` internally. `ListChatsQueryHandler` does not follow that pattern — it calls the factory directly and then `client.forProfile(profile)` against the raw concrete `GeminiClientService`, which silently loads cookies without auth.

## Goals / Non-Goals

**Goals:**

- `gemiterm list -p <name>` MUST authenticate the named profile before listing; rotation warnings MUST name the requested profile, not the default.
- `gemiterm list --all-profiles` MUST authenticate each active profile individually; per-profile auth failures MUST be isolated via `Promise.allSettled` (already the case).
- `gemiterm list` (no `--profile`, no `--all-profiles`) MUST continue to authenticate the default profile; byte-equivalent output.
- The `commands` spec MUST document `--profile/-p <name>` as a supported `list` flag (currently undocumented but already accepted by the CLI parser).
- No public CLI surface change. No behavior change for `list` without `--profile`/`--all-profiles`.

**Non-Goals:**

- Fixing the latent companion bug in `commandClientService.profileHasConversation(name, id)` at `src/cli/client-services.ts:41-43`. That wrapper also calls `getGeminiClient()` with no arg; deferred to a follow-up because the only call site (`ProfileAuthManager.findProfileForConversation`) currently swallows thrown errors and the bug is not user-visible today.
- Promoting the `geminiClient` singleton to a `Map<profileName, GeminiClientService>` per-profile cache. The cache is "last-write-wins" today; switching profiles overwrites it. This is benign for the current sequential-command model and only becomes visible if `chat-list-bulk-actions` exercises interleaved operations across profiles. Out of scope; flagged for follow-up.
- Any change to `GeminiClientService.forProfile`, `ProfileAuthManager`, `AuthService`, or the auth storage layer. The bug is purely in the handler/factory wiring.
- Any change to the `--profile` flag's argv parsing in `src/cli/commands/list-command.ts:287-289`. The flag is already accepted; only the routing downstream is broken.

## Decisions

### Decision 1: Adopt the `clientService.forProfile(name)` pattern (matches `FetchChatQueryHandler`)

The fix shape:

1. Change `ListChatsQueryHandler`'s constructor to accept `clientService: IGeminiClientQueryService` (the same type `FetchChatQueryHandler` consumes) instead of `getGeminiClient: () => Promise<IGeminiClientService>`.
2. In `handle()`:
   - `profile` set → `await this.clientService.forProfile(profile).listChats(options)`.
   - `allProfiles` set → iterate active profiles, call `this.clientService.forProfile(name).listChats(options)` per profile via `Promise.allSettled` (preserve existing isolation behavior).
   - Neither set → `await this.clientService.listChats(options)`.
3. `src/cli/index.ts:119` registers with the wrapper: `new ListChatsQueryHandler(clientService, profileManager, logger)`.

**Rationale:** this is the pattern the in-flight `profile-resolution-client-init` change standardized for every other handler. Adopting it here eliminates the dual codepath entirely, makes the auth-routing guarantee structural (the wrapper *cannot* be misused), and reduces test surface (no factory signature to mock). The cost is one new constructor dependency on the handler, which `FetchChatQueryHandler` already has.

**Alternatives considered:**

- **(a) Keep the factory call site, fix it to pass `profile` through.** `constructor(getGeminiClient: (name?: string) => Promise<IGeminiClientService>)`, then in `handle()` call `this.getGeminiClient(profile ?? undefined)`. Smaller diff but leaves two valid factory signatures on the same handler, which future readers must reason about. Tests have to spy on the factory arg. Rejected as a "minimum-diff" alternative that still requires the test fixture update and adds a second valid usage shape.
- **(b) Keep pre-auth + replace `client.forProfile(profile)` with `clientService.forProfile(profile)`.** Hybrid: factory still pre-auths the default, then `forProfile` re-auths the requested profile. Rejected: redundant auth (every `list -p <name>` would auth the default first, then the requested profile, doubling `ensureAuthenticated` calls in the common case where the default and the requested profile are the same). Also leaks the default-profile auth as a side effect on every `--all-profiles` invocation.
- **(c) Inline the fix in the handler but keep the raw `GeminiClientService` type.** Equivalent to (a) but against the concrete class. Rejected: same dual-codepath concern as (a), and it bypasses the wrapper that exists specifically to encapsulate the auth-routing contract.

### Decision 2: Add `--profile/-p <name>` to the `commands` spec

The flag is already accepted by `src/cli/commands/list-command.ts:287-289` but undocumented in `openspec/specs/commands/spec.md`. This change adds it.

**Rationale:** the spec documents the as-built behavior of the command layer. The bug being fixed was that the flag *appeared* to work but didn't (rotation warnings pointed at the wrong profile). Documenting the flag with a scenario that locks the auth-routing guarantee prevents future regressions.

### Decision 3: Tests assert factory-arg flow at the handler level, not the CLI level

The integration test for `list -p <name>` (`tests/integration/commands/list.test.ts`) currently mocks `mediator.send` and bypasses the handler entirely. The new tests wire the real `ListChatsQueryHandler` against a spy `clientService` and assert that `clientService.forProfile` was called with the requested name.

**Rationale:** the bug-defining assertion is at the handler/factory seam. Integration-level tests are too coarse to lock it; unit-level tests at the seam are the right granularity. This matches the testing pattern `tests/core/query-handlers.test.ts` already uses for `FetchChatQueryHandler`.

## Risks / Trade-offs

- **[Risk] The `geminiClient` singleton cache is "last-write-wins" and overwrites on every `buildClient`.** Today, switching profiles via `getGeminiClient('A')` then `getGeminiClient('B')` overwrites the singleton. For the proposed fix (which routes through `clientService.forProfile`), the singleton is only mutated by the explicit `buildClient` path inside `getGeminiClient`. Since the `list` command runs once per process and `--all-profiles` iterates sequentially, this is benign. → **Mitigation:** the proposed fix doesn't change the factory, so the existing behavior is preserved. Document the cache invariant in the proposal follow-up note. If `chat-list-bulk-actions` exposes cross-profile bleed in the future, switch to a `Map<profileName, GeminiClientService>` then.

- **[Risk] `clientService.forProfile(name)` is `async` and awaits `getGeminiClient(name)`, so the auth is per-call, not per-handle-invocation.** Currently the handler's `getGeminiClient()` is called once and then reused. With the proposed fix, `--all-profiles` triggers one auth per profile, which is what we want but is a change in call count. → **Mitigation:** tests assert the call count; the in-flight `silent-refresh-stale-psidts-detection` change makes this auth/rotation cycle fast (L1 best-effort, no browser unless the probe is stale).

- **[Risk] The `commands` spec delta may reveal other spec gaps for `list`.** Specifically, the spec doesn't mention `--profile` (covered by this change), but it may also be missing `--interactive/-i` and `--search/-s` mention. → **Mitigation:** keep the delta narrowly scoped to `--profile` and the auth-routing guarantee. Note other gaps as follow-ups.

- **[Trade-off] No public CLI surface change.** The `--profile` flag is already accepted; we are only fixing the routing. Users who relied on the (broken) default-profile-auth behavior on `list -p <name>` will now see auth/rotation messages for the requested profile — but that behavior was a bug, not a documented feature.

- **[Trade-off] Slightly longer per-`list -p <name>` invocation.** One extra `getGeminiClient` call (cached after first call). Negligible for the CLI's interactive use case.

## Migration Plan

No data or config migration. No backward-incompatible CLI surface change. The change is internal-only: handler constructor signature, factory wiring, spec delta, tests. Deploy by merging the PR; no release notes beyond the existing CHANGELOG entry.

## Open Questions

None blocking. The follow-up items in the proposal's "Out of scope" section are deferred by deliberate scope choice, not by unresolved decision.