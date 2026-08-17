## Why

After ~1h15m idle (the documented phantom-onset floor), the first `gemiterm list` on a stale jar arms the superseded cookies, prints `No conversations found.`, and returns — while the detached refresh-runner it spawned rotates PSIDTS a few seconds later. The user must re-run `list` manually to see their conversations. The empty-result path races the very rotation the facade just triggered instead of awaiting it.

## What Changes

- `CookieSession.ensureSession` records the armed PSIDTS baseline and whether the jar was armed stale (mtime past the 30-minute spawn threshold) per profile.
- `CookieSession` gains two additive members:
  - `waitForRotation(profile, opts?)` — resolves `null` immediately when the last arm was fresh (nothing rotating); otherwise polls the on-disk jar until the routable `__Secure-1PSIDTS` value changes from the recorded baseline (bounded by a 30 s default timeout), then re-arms and resolves the fresh `ArmedSession`. Never spawns anything; never throws.
  - `rotationInFlight(profile)` — whether the last arm was stale and no rotation has been observed yet.
- `ListCommand`'s empty-result path (`resolvePhantomEmptyResult`) now, before any classification: when a rotation is in flight, prints a stderr notice, awaits it, and retries the list query once on success. When the wait times out with the rotation still in flight, prints the requested stderr hint ("a refresh is still running — wait and re-run"). The existing probe/confirm/non-interactive flow is unchanged and remains the fallback.
- The common path is untouched: fresh jars arm with zero added latency (fix-1 design D2 arm-first policy preserved); the wait only engages after a listing already came back empty.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `auth`: new requirement — the facade MUST expose `waitForRotation(profile)`/`rotationInFlight(profile)` with bounded, spawn-free, non-throwing semantics anchored to the last arm's staleness and PSIDTS baseline.
- `commands`: the `ListCommand reactive phantom detection` requirement gains a preceding rotation-await stage — on an empty single-profile result with a rotation in flight, the command MUST await the rotation (bounded) and retry the list query once before classifying; stdout bytes remain unchanged (all new output on stderr).

## Impact

- `src/auth/cookie-session.ts` — additive facade members + arm-time bookkeeping (auth-sensitive path: gated by `tests/auth-regression/` + `docs/auth-cookie-lifecycle.md` changelog obligations).
- `src/cli/commands/list-command.ts` — additive wait-then-retry branch in the empty-result path (stderr-only output; byte-equivalence contract preserved).
- Tests: `tests/integration/commands/list.test.ts` (wait/retry + unchanged fallback), new `tests/auth-regression/invariant-await-rotation.test.ts` (gate coverage).
- Docs: `docs/auth-cookie-lifecycle.md` changelog entry.
- No capture/persistence policy change, no cookie-name filtering, no probe changes, no change to `ensureSession`'s arm-first semantics.
