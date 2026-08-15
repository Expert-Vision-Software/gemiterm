# Proposal: fix-3-session-keepalive

Sequence: fix-3 of 3. Depends on fix-1 `cookie-session-core` (reuses `BrowserRefresher` and the CAS store; consumes the `refresh-runner` standalone entry point). fix-2 `phantom-detection` is independent of this change.

## Why

fix-1's detached refresh fires only when a command runs (opportunistic). The interactive REPL is the one long-lived consumer in the codebase: while it is open, its session can idle past the PSIDTS supersede window between commands, so a user who chats, waits, and chats again can still hit the phantom state mid-session. notebooklm-py solves exactly this with a background keepalive task (`keepalive=N`) for long-lived clients; their issue #2161 documents that the absence of it permanently killed long-lived servers. The reference cadence is Google's self-reported rotation interval (`identity.hfcr` = 600 s).

## What Changes

- The interactive chat REPL starts a session-keepalive loop on entry and stops it on every exit path (normal exit, cancellation, error): every 10 minutes while the REPL is open, it runs the synchronous headless PSIDTS rotation for the active profile (no-op when PSIDTS is already current).
- The loop reuses fix-1's `BrowserRefresher` + `CookieStore` CAS persistence unchanged; no new browser mechanism.
- One-shot CLI commands are untouched (the detached opportunistic refresh from fix-1 remains their only background path).

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `auth`: adds the session-keepalive scheduling requirement (interval, no-op fast path, lifecycle ownership).
- `interactive-prompt-loop`: adds the REPL-owned keepalive lifecycle requirement (start on entry, stop on all exit paths, never leaks into one-shot commands).

## Impact

- **Code**: `src/cli/utils/interactive-prompt.ts` (loop lifecycle hooks), `src/auth/` (a small scheduler wrapper over the refresher, or reuse of `refresh-runner` in-process), `src/cli/utils/chat-session.ts` (wiring) - final placement decided at implementation per the existing `InteractiveLoopDeps` injection pattern.
- **Not changed**: one-shot commands, capture, storage format, validation, phantom-detection surfaces; REPL prompt behavior and slash-command contract.
- **Tests**: keepalive lifecycle (start/stop/no-leak), interval scheduling via injected clock/timers, no-op fast path; REPL tests via the existing `InteractiveLoopDeps` seam. Baseline: whatever fix-1/fix-2 record.
- **Dependencies**: none beyond fix-1. The future cron/L7 surface is already `refresh-runner` (fix-1) and is explicitly not built here.
