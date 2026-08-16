# Design: fix-1-cookie-session-core

## Context

The phantom-auth bug is server-side `__Secure-1PSIDTS` supersession during zero-rotation idle (proven 2026-08-15; see `docs/cookie-ablation-findings.md`). The empirical constraints that shape this design, all validated on the live target with raw-wire probes (zero gemiterm auth code involved):

1. `__Secure-1PSIDTS` is the only individually-required cookie; every other cookie (incl. `__Secure-1PSID`, `SID`) is individually droppable with full function.
2. Live init GET and `batchexecute` RPC traffic rotate only the SIDCC family - never PSIDTS.
3. HTTP `RotateCookies` returns 200 + `hfcr=600` + SIDCC rotation but withholds PSIDTS minting on this account (4/4 attempts, dead and live sessions).
4. A headless `playwright-cli open --persistent --profile=<dir>` page-load rotates PSIDTS (page JS) and resurrected a 9-hour-dead session end-to-end; `state-save` captures the full 41-cookie jar.

The reference architecture is `teng-lin/notebooklm-py` (`docs/auth-cookie-lifecycle.md`, ADR-0029/0030), adjusted: their L1 HTTP rotate is void for us (constraint 3), so our primary rotation engine is their L3 browser-backed mechanism, run headless (validated), and their master-token L4 is out of scope.

Existing code being replaced: `AuthService` (headed login + cookie extraction), `CookieMonitor` (name-filtered capture - the H6 trim bug lives here at `cookie-monitor.ts:110,151,157`), `CookieStorageService` (7-day freshness conflation), `ProfileAuthManager` (naive gate). `ProfileManager` (profile CRUD) and the raw `CookieStorage` file accessor's on-disk format are retained underneath the new `CookieStore`.

## Goals / Non-Goals

**Goals:**

- Kill the phantom bug: no idle window after which `gemiterm list` returns 0 chats or dead-init on a recoverable session.
- One auth surface: every consumer depends on `CookieSession` only; the implementation is replaceable via the deps-object.
- No cookie-name filtering anywhere in capture or persistence paths.
- Zero added latency on the common command path (arm from disk first).
- Cross-OS concurrency safety with no shell dependency.
- Existing profiles keep working without re-login (unless server-side dead).

**Non-Goals:**

- HTTP `RotateCookies` integration (void on this account; wire documented for a possible future L4).
- Master-token (L4), external refresh-command hook (L5), OS-scheduled refresh (L7).
- `rookiepy` browser-cookie import; CDP attach; multi-account routing.
- Widening the `GeminiClientService` SDK wire surface (2-cookie construction is ablation-sufficient).
- Response-layer phantom detection wiring and `status --verbose` (fix-2); REPL keepalive loop (fix-3).

## Decisions

### D1: Browser page-load is the rotation engine; HTTP rotate is omitted

Constraints 2-3 leave exactly one working PSIDTS rotation mechanism (constraint 4). The `BrowserRefresher` therefore drives `playwright-cli open` (headless, `--persistent --profile=<profileDir>`) against `https://gemini.google.com/app`, polls `cookie-list` until the `__Secure-1PSIDTS` value differs from the provided baseline (60 s timeout), then `state-save` + `close`. Alternatives considered: HTTP `RotateCookies` as primary (rejected - proven void); direct `playwright` library dependency (rejected - new dep + second browser codepath; the daemon model of `playwright-cli` already supports detached background refresh).

### D2: Arm-first policy with opportunistic detached refresh

`ensureSession` never blocks on the browser: it validates + arms from the on-disk jar immediately, then, when the jar's mtime exceeds 30 minutes, spawns a detached `refresh-runner` (Bun subprocess running the same headless refresh) whose results benefit the *next* command. Synchronous refresh is reserved for the recovery rung (D5) and explicit `refresh()`. Alternative considered: synchronous cold-start refresh when stale (rejected - adds 3-60 s latency to exactly the after-lunch case every time).

