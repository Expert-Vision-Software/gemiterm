## Why

`gemiterm list -p <name>` runs the auth/rotation flow against the **default profile**, then silently loads the requested profile's cookies for the actual `listChats` call. If the requested profile's `__Secure-1PSIDTS` is stale, `listChats` returns empty and the rotation warning points at the wrong profile. The user has no way to recover via `gemiterm auth -e` because the message names a profile that was never asked about. Same bug in `--all-profiles` mode: every non-default profile gets silent cookie load. The `gemiterm list` command is the only command in the codebase that has this defect; `fetch`, `export`, `delete`, `continue`, `new` all route through `commandClientService.forProfile(name)` (post-`profile-resolution-client-init`) and correctly auth the named profile. This change fixes the routing defect and documents the `--profile/-p <name>` flag that `list` already supports but the spec does not mention.

## What Changes

- **`ListChatsQueryHandler`** (`src/core/query-handlers.ts:77-134`) routes the requested profile through the auth factory instead of relying on a default-only pre-auth + silent `client.forProfile(profile)` cookie load.
  - Change the constructor to receive `getGeminiClient(profileName?: string): Promise<IGeminiClientService>` (the factory already accepts the arg; the handler is the broken link).
  - In `handle()`, when `profile` is set, call `getGeminiClient(profile)` then list via the resulting client.
  - When `allProfiles` is set, call `getGeminiClient(name)` per active profile (or — preferred — switch the handler to `clientService.forProfile(name)` per profile, matching `FetchChatQueryHandler`).
  - When neither is set, keep the current `getGeminiClient()` (no arg) contract: default profile, unchanged behavior.
- **`commands` spec** gains:
  - `--profile/-p <name>` listed as a supported `list` flag (currently missing from the spec; supported by the code at `src/cli/commands/list-command.ts:287-289`).
  - A scenario asserting that auth runs against the requested profile (regression gate).
  - A scenario asserting that `list --all-profiles` runs auth against each active profile.
- No changes to `FetchChatQueryHandler`, `GeminiClientService.forProfile`, `ProfileAuthManager`, or any other command. The fix is purely a `ListChatsQueryHandler` wiring change plus a factory signature update.
- No breaking changes. No public CLI surface change. The `--profile` flag was already accepted; this change makes it actually work.

### Out of scope (noted for follow-up)

`commandClientService.profileHasConversation(name, id)` (`src/cli/client-services.ts:41-43`) currently calls `getGeminiClient()` (no name) before invoking the concrete `profileHasConversation(name, id)`. This is the same defect in a different handler. It is currently masked because `ProfileAuthManager.findProfileForConversation` swallows thrown errors at `src/services/profile-auth-manager.ts:134`, and `findProfileForConversation` is the only call site for that wrapper. Fixing this is a one-line follow-up; deferred from this change to keep the PR surgical and the spec delta small.

## Capabilities

### New Capabilities

None. This is a bug fix; no new capability is being introduced.

### Modified Capabilities

- `commands`: the `list` command spec gains the `--profile/-p <name>` flag and a behavior requirement that auth runs against the requested profile (or each profile, in `--all-profiles` mode). One delta spec file.

## Impact

- **Source files touched:**
  - `src/core/query-handlers.ts` — `ListChatsQueryHandler` constructor signature and `handle()` body.
  - `src/cli/index.ts:119` — pass `(name?: string) => getGeminiClient(name)` instead of `() => getGeminiClient()`.
  - `openspec/changes/profile-aware-factory-wiring/specs/commands/spec.md` — delta spec.
- **Tests touched:**
  - `tests/core/query-handlers.test.ts` — new factory-arg spy assertions on `ListChatsQueryHandler`; updated mocks where the factory signature changes.
  - `tests/integration/commands/list.test.ts` — new integration test that exercises `list -p <name>` against a spy `getGeminiClient` and asserts the right profile is passed through.
  - No changes to `tests/cli/list-command.test.ts`, `tests/services/profile-auth-manager.test.ts`, `tests/cli/client-services.test.ts` (existing coverage passes unchanged).
- **Public CLI surface:** unchanged. `--profile` on `list` already worked as a flag; this change makes it functional.
- **Performance:** negligible. One extra `getGeminiClient` call per `list -p <name>` or per profile in `--all-profiles` mode; each call short-circuits on the singleton cache for repeated profiles.
- **Backward compatibility:** non-`--profile` and non-`--all-profiles` flows are byte-equivalent to the pre-change baseline. The in-flight v2.6.2 changes (`profile-has-conversation-lookup`, `profile-resolution-client-init`, `silent-refresh-stale-psidts-detection`) are orthogonal and complementary — `silent-refresh-stale-psidts-detection` is exactly the rotation that is currently *not running* for the requested profile.