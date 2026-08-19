# Design — fix-8-stale-profile-reachability

## Context

The rotation-await contract exists (facade `waitForRotation`/`rotationInFlight`, read-command retry in `runWithRotationRetry`, list's empty-result stage) but three live-only gates sit in front of it:

- `resolveProfile` (`src/cli/utils/profile-resolution.ts:11-17`) — explicit `-p` must be in `activeProfiles()` (live-only, `cookie-session.ts:260-270`).
- `list`'s await stage (`list-command.ts:93,133`) — fires only when the merged fan-out result is empty.
- `findProfileForConversation` (`cookie-session.ts:272-284`) — iterates `activeProfiles()` only.

`activeProfiles()` classifying live-only is *correct* for "which sessions are healthy"; the bug is that reachability (can we route to this profile at all) and health (is it live right now) were conflated. The fix does NOT widen `activeProfiles()` — that would change `status` semantics and every consumer — it makes the read paths do the arm → await → reclassify dance for profiles they are explicitly asked to use.

Dependencies: `fix-6-classifier-token-extraction` (the reclassify step is only honest with value-based token extraction — the DHBGAMING2 field session showed name-presence classification reading `live` on a validator-rejected jar). `fix-7-capture-gate-routability` is not mechanically required but removes the renew-bricking failure mode that made stale profiles unrecoverable in the field.

## Goals / Non-Goals

**Goals**
- `fetch`/`continue` with explicit `-p <stale profile>`: arm, await rotation (≤90 s), retry once, then recover (interactive) or fail typed (non-interactive).
- Aggregate `list`: stale profiles' in-flight rotations are awaited and re-queried even when live siblings produce chats.
- Conversations owned by stale-but-armed profiles resolve.
- Live/fresh profiles observe zero added latency and byte-identical stdout.

**Non-Goals**
- Widening `activeProfiles()` or changing `status` output.
- Automatic headed re-auth (`gemiterm auth`) from read commands — recovery stays the L3 browser rotation rung; headed re-auth remains the typed-error remediation.
- Changing `export`/`export-all`/`delete` routing (they share `resolveProfile`; they inherit the fix where it helps, but no new behavior is specced for them).

## Decisions

1. **Explicit-profile path: arm-and-await inside `resolveProfile`, recovery in the commands.** `resolveProfile(context, conversationId, explicitProfile)`: if the explicit profile is configured, arm it (`ensureSession`), and if `rotationInFlight`, `waitForRotation` + single reclassify. Still not live → commands surface the interactive recovery confirm (same TTY gate pattern as `list`'s: `NonInteractiveError` → typed stderr message + non-zero; cancel → decline). Rationale: keeps one routing seam; the commands own UX (TTY prompts already live at command layer via the prompts facade). Alternative considered — return a `{profile, state}` union and let each command implement the full ladder: rejected, duplicates the list-command ladder in three places.
2. **`listChatsForRequest` gains an outcomes form, `list` awaits empty-or-failed profiles.** New internal `listChatsOutcomes(getGeminiClient, listProfiles)` returning `{ profile, chats | error }[]`; the existing `listChatsForRequest` becomes a thin merge over it (signature and stdout unchanged). `list`'s await stage moves from `resolvePhantomEmptyResult` (merged-empty trigger) to: any outcome with 0 chats (or rejected) whose profile `rotationInFlight` → stderr notice → `waitForRotation` all → re-query just those profiles → merge. Rationale: per-profile outcomes are the minimal information the await needs; merged-empty was the wrong trigger (field: one live profile masked two stale). Alternative considered — always await all in-flight profiles before the first query: rejected, adds latency to the happy path and violates the reactive-only doctrine (arm-first D2: fresh jars add zero latency).
3. **`findProfileForConversation` two-pass.** Pass 1 unchanged (live profiles, list order). Pass 2: for profiles that armed stale this invocation and whose rotation landed (`waitForRotation` returned non-null), consult `profileHasConversation`. Rationale: bounded (only armed-stale profiles), passive (no spawns beyond what arming already did), preserves live-priority. Alternative considered — consult all configured profiles regardless: rejected, a full fan-out on every miss re-introduces the N-browser problem and slow failures for genuinely dead profiles.
4. **Recovery offer only on the explicit-profile path and list's existing prompt.** Aggregate `list` keeps its current recovery prompt (single profileName resolution, unchanged); fetch/continue gain the prompt only for explicit `-p` (the user named the profile — intent is unambiguous). Auto-discovery misses (`findProfileForConversation` → null) keep today's remediation message, now with the stale-aware second pass behind it.
5. **stdout byte-equivalence:** all new notices, hints, and prompts are stderr/TTY-only; `tests/integration/commands/list.test.ts` pins unchanged scenarios. Retry results replace merged content only when the retried profile yields chats (result changes are the fix, not a regression; new mixed-liveness scenarios document them).
6. **Gap 4 — cache revalidation keyed on the armed PSIDTS (default client).** `getGeminiClient()` (`src/cli/index.ts`) keeps its process cache but re-arms cheaply on every call (`ensureSession(defaultProfile)` — an in-process jar read, the same cost `forProfile` already pays per call) and reconstructs the `GeminiClientService` when the armed `secure_1psidts` differs from the value the cached instance was built with. Rationale: makes the retry (and every later default-path read in the process) rotation-safe with one localized change; aligns default-path semantics with `forProfile`'s construct-per-call behavior, which is exactly why `list` never had this bug. Alternatives considered — (a) thread the `ArmedSession` returned by `waitForRotation` into the operation closures: rejected, changes the operation seam and every caller (`fetch`, `continue`, `export`, `export-all` wrappers); (b) a `rearm()` method on `GeminiClientService`: rejected, the SDK client bakes cookies at construction (`gemini-client-wrapper.ts:96-99`), so rearm is reconstruction anyway plus a new API to keep honest. Cost: a reconstruction pays one SDK init GET after each rotation landing — unavoidable for any correct fix (the retry needs a freshly-armed client).

## Risks / Trade-offs

- [90 s wait ceiling on a stuck rotation delays explicit-profile fetch/continue failures] → same ceiling as every other await site (`fix-rotation-dead-end` raised it deliberately); the still-in-flight stderr hint names the profile.
- [Per-profile outcome map changes `gemini-queries` seam used by export-all] → `listChatsForRequest` keeps its exact signature/behavior (thin merge); outcomes form is additive.
- [Gap 4 reconstruction after rotation landing pays one extra SDK init GET] → bounded (once per rotation landing per process), and the retry without it fails anyway; `ensureSession` revalidation on unchanged jars is an in-memory-class jar read (same as `forProfile` per call).
- [Delta collisions with in-flight `commands` specs] → rebase before archive; archive order: `fix-5-audit-remediations`, `chat-list-bulk-actions`, then this (documented in proposal Impact).
- [Phantom profile rotation lands but session still not live (supersession beyond recovery)] → typed failure names the state and the `gemiterm auth` remediation; no silent default-profile fallback (the field bug).

## Migration Plan

Single PR after fix-6 (fix-7 recommended before but not blocking). No persisted-state migration. Rollback = revert; behavior returns to today's live-only gating.

## Open Questions

- Should `delete`/`export` with explicit `-p <stale>` also offer the interactive recovery ladder, or fail typed? (Default in tasks: inherit `resolveProfile`'s arm-and-await, no prompt — destructive command, keep it lean.) Confirm during review.
