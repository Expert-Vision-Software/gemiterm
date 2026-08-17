# Tasks: fix-3-session-keepalive

Baseline: whatever fix-1/fix-2 record as their post-landing suite results (pre-fix-1: 862 pass / 2 skip / 0 fail / 1748 expects / 56 files). Run `bun run typecheck` after each group; conventional commits; never push.

## 1. Keepalive scheduler

- [x] 1.1 Implement the session-keepalive loop (interval 10 min; in-process 60 s rotation floor shared with manual `refresh()`): each tick compares the on-disk `__Secure-1PSIDTS` against the loop's last-observed baseline; unchanged-and-fresh -> no browser spawn (adopt-only); rotation due -> synchronous headless `BrowserRefresher.rotatePsidts` + CAS persist; failed tick logs at debug/warn and reschedules (never prompts, never throws into the session)
- [x] 1.2 RED-first tests via injected clock/timers and a fake refresher: no-op fast path (no refresher call when baseline is current); rotation path persists once per due tick; 60 s floor suppresses an immediate manual-follows-scheduled rotation; failed tick reschedules without surfacing an error

## 2. REPL lifecycle wiring

- [x] 2.1 Start the loop on REPL entry and stop it in a `finally` covering normal exit, cancellation (`CancellationError`), and error propagation; wire through the existing `InteractiveLoopDeps` injection seam (`src/cli/utils/interactive-prompt.ts` / `chat-session.ts` placement finalized at implementation); timer handles must not block process exit
- [x] 2.2 RED-first tests: loop started exactly once per REPL session; stopped on every exit path (no leaked timer - verified via fake scheduler call recording); one-shot command paths construct no keepalive
- [x] 2.3 Confirm the slash-command contract, prompt behavior, and cancellation propagation are unchanged (existing `interactive-prompt-loop` tests stay green)

## 3. Verification

- [x] 3.1 Full suite green; net test count recorded here; `bun run typecheck` clean; `bun run lint:mediation` clean
- [ ] 3.2 Live verification (user-assisted): open the REPL, idle > 30 min with no interaction, then chat - the session is still live (historically this window produced phantom mid-session); verbose logs show exactly the expected rotation cadence
