# Design: fix-3-session-keepalive

## Context

fix-1 ships the rotation engine (`BrowserRefresher.rotatePsidts`, headless persistent-profile page load) with CAS persistence, plus a standalone `refresh-runner` entry point; its opportunistic detached refresh only fires when a command arms a stale jar. The REPL (`src/cli/utils/interactive-prompt.ts`) is the codebase's single long-lived session consumer. notebooklm-py's `keepalive=N` (ADR-0030 L2) is the reference: a background loop poking rotation every N seconds while a long-lived client is open; their #2161 shows the failure mode of not having one. Google self-reports the rotation cadence as 600 s (`identity.hfcr`).

## Goals / Non-Goals

**Goals:**

- While the REPL is open, the active profile's PSIDTS never idles past the supersede window: rotation runs every 10 minutes.
- The loop is a no-op (no browser spawn) when PSIDTS is already current, so a busy chat session pays nothing extra.
- Clean lifecycle: stopped on every REPL exit path; one-shot commands are untouched.

**Non-Goals:**

- OS-scheduled refresh / cron packaging (L7) - `refresh-runner` is the future surface; building the scheduling here was explicitly skipped.
- Keepalive for one-shot commands (their detached opportunistic path from fix-1 is sufficient).
- A general daemon/background-service (`auth-daemon` lineage - evaluated and rejected in `docs/phantom-bug-synthesis.md`).
- Any change to rotation mechanics, storage, or validation (fix-1 owns those).

## Decisions

### D1: 10-minute interval, aligned to the 600 s self-reported cadence

The loop triggers rotation every 10 minutes (600 s), matching Google's advertised `identity.hfcr` value observed live on the target account (documented in `docs/cookie-ablation-findings.md`). A floor of 60 s between any two rotations is enforced in-process (mirroring notebooklm's throttle) so a manual `refresh()` invoked during a REPL session cannot double-fire inside the same window. Alternative considered: 15-20 min (notebooklm's L7 cron guidance) - rejected for the REPL case because the REPL exists precisely to keep one session continuously usable.

### D2: No-op fast path via PSIDTS-baseline comparison

Each tick compares the on-disk PSIDTS against the value the loop last observed (or last rotated to). If unchanged since the last successful rotation *and* the last rotation is younger than the interval, the tick skips the browser entirely; if the SDK's passive Set-Cookie merging rotated PSIDTS mid-session (possible on successful RPC traffic through the wrapper), the baseline is adopted without spawning a browser. The browser spawns only when rotation is genuinely due. This keeps the common REPL experience browser-free.

### D3: Lifecycle ownership at the REPL boundary via the existing DI seam

The REPL starts the keepalive loop on entry and stops it in a `finally` covering every exit path (normal exit, `CancellationError`, error propagation), injected through the existing `InteractiveLoopDeps` pattern so tests drive a fake scheduler. The loop holds no reference that outlives the REPL. Alternative considered: auto-starting keepalive inside `CookieSession.ensureSession` for any long-lived caller (rejected - the facade cannot know its caller's lifetime; explicit lifecycle at the one long-lived consumer is deterministic and testable).

### D4: Failures are silent-by-default diagnostics

A failed rotation tick (browser unavailable, timeout, `rotated: false`) logs at debug/warn and reschedules; it never surfaces a prompt or error into the active chat session. Recovery from a genuinely dead session remains fix-2's reactive path. Rationale: keepalive is freshness hygiene, not recovery - conflating them re-creates the ladder-corruption failures from the ledger (`9762845`).

## Risks / Trade-offs

- **Headless browser spawn every 10 min while idling in a REPL** - bounded by D2 (only when rotation is due, which is exactly the cadence Google asks for); acceptable for an interactive session, and the alternative is the phantom bug.
- **Timer leaks on abnormal exit** - mitigated by D3's `finally` + `.unref()`-style non-blocking handles (the codebase's existing monitor-timeout convention).
- **Overlap with fix-1's detached runner** - impossible to double-rotate harmfully: both funnel through the same CAS store, and D1's 60 s in-process floor plus the store's lock serialize them.

## Migration Plan

Additive on top of fix-1; no format or wiring migrations. Lands after fix-1 (hard dependency) and independently of fix-2.
