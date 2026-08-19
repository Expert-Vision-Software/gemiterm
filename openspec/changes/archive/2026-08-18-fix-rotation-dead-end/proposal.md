# fix-rotation-dead-end

## Why

Field repro (two machines, 2026-08-17/18): with 3 profiles, aggregate `list` arms every stale jar and each CLI invocation spawns its own detached refresh-runner per profile. `<configDir>/gemiterm.log` shows the resulting contention and its damage:

- **Duplicate runners per profile across processes.** At 02:36:39/43 and 15:14:47/54 two (and four) runner sets started for the same profiles seconds apart — each from a separate CLI invocation. Concurrent runners share the playwright session name `refresh-<profile>` and the same `--persistent` profile dir: the loser's `open`/`state-save` exits code 1 (both seen in the log), and the winner's `finally` `closeSession('refresh-<profile>')` closes the shared session out from under the other mid-flight.
- **Stepped-on rotations supersede the jar.** Both concurrent runners can observe "PSIDTS ≠ my baseline" and both report `rotated=true`; the jar can end up one rotation behind the live browser — instantly superseded server-side → phantom on the next probe.
- **Recovery kills the in-flight runner.** On the WSL repro (`list -p dhb-work`, 00:30–00:32 UTC), the 30 s `waitForRotation` gave up while the runner still held a 60 s budget; the user-confirmed recovery then called `rotatePsidts` with the same session name `refresh-<profile>` — colliding with the runner — and timed out after exactly 60 s "no change from baseline". The terminal error ("Could not refresh session") hid the real diagnosis.
- **Wait window is structurally shorter than the rotation window.** `waitForRotation` defaults to 30 s; the runner's own budget is 60 s plus browser-open time (~3–7 s observed). The await can give up before the rotation it is awaiting can possibly land.

An unraced control (2026-08-18 03:23 UTC, this repo, profile dhb-zeek) rotated in ~6 s and took the profile from phantom (listChats = 0) to live (3 chats) — the pipeline is sound; the failures are contention, plus honest-messaging gaps when the browser session is signed out server-side.

**Not a >2-profile limit:** all fan-outs iterate every profile (`listChatsForRequest`, `activeProfiles`, status). "2 of 3 work" was "the 3rd profile is the stale one". A considered-and-rejected hypothesis: duplicate `__Secure-1PSIDTS` across `.youtube.com`/`.google.com` scopes mis-routing — disproven; `findRoutableCookieValue`/`buildCookieHeader` already select the `.google.com` scope (see `SDK cookie selection prefers the gemini.google.com-routable scope`).

## What Changes

- **Single-flight detached rotation (cross-process):** a per-profile `refresh-runner.lock` (atomic create, pid payload, stale after 120 s) gates `spawnDetachedRefreshRunner` — a second process skips the spawn (the in-flight runner owns it; `waitForRotation` still watches the jar). The runner child releases the lock on exit; the parent never releases (crash → stale sweep).
- **Recovery de-race:** `CookieSession.recover` first awaits the in-flight rotation (bounded, passive). If the detached runner lands during the wait, recovery re-arms from the refreshed jar and opens no browser. When recovery does rotate, it uses the distinct playwright session name `recover-<profile>` — never `refresh-<profile>` — so it cannot collide with or close a live runner session.
- **Wait ≥ rotate budget:** `waitForRotation` default 30 s → 90 s (rotate budget 60 s + open margin). Passive poll unchanged; fresh rotations still return in ~1 poll.
- **Honest terminal error:** when a recovery rotation times out with no PSIDTS change, the thrown `AuthenticationError` distinguishes "no change from baseline within <timeout>ms — the browser session appears signed out server-side" from transport failures, and points at `gemiterm auth`.
- **Windows rename contention hardening:** `writeTextFileAtomic` (`src/infrastructure/io.ts`) retries the temp-to-target rename briefly on EPERM/EACCES — the detached runner persisting a rotated jar races concurrent jar pollers (Windows opens lack FILE_SHARE_DELETE), and a lost rename lost a completed rotation. Observed live in the auth-regression suite and by construction in the field on Windows.

## Capabilities

### Modified Capabilities

- `auth`: single-flight spawn requirement added to the detached-runner requirement; recovery rung awaits in-flight rotation first and uses a caller-scoped session name; `BrowserRefresher.rotatePsidts` gains an optional session parameter (default `refresh-<profile>` unchanged); `waitForRotation` default timeout raised to 90 s.

## Impact

- `src/auth/refresh-runner.ts` (lock acquire at spawn; release on exit), `src/auth/refresh-runner-lock.ts` (new), `src/auth/cookie-session.ts` (recover awaits; wait default), `src/auth/recovery.ts` (session name + honest error), `src/auth/browser-refresher.ts` (optional session param), `src/infrastructure/path-utils.ts` (lock path helper).
- Auth-sensitive paths (`src/auth/**`) → same-change `tests/auth-regression/` coverage (gate) + `docs/auth-cookie-lifecycle.md` changelog entry.
- `tests/auth/refresh-runner.test.ts` spawn tests become async (lock check precedes spawn); no stdout contract changes (`list` non-interactive output untouched).
- Depends on `await-detached-rotation-on-empty-list` (implemented, unarchived) for `waitForRotation`/`rotationInFlight`; this change modifies its default-timeout figure and cites its field-verification results.
