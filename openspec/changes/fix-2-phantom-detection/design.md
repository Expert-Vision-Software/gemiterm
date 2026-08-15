# Design: fix-2-phantom-detection

## Context

fix-1 ships the `CookieSession` facade with `probe(profile)` (the network-honest classifier: init-token check + `listChats({limit:1})` -> `live`/`phantom`/`dead`) and the refresh-and-retry recovery rung, but no command-layer consumer. The phantom state is undetectable locally (proven: byte-identical jars differ only in server-side PSIDTS supersession state), so detection must be reactive and network-based, and must never sit on the hot auth gate (the 2026-08-11 ledger design - a preemptive probe once killed sessions that would have worked).

## Goals / Non-Goals

**Goals:**

- A phantom `list` result is never silently presented as "No conversations found." - it either self-heals (recovery + one retry) or names the problem.
- `status --verbose` shows server-side truth per profile; default `status` output is untouched (user decision: gate behind `--verbose`).
- Non-interactive stdout of `list` remains byte-identical (existing pinned contract).
- Detection fires only on the trigger condition (single-profile, zero-chats result) - no probes on healthy paths, no cost to the common case.

**Non-Goals:**

- Any change to fix-1's capture/store/refresh/validation surface.
- Multi-profile (`--all-profiles`) phantom classification (per-profile detection across aggregates is disproportionate; skipped per the 2026-08-11 design).
- Proactive/preemptive probing at the auth gate (explicitly rejected - destructive precedent in the ledger).
- REPL/keepalive wiring (fix-3).

## Decisions

### D1: Reactive detection at the query layer, triggered by emptiness

After a single-profile `listChats` resolves zero conversations, the command layer calls `probe(profile)`. `dead` and `live` both terminate immediately: `live` means the account genuinely has no chats (print the normal empty output); `dead`/`phantom` proceed to the recovery offer. This spends one probe only in the already-degraded case. Alternative considered: probe before every list (rejected - adds network latency to every healthy command and re-introduces the preemptive-gate anti-pattern).

### D2: Recovery offer is TTY-conditional; stdout bytes are sacred

On a TTY, `phantom`/`dead` triggers the existing confirm-prompt + recovery rung + retry the query exactly once (matching the repo's prompt-layer facade: `confirm` via `src/cli/utils/prompts.ts`, `CancellationError` respected - user declining leaves the empty result printed). Without a TTY, diagnostics go to stderr and the normal empty output still goes to stdout unchanged - the `tests/integration/commands/list.test.ts` byte-equivalence contract holds because stdout is never altered. Alternative considered: non-interactive auto-recovery (rejected - a headless browser spawn inside a piped command is surprising and can wedge CI).

### D3: `status --verbose` renders the probe; default output is frozen

The PROBE column (`live (N)` / `phantom` / `dead`) renders only with `--verbose`, probing each profile sequentially through the read-only classifier (no writes, no refresh - the classifier's read-only property is pinned in fix-1's spec). Without the flag, `status` behavior and output are exactly as today. Alternative considered: always-on probe (the earlier `b1d0df0` lineage chose this; the user explicitly re-scoped it to opt-in for this fork - probes hit the network on every status call).

### D4: One retry, then honest failure

After a user-accepted recovery that succeeds, the list query re-runs exactly once; if the retry still yields zero chats, the phantom diagnostic is printed and the command exits normally (the session may be an edge state recovery cannot fix - the user is told, not looped). Loop risk is structurally absent: classification + recovery fire at most once per command invocation.

## Risks / Trade-offs

- **Probe cost in the degraded path** - one init GET + one `listChats({limit:1})` only when a single-profile list already returned empty; acceptable.
- **Phantom-during-retry race** - a session can decay between probe and retry; bounded by D4's single retry.
- **Status probe latency under `--verbose` with many profiles** - sequential and opt-in; documented in-flag.

## Migration Plan

Thin additive change on top of fix-1's facade; no storage, format, or wiring migrations. Ships after fix-1 lands (its facade and classifier are prerequisites).
