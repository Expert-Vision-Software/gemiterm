## Why

The rotation-await machinery (changes `await-detached-rotation-on-empty-list`, `extend-rotation-wait-to-read-commands`, `fix-rotation-dead-end`) is unreachable in exactly the situations it was built for. Three gaps, all field-reproduced 2026-08-18 on DHBGAMING2 (3 profiles, 2 stale):

1. **Explicit `-p <stale profile>` on `fetch`/`continue`**: `resolveProfile` (`src/cli/utils/profile-resolution.ts:11-17`) gates on `activeProfiles()`, which classifies each profile and admits only `live` ones. A stale/phantom profile is rejected with `AuthenticationError` *before* anything arms the session, spawns a detached runner, or awaits a rotation — the wait-for-refresh contract cannot engage (`fetch c_3a6ae1b615519a7f -p evs-diegohb` failed instantly at 05:55:48 while the profile's rotation was one arm away).
2. **Aggregate `list` with mixed liveness**: the fan-out arms every configured profile (stale ones spawn runners via `ensureSession`), but `resolvePhantomEmptyResult` (`src/cli/commands/list-command.ts:93`) only runs when the **merged** result is empty. One live profile returning chats masks N stale profiles whose rotations are in flight — their empties are dropped silently by `Promise.allSettled` (`src/cli/utils/gemini-queries.ts:34-42`) and the awaited pause never happens ("3 of 3 profiles active", yet two stayed phantom all day).
3. **Conversation routing skips stale owners**: `findProfileForConversation` (`src/auth/cookie-session.ts:272`) searches only `activeProfiles()` (live-only), so a conversation owned by a stale profile is unresolvable — the field `continue c_3a6ae1b615519a7f` (owned by stale `evs-diegohb`) silently fell through to the default profile via the `activeProfiles.length <= 1` short-circuit... which itself misfired because the gate's live-only membership shrank the candidate set.

4. **Retry after a landed rotation reuses a stale-armed cached client (default-profile path)**: the process-cached default `GeminiClientService` (`src/cli/index.ts:57-76`) is constructed once per process with whatever PSIDTS the jar held at the first `getGeminiClient()` call; the SDK client bakes cookies at construction (`src/services/gemini-client-wrapper.ts:96-99`) and `init()` caches. When `runWithRotationRetry` awaits a rotation and retries, the closure re-enters `getGeminiClient()` and gets the **cached** client still holding the superseded PSIDTS — the facade re-arms (`waitForRotation` logs `re-arming from the refreshed jar`) but the CLI's client cache does not, so the retry phantom-fails identically. Field repro (2026-08-18 12:37, dev machine): `fetch c_3c69396e3d6127a4` waited, rotation observed at 12:37:30, retry printed `No messages found.`; the identical command 10 s later (fresh process, fresh arm) rendered the full conversation. `list` is immune (its fan-out constructs a fresh service per profile per call via `forProfile`); `fetch`/`export`/`export-all`/`continue` without `-p` are affected. The existing retry requirement (`commands` spec, *Read commands await an in-flight detached rotation*) is satisfied to the letter but not the intent — the retry must execute on the refreshed credentials.

Root enabling cause for gap 3's misclassification (`live` verdicts on a jar the validator rejects) is fixed by `fix-6-classifier-token-extraction`; this change makes the read paths *reach* stale profiles instead of bouncing off live-only gates.

## What Changes

- **`resolveProfile` explicit-profile path**: an explicitly named profile is no longer required to be `live` up front. The path arms it (`ensureSession` — spawns a detached runner when the jar is stale), awaits an in-flight rotation (`waitForRotation`, bounded 90 s), reclassifies once, and proceeds when `live`; otherwise it falls through to failure handling (interactive: recovery offer mirroring `list`; non-interactive: typed error naming the profile state and remediation). The unknown-profile check (name not in configured profiles) still fails fast.
- **Aggregate `list` per-profile await + retry**: `listChatsForRequest` returns per-profile outcomes (profile → chats | error) for the fan-out form. When any profile yields an empty-or-failed outcome while its rotation is in flight, `list` awaits those profiles' rotations (stderr notice, stdout untouched), re-queries only those profiles, and merges. Live profiles add zero latency; stdout bytes for unchanged scenarios stay pinned (`tests/integration/commands/list.test.ts`).
- **`findProfileForConversation`**: after the live-pass misses, profiles that armed stale (rotation awaited) are consulted too, so conversations owned by stale-but-recoverable profiles resolve instead of returning `null`. Live profiles keep priority in list order.
- **Rotation-landing invalidates the cached default client**: `getGeminiClient()` revalidates its process cache against the current arm (cheap jar read via `ensureSession`) and reconstructs the service when the armed PSIDTS changed, so post-rotation retries (and any later default-path read in the same process) execute on refreshed credentials. Aligns the default path with `forProfile`'s construct-per-call semantics.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `auth`: `findProfileForConversation` requirement — stale-aware second pass (post-rotation consultation).
- `commands`: `FetchCommand`/`ContinueCommand` — explicit-profile routing no longer requires pre-existing `live` classification; wait-then-retry-then-recover/fail contract. Plus MODIFIED *Read commands await an in-flight detached rotation* requirement: the retry MUST execute on refreshed credentials (cached-client invalidation on PSIDTS change).
- `multi-profile-conversations`: conversation-ownership requirements touched by the stale-aware lookup.

## Impact

- Code: `src/cli/utils/profile-resolution.ts`, `src/cli/utils/gemini-queries.ts` (outcome map), `src/cli/commands/list-command.ts` (await stage moves before the merged-empty check), `src/cli/commands/fetch-command.ts` / `continue-command.ts` (recovery offer on explicit-profile stale), `src/cli/index.ts` (`getGeminiClient` cache revalidation — gap 4), `src/auth/cookie-session.ts` (`findProfileForConversation` second pass; `activeProfiles` itself unchanged).
- Tests: `tests/auth-regression/` (auth-sensitive paths), `tests/integration/commands/list.test.ts` (byte-equivalence preserved; new mixed-liveness scenarios stderr-only), fetch/continue routing tests.
- Docs: `docs/auth-cookie-lifecycle.md` changelog entry.
- **Delta-conflict note**: `fix-5-audit-remediations` and `chat-list-bulk-actions` (both in-flight) carry `commands` deltas. This change MUST be rebased on their final requirement text before archive; archive order: those two first, then this (elsewhere the `commands` deltas collide).
- Sequencing: third of three — depends on `fix-6-classifier-token-extraction` (honest reclassification) and benefits from `fix-7-capture-gate-routability` (renew no longer bricks jars); lands last.
