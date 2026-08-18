# Design — fix-rotation-dead-end

## D1 · Cross-process single-flight via a lock file, not IPC

The only cross-process truth the facade already shares with the detached runner is the on-disk config dir (design D2 of `await-detached-rotation-on-empty-list`). The spawn guard therefore uses the same medium: `<profiles>/<name>/refresh-runner.lock`, created atomically (`writeFileExclusive`, the `CookieStore` lock primitive), payload = acquiring parent's pid (debuggability only).

Ownership protocol:

- **Parent** `spawnDetachedRefreshRunner`: `tryAcquire` → if held and fresh, skip the spawn entirely (another process's runner owns the rotation; `waitForRotation` observes the jar either way). If the write throws, spawn anyway — a locking failure must never block a refresh (same axiom as the log-fd degradation).
- **Child** `runRefresh`: `release` in a `finally`. The parent never releases: it may exit before the child starts, and a parent-side release would break the guard for the next parent.
- **Crash**: no release → stale after 120 s (`STALE_RUNNER_LOCK_MS`), then swept by the next acquirer (mtime check + remove + retry once, mirroring `CookieStore.acquireLock`). 120 s covers the worst legit runner lifetime (open ~7 s + 60 s rotate + close) with margin.

`spawnDetachedRefreshRunner` becomes async (the lock check awaits fs). The `CookieSessionDeps.spawnRefreshRunner` type widens to allow a promise; `ensureSession` still calls it fire-and-forget. The function itself never rejects.

## D2 · Recovery awaits before it rotates, and rotates under its own session name

`CookieSession.recover(profile)`:

1. If `rotationInFlight(profile)` → `await waitForRotation(profile)` (90 s default). Landing resolves the re-armed session and **opens no browser** — the detached runner already fixed it; recovery's job is done.
2. Only then delegate to `RecoveryRung.recover`, which calls `rotatePsidts(profile, baseline, 60_000, "recover-<profile>")`.

The session-name split is the actual collision fix: `closeSession` closes by name, so any caller that shares `refresh-<profile>` with a live runner can kill the runner's browser mid-poll (observed as `state-save`/`open` exit-1 pairs and phantom-persisting jars in `gemiterm.log`). `BrowserRefresher.rotatePsidts` gains an optional trailing `session` parameter defaulting to `refresh-<profile>` — the runner and keepalive paths are unchanged.

The persistent-profile dir stays shared by design (it is the logged-in identity); single-flight (D1) plus the await (D2.1) are what prevent two Chromium instances on it.

## D3 · Wait ceiling ≥ rotation ceiling

`DEFAULT_ROTATION_WAIT_MS` 30 s → 90 s. The await is passive (jar poll every `pollIntervalMs`); the ceiling only binds when rotation is genuinely in flight, and it must be able to cover the runner's full budget (60 s) plus browser-open margin. Unraced field rotations land in ~6–10 s, so the common case still returns after the first or second poll.

## D4 · Honest terminal error

Field result (this change's Phase 0 + the WSL repro): an unraced rotation that produces **no PSIDTS change within its own 60 s window** means the persistent-profile browser session is signed out server-side (the page loads, Google never issues a new PSIDTS). That is a re-auth condition, not a transient. `RecoveryRung`'s `rotated: false` branch now says so explicitly — "no change from baseline within <timeout>ms — the browser session appears signed out server-side" — distinct from the transport-failure branch that wraps the underlying error. No new error type; the `AuthenticationError` contract (headed re-login prompt) is preserved.

## D5 · Considered and rejected: most-specific-domain cookie reordering

Hypothesis: the duplicate `__Secure-1PSIDTS` at `.youtube.com` + `.google.com` in every jar mis-routes. Disproven by inspection: `findRoutableCookieValue` filters by RFC-6265 routability to `gemini.google.com` and the `.youtube.com` scope never matches; `buildCookieHeader` filters the same way. The `.youtube.com` rows are inert for Gemini routing. No change.

## D6 · Rename contention on Windows

The detached runner's `saveFullJar` (temp write + rename over the jar) races any concurrent jar reader (`waitForRotation` polls, another process's arm). On Windows, opens lack `FILE_SHARE_DELETE`, so the rename transiently fails EPERM while a reader holds the file — and a thrown rename lost a *completed* rotation (the browser rotated; the jar never recorded it). `writeTextFileAtomic` now retries the rename on EPERM/EACCES/ENOTEMPTY/EISDIR up to 20 × 25 ms (~500 ms worst case) before surfacing. This was observed deterministically in the auth-regression suite (side-write timer vs poll loop) and is contention hardening in the same class as D1/D2 — the suite failure reproduced it, which is why the fix is in this change rather than a separate one.

## D7 · Test seams

- Lock module (`refresh-runner-lock.ts`) takes injectable io primitives (exists/mtime/exclusive-write/remove) — hermetic unit tests; auth-regression tests drive the real `CookieStore`/fs under `GEMITERM_CONFIG_DIR` per the harness pattern.
- `spawnDetachedRefreshRunner`'s `DetachedSpawnDeps` gains optional lock fns so the existing spawn-capture tests stay hermetic; production wiring uses the real lock.
- Recovery-await behavior is asserted at the facade level with the real `CookieSession` + fakes for refresher/recovery, per `tests/auth-regression` conventions.
