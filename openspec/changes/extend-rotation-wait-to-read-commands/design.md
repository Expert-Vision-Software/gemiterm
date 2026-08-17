# Design: extend-rotation-wait-to-read-commands

> **Status: blocked on predecessor field verification.** This design is
> intentionally incomplete where the predecessor's field results must decide.
> Do not implement until
> `openspec/changes/await-detached-rotation-on-empty-list` task 5.1 passes.

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
  owns them; tune there if field results demand it).
- Write-command coverage (`new`, `delete`) — send/delete surfaces were not
  ablated and fail differently; explicitly out until separately proposed.
- Cross-process spawn dedup (unchanged predecessor Non-Goal).

## Decisions

### D1: Predecessor field results are a hard gate

Implementation starts only after the predecessor's task 5.1 (idle ≥ 1h15m →
single `list` waits then renders; quick re-run flash-free in the common case)
passes on a real session. If 5.1 surfaces signal/bounds problems, fix the
facade in the predecessor's scope and re-verify before touching this change.

### D2: Per-command failing seam, decided by observed failure shapes

The wait triggers only after the command's read has already failed (thrown
typed auth error or resolved empty) AND `rotationInFlight(profile)` is true —
mirroring the predecessor's reactive-only placement. The exact predicate per
command (empty vs. typed-error vs. both) is finalized during implementation
from what 5.1 and the predecessor's probes actually observed; the default
assumption is "typed `AuthenticationError` or empty result", whichever the
command's existing error translation already surfaces.

### D3: One retry, then existing behavior

After a successful wait: retry the failed operation exactly once. Timeout or
still-failing retry: print the predecessor's stderr hint and fall through to
the command's existing failure handling unchanged. No new exit codes, no new
error types.

## Risks / Trade-offs

- [Send/delete surfaces behave differently than reads] → Out of scope (D2/Non-Goals); this change touches reads only.
- [Auth-gate content regex trips on command files importing the facade] → Expected; if (and only if) the implementation ends up touching `src/auth/**`, ship the same-change `tests/auth-regression/` coverage; otherwise state the gate opt-out reason in the commit. Prefer no facade edits at all.
- [Blind copy of `list`'s stage into commands with different failure semantics] → D2 forces the predicate to be justified per command against observed behavior before wiring.

## Migration Plan

Additive per-command branches; no persisted-state migration. Rollback = revert.

## Open Questions

- Does `fetchChat` on a phantom session throw or return empty on the real
  account? (Predecessor 5.1 field notes should answer; if not, probe once
  during implementation planning — read-only, no recovery.)
- Should `export-all` await per-profile or bail to the aggregate warning path
  on the first timeout? (Lean: per-conversation, matching its existing
  partial-failure tolerance.)
