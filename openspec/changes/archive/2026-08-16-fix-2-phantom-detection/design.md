# Design: fix-2-phantom-detection

## Context

fix-1 landed (archived 2026-08-16): the `CookieSession` facade ships `probe(profile)` (the network-honest classifier: init-token check + `listChats({limit:1})` -> `live`/`phantom`/`dead`) and the refresh-and-retry recovery rung, with no command-layer consumer. Its detached rotation engine is now verified live (survives the CLI process tree, appends to `<configDir>/gemiterm.log`, rotates a stale jar in ~8 s; healthy foreground mint observed at 4.8 s) — but the 7.4 idle gate failed exactly as the phantom model predicts: `list` OK at 00:55Z, empty at 04:38Z after 3 h 43 m idle, because the first post-idle command arms the stale jar and answers before any rotation lands. The phantom state is undetectable locally (proven: byte-identical jars differ only in server-side PSIDTS supersession state), so detection must be reactive and network-based, and must never sit on the hot auth gate (the 2026-08-11 ledger design - a preemptive probe once killed sessions that would have worked). This change is the first-post-idle bridge fix-1's design D2/D5 deferred here.

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

After a user-accepted recovery that succeeds, the list query re-runs exactly once; if the retry still yields zero chats, the phantom diagnostic is printed and the command exits normally (the session may be an edge state recovery cannot fix - the user is told, not looped). Loop risk is structurally absent: classification + recovery fire at most once per command invocation. Recovery failures surface the typed `AuthenticationError` (fix-1 pinned re-arm failures into this contract, commit `e567ff0`), so the failure path lands in the existing headed re-login prompt. Observed edge worth naming: one detached rotation minted slower than the 60 s poll window (2026-08-16T07:41Z, cold start; next invocation self-healed) - a retry immediately after a slow mint can still see the empty result; D4's single-retry bound plus the honest diagnostic is the designed answer, and `<configDir>/gemiterm.log` distinguishes engine trouble from account emptiness when triaging.

## Risks / Trade-offs

- **Probe cost in the degraded path** - one init GET + one `listChats` probe (unbounded, so the observed count is real) only when a single-profile list already returned empty; network-identical to the `limit: 1` form because the SDK fetches the full list and slices client-side.
- **Phantom-during-retry race** - a session can decay between probe and retry; bounded by D4's single retry.
- **Status probe latency under `--verbose` with many profiles** - sequential and opt-in; documented in-flag.
- **Compiled-build detached spawn gap (excluded)** - `refresh-runner.ts` resolves from `import.meta.dir` and won't exist beside `dist/gemiterm`; the recovery rung in this change is synchronous and unaffected, but proactive refresh in compiled builds needs a multi-entry build - tracked as a build-surface follow-up, not this change.

## Migration Plan

Thin additive change on top of fix-1's facade (landed and archived 2026-08-16); no storage, format, or wiring migrations.
