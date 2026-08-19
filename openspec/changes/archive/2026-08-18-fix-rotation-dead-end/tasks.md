# Tasks — fix-rotation-dead-end

## 1. Single-flight spawn (auth)

- [x] 1.1 Add `getRefreshRunnerLockPath` to `src/infrastructure/path-utils.ts`
- [x] 1.2 New `src/auth/refresh-runner-lock.ts`: `tryAcquireRunnerLock` (atomic create, stale sweep at 120 s, retry-once) and `releaseRunnerLock`, io via injectable primitives — shipped as `makeRunnerLock()` returning `{ tryAcquire, release }`
- [x] 1.3 `spawnDetachedRefreshRunner`: acquire before spawn (skip when held; never reject; spawn anyway if the lock write throws; release on spawn-throw); `runRefresh` releases in a `finally` (injectable `releaseLock`); `CookieSessionDeps.spawnRefreshRunner` type widened to `void | Promise<void>`, fire-and-forget with `.catch(() => {})`
- [x] 1.4 `BrowserRefresher.rotatePsidts` optional trailing `session` param (default `refresh-<profile>`); `RecoveryRung` passes `recover-<profile>`

## 2. Recovery de-race + honest error (auth)

- [x] 2.1 `CookieSession.recover`: when `rotationInFlight`, await `waitForRotation` first; on landing return the re-armed session without opening a browser
- [x] 2.2 `RecoveryRung` `rotated: false` branch names the no-change-from-baseline condition and the server-side-signed-out diagnosis
- [x] 2.3 `DEFAULT_ROTATION_WAIT_MS` 30 s → 90 s (≥ rotate budget + open margin)

## 3. Tests

- [x] 3.1 `tests/auth-regression/invariant-rotation-single-flight.test.ts`: lock exclusivity/release, stale sweep, spawn gate skip on real fs, recovery awaits in-flight rotation (rung never called), recovery falls through on no-landing, recover-<profile> session name, wait ≥ 75 s, signed-out error message
- [x] 3.2 Update `tests/auth/refresh-runner.test.ts` (spawn now async; lock skip + release-on-spawn-throw with injected lock fns; `runRefresh` releaseLock assertions) and `tests/auth/recovery.test.ts` (exact-args pin updated to `("p", "on-disk-ts", undefined, "recover-p")`; rotated:false message regex)
- [x] 3.3 Wait-default regression covered by 3.1 (`rotationWaitMs` ≥ 75_000 assertion); existing `invariant-await-rotation.test.ts` green (its `rotationWaitMs` overrides unaffected). Suite finding: the side-write vs poll race exposed a real Windows flaw — `writeTextFileAtomic` rename EPERM while a reader holds the jar — fixed with a bounded rename retry in `src/infrastructure/io.ts` (design D6, changelog). `bun test tests/auth-regression tests/auth`: **134 pass / 0 fail** (was 131/3 before the fixes).

## 4. Docs + verification

- [x] 4.1 Append the changelog entry to `docs/auth-cookie-lifecycle.md` (done — 2026-08-18 fix-rotation-dead-end entry)
- [x] 4.2 Run `bun test tests/auth-regression`, `bun test tests/auth`, `bun test --isolate`, `bun run typecheck`, `bun run lint:mediation`, `bun run check:auth-gate` (Git Bash); record pass/fail counts here if they move

  Results: full suite **971 pass / 0 fail / 2 skip** (was 946 pass / 2 skip — +25 tests); `tests/auth` + `tests/auth-regression` 134 pass / 0 fail; typecheck clean; path-mediation lint OK; auth gate PASS (`tests/auth-regression/` updated in-change). `canary:auth` requires a clean worktree — run after the change is committed.

## 5. Field verification (manual, user-gated)

- [x] 5.1 On a stale-armed multi-profile setup, run overlapping `list` invocations ~2 s apart: exactly one runner per profile per window in `gemiterm.log`, no `open`/`state-save` exit-1 pairs, and the late invocation renders conversations after the wait

  Round 1 (2026-08-18 03:45Z, user-driven, post-fix working tree, 3 profiles): `gemiterm.log` shows exactly one runner start per profile per window — 03:45:26 `dhb-diegohb` (pid 30672) and 03:45:47 `dhb-worker` (pid 24340), each `rotated=true` in ~6 s, **zero** `open`/`state-save` exit-1 failures (contrast the pre-fix windows: 02:36 ×2 runner starts per profile with an `open` exit-1; 15:14 ×2 with a `state-save` exit-1). `dhb-zeek` correctly spawned nothing — its jar was < 30 min fresh from the 03:23 control rotation. End state probed live: both previously-phantom profiles now `listChats` 3 conversations each. Caveat: the strict same-profile ~2 s overlap (lock-skip path) wasn't observed in the log — the two post-fix starts are 21 s apart on different profiles; that path is covered by `tests/auth-regression/invariant-rotation-single-flight.test.ts` (spawn-gate skip on real fs).