### D3: Snapshot/delta CAS store with an exclusive-create lock file; pure Bun fs

`CookieStore.load` snapshots `(name, domain, path) -> value`; `save` writes only this process's deltas and only where on-disk still matches the snapshot (prevents the stale-overwrite-fresh class, notebooklm #361). A sibling `storage_state.json.lock` is acquired via exclusive file creation (`wx` flag), 100 ms retry. CAS saves wait up to 10 s then proceed fail-open; full-jar writers (login capture, recovery) wait up to 90 s then throw typed `LockUnavailableError` fail-closed; locks staler than 120 s (mtime) are stealable. No shell commands, no `flock`, no PowerShell - identical on Windows/POSIX. Alternatives considered: last-writer-wins atomic writes (rejected - detached refresh + REPL + user commands now write the same file); OS-native locking (rejected - cross-OS divergence, the exact fragmentation the user ruled out in Q9).

### D4: Gate is not payload; domain filter, never name filter

Login capture polls until the gate (`__Secure-1PSID` AND `__Secure-1PSIDTS` present in `cookie-list`) is satisfied, then persists the *complete* `state-save` jar filtered only by domain: keep `.google.com`, `.youtube.com`, `accounts.google.com` (the domains present in the validated 41-cookie baseline). No cookie-name set exists in any capture or persistence path; the three historical filtering bugs are made structurally impossible rather than fixed again.

### D5: Recovery rung is refresh-and-retry-once

`recovery.ts` implements: given a classified degraded state, run the synchronous headless refresh, persist via CAS, retry the armed-session construction once, and throw `AuthenticationError` (existing typed error, preserving the headed re-login prompt contract) if the session is still unusable. Detection *wiring* at the CLI layer is fix-2; this change ships the rung itself so fix-2 is a thin caller. Retry count is exactly one - the ablation shows browser rotation either works on the first page-load or the session needs headed re-login.

### D6: Validation tiers are ablation-derived; classifier is network-honest

Tier-1 (raise): `__Secure-1PSIDTS` must be RFC-6265-routable to `gemini.google.com` (present, unexpired, domain/path scope delivers it - the notebooklm #2061 routability predicate, ported) and `__Secure-1PSID` present. Tier-2 (warn once per process): companion set absent - un-ablated surfaces (`StreamGenerate`, readChat) may still want companions, so the warn is a hedge, not a gate. The classifier probes the *real* auth surfaces (init GET token check + `listChats({limit:1})`); `models()` is a static table in the SDK and MUST NOT be used as a probe. Local `expires` values are treated as meaningless for validity (proven).

### D7: `refresh-runner.ts` is a standalone entry point

The detached refresh runs as its own Bun process (also the future cron/L7 surface), taking a profile name, executing D1's flow with D3 persistence, and exiting. It never prompts, never throws user-visible errors (logs only), and is idempotent.

## Risks / Trade-offs

- **Headless rotation could decay if Google tightens bot detection on headless Chromium** - canary: detached refresh stops producing PSIDTS changes; prepared escalation is the documented RotateCookies/L4 wire. The L3 proof ran headless on 2026-08-15, so this is a monitored risk, not a present failure.
- **Detached refresh writes concurrently with user commands** - mitigated by D3 CAS; the lock is fail-open for CAS so a hung lock cannot block commands.
- **Sensitive-area churn** (`playwright-cli-driver.ts`) - contained to additive methods; existing tests re-read per AGENTS.md before committing.
- **Test-count churn from deleted services** - net count recorded in tasks; the regression pins (below) are the non-negotiables.

## Migration Plan

Hard cutover on the `notebooklm-grilled-auth-fix` branch: land the module, rewire `cli/index.ts` + `command-registry.ts` context, delete the four legacy services in the same change (no dual-running period; the facade is the only auth path once merged). Existing profile directories are untouched; legacy 2/4-cookie jars self-upgrade through the detached refresh on first stale arm. Users with server-side-dead sessions get the existing headed re-login prompt via `AuthenticationError` (contract preserved).
