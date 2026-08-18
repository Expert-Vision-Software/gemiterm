# Design: extend-rotation-wait-to-read-commands

> **Status: unblocked 2026-08-18.** The predecessor's field gate (task 5.1,
> round 2) cleared, and `fix-rotation-dead-end` (archived) hardened the
> pipeline the wait observes: single-flight runner spawn, 90 s wait default,
> de-raced recovery. This design is still intentionally incomplete where
> per-command field observation must decide (D2); complete those sections
> during implementation planning.

## Context

The predecessor shipped the facade surface (`rotationInFlight`,
`waitForRotation` — bounded, passive, never-rejecting) and wired it into
`list`'s empty-result path. Read commands have the same stale-arm race but
different failure shapes: `fetchChat` can throw a typed `AuthenticationError`
*or* resolve empty; `continue`'s initial read and send fail through
`translateError`; `export`/`export-all` aggregate per-conversation failures
and already tolerate partial failure with warnings.

## Goals / Non-Goals

**Goals:**

- One wait, one retry, per already-failing read operation — never on the happy
  path.
- Surgical reuse of the predecessor's facade surface exactly as shipped; no
  new facade members.
- Each command's existing stdout/output contract unchanged (stderr-only
  notices).

**Non-Goals:**

- Re-litigating the wait bounds or the PSIDTS-change signal (predecessor
  owns them; tune there if field results demand it). Note: the bounds were
  already tuned once through exactly this path — 30 s -> 90 s in
  `fix-rotation-dead-end` — so any further tuning re-opens that change, not
  this one.
- Write-command coverage (`new`, `delete`) — send/delete surfaces were not
  ablated and fail differently; explicitly out until separately proposed.
- Cross-process spawn dedup — **shipped** by `fix-rotation-dead-end`
  (`refresh-runner.lock` single-flight); no longer a Non-Goal, just done.

## Decisions

### D1: Predecessor field results are a hard gate

~~Implementation starts only after the predecessor's task 5.1 passes on a real session.~~ **Gate cleared 2026-08-18** (task 5.1 round 2 + the `fix-rotation-dead-end` field validation: stale-armed multi-profile `list` runs spawned exactly one runner per profile, zero playwright collisions, and rendered conversations post-rotation). One D1 consequence already consumed: the signal/bounds question it reserved — the 30 s default was structurally shorter than the runner's 60 s budget — was fixed in the facade (90 s) by `fix-rotation-dead-end`, per this change's own rule that tuning happens there.

### D2: Per-command failing seam, decided by observed failure shapes

The wait triggers only after the command's read has already failed (thrown
typed auth error or resolved empty) AND `rotationInFlight(profile)` is true —
mirroring the predecessor's reactive-only placement. The exact predicate per
command (empty vs. typed-error vs. both) is finalized during implementation
from what 5.1 and the predecessor's probes actually observed; the default
assumption is "typed `AuthenticationError` or empty result", whichever the
command's existing error translation already surfaces.

**Finalized (implementation, 2026-08-18):** a single shared
`runWithRotationRetry` helper carries the predicate as a parameter; a thrown
error always enters the wait, and each command states whether an empty result
counts too. Per command, justified by its failure shape:

- `fetch` — **throw or empty**: an empty read is the phantom signal (the
  `listChats` shape field-verified in 5.1), so `messages.length === 0` enters
  the wait.
- `continue` initial read — **throw or empty**: same phantom signal.
- `export` / `export-all` — **throw-only**: an empty read is a valid
  (degenerate) outcome — an empty conversation still exports to a file — so
  only a thrown auth/network error is a failure.
- `continue` send — **throw-only**: a send surfaces auth failure as a typed
  `AuthenticationError`, never as an empty response.

The helper rethrows the original error when no rotation is in flight (or the
retry also throws) and returns the failed result on timeout, so each command's
existing error handling is untouched. This removes the need to disambiguate
`fetchChat`'s phantom shape on the live account — `fetch`/`continue`'s read
covers the empty case, and `export`/`export-all` don't need to.

### D3: One retry, then existing behavior

After a successful wait: retry the failed operation exactly once. On wait
timeout (the rotation remains in flight): print the predecessor's stderr hint
and fall through to the command's existing failure handling unchanged. A
landed-but-still-failing retry also falls through to the existing failure
handling, *without* the hint — the rotation has landed, so a "still in
progress" message would be false. No new exit codes, no new error types.

## Risks / Trade-offs

- [Send/delete surfaces behave differently than reads] → Out of scope (D2/Non-Goals); this change touches reads only.
- [Auth-gate content regex trips on command files importing the facade] → Expected; if (and only if) the implementation ends up touching `src/auth/**`, ship the same-change `tests/auth-regression/` coverage; otherwise state the gate opt-out reason in the commit. Prefer no facade edits at all.
- [Blind copy of `list`'s stage into commands with different failure semantics] → D2 forces the predicate to be justified per command against observed behavior before wiring.

## Migration Plan

Additive per-command branches; no persisted-state migration. Rollback = revert.

## Open Questions

- Does `fetchChat` on a phantom session throw or return empty on the real
  account? (2026-08-18 field probe: `listChats` on a phantom jar resolves an
  EMPTY array, no error — `fetchChat`'s shape on the same jar remains to
  probed once during implementation planning; read-only, no recovery.)
  **Resolved by implementation:** moot — `fetch`/`continue`'s read covers both
  shapes and `export`/`export-all` treat empty as a valid non-failure (D2), so
  no live probe was required.
- Should `export-all` await per-profile or bail to the aggregate warning path
  on the first timeout? (Lean: per-conversation, matching its existing
  partial-failure tolerance.)
  **Resolved:** per-conversation — the batch strategy's `fetchChat` closure is
  wrapped, so each conversation awaits/retries independently and a timeout
  degrades to that conversation's existing FAILED row, not a global bail.
