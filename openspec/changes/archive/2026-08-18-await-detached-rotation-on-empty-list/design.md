# Design: await-detached-rotation-on-empty-list

> **2026-08-18 supersession note:** D3's "Timeout default 30 s (< the runner's
> 60 s cap)" rationale below was invalidated by field results - the wait could
> give up before the rotation it was awaiting could possibly land. The default
> is now 90 s, and the detached spawn gained a cross-process single-flight
> lock; recovery was de-raced to await this wait before opening its own
> browser. All of that shipped in `fix-rotation-dead-end` (archived
> `2026-08-18-fix-rotation-dead-end`); the main specs carry the current form.

## Context

`CookieSession.ensureSession` (fix-1 design D2) arms the on-disk jar immediately and, when the jar mtime exceeds 30 minutes, spawns a detached refresh-runner fire-and-forget. When the jar's `__Secure-1PSIDTS` is server-side superseded (phantom state; observed onset floor ~1h15m idle), the first `list` after the idle window renders `No conversations found.` while the rotation lands seconds later — the command races and loses against the rotation it itself triggered. The existing rescue (`ListCommand.resolvePhantomEmptyResult`) probes + offers the synchronous recovery rung, which is the wrong tool while a rotation is already in flight (redundant browser work — the observed console-window flashes on quick re-runs) and, in the non-interactive path, advises `gemiterm auth` re-login even though the session self-heals momentarily.

Hard constraints from the repo's governing docs:

- Arm-first D2 stands: no added latency on the common path (fresh jar) — the wait may only engage after a listing already came back empty.
- The detached runner's rotation cadence is ~10-15 s (validated L3 flow); the runner's own cap is 60 s.
- Non-interactive `list` stdout is byte-equivalence-pinned (`tests/integration/commands/list.test.ts`).
- `src/auth/**` changes are gated: same-change `tests/auth-regression/` coverage + `docs/auth-cookie-lifecycle.md` changelog entry.

## Goals / Non-Goals

**Goals:**

- One command, one outcome: the first `list` after the idle window waits (bounded) for the in-flight rotation and renders the conversations.
- Zero behavior change on the fresh-jar common path and on genuinely-empty live accounts.
- All new user-facing output on stderr only.
- Additive facade surface only — no change to capture, persistence, CAS, probe, or arm-first semantics.

**Non-Goals:**

- Making `ensureSession` synchronous/blocking (rejected by fix-1 D2).
- Cross-process spawn dedup for the detached runner (double rotation is CAS-harmless; frequency drops because run 1 now completes post-rotation).
- Extending the wait to `fetch`/`export`/`continue` (separate follow-up proposal, gated on this change's field results).
- Suppressing the residual grandchild console flashes from the `bunx`→node chain (`windowsHide: true` already set on every gemiterm spawn).

## Decisions

### D1: Await reactively, only after an empty result

The wait lives in the empty-result path, not in `ensureSession`. `ListCommand` checks `rotationInFlight(profile)` and only then calls `waitForRotation(profile)`. The stage covers the aggregate default listing as well: without `--profile`, the fan-out arms every configured profile, so the stage awaits every profile whose rotation is in flight (parallel, each bounded) and retries the aggregate query once — classification stays single-profile-only (its confirm/recovery UX is per-profile). Field-verification round 1 (2026-08-17 15:14) caught the gap: the user's default `list` is aggregate (multi-profile), and the original single-profile-only placement never reached the wait. Alternative considered: blocking `ensureSession` until the rotation lands (rejected — violates D2; penalizes every command, not just the already-failing one).

### D2: Facade owns the state; PSIDTS value-change is the signal

`ensureSession` records per profile `{ psidts: <routable baseline>, stale: <mtime past threshold> }` at arm time. `waitForRotation` polls `cookieStore.load` (first check immediately — the listing itself takes seconds, so the rotation may already have landed; then every `pollIntervalMs`, default 2 s) until the routable `__Secure-1PSIDTS` differs from the baseline, resolving the re-armed `ArmedSession`. On change, the arm record flips to `stale: false` (rotation observed), so `rotationInFlight` turns false and later waits short-circuit. Timeout default 30 s (< the runner's 60 s cap; covers the validated 10-15 s rotation with margin) resolves `null`. Jar-read errors mid-poll are swallowed and polling continues until the deadline. Alternative considered: waiting on the runner process (rejected — the runner is detached and unobservable from the next command's process; the on-disk jar is the only shared truth, matching the CAS store's cross-process model).

### D3: Retry re-arms through the existing wiring

After a successful wait, the command re-runs `listChatsForRequest`, whose `forProfile → profileCookieLoader → ensureSession` chain loads the now-fresh jar from disk (fresh mtime ⇒ no duplicate spawn; per-process spawn set already holds the profile). No new client plumbing. If the retry is still empty, the flow falls through to the unchanged probe path (a genuinely empty account stays honestly empty).

### D4: Timeout degrades to a hint, then the existing flow

On timeout with the rotation still in flight, stderr gains the hint line ("a session refresh is still running in the background — wait and re-run"), then the existing probe/confirm/non-interactive behavior runs unchanged. The user-requested fallback message without re-architecting anything.

### D5: Test seams

`CookieSessionDeps` gains optional `rotationWaitMs` (default 30 000) alongside the existing injectable `pollIntervalMs`. The auth-regression invariant drives the real `CookieSession` + real `CookieStore` against a temp config dir, with a fake `spawnRefreshRunner` and a side-writing `getJarMtime`/store simulating the detached runner's landing — on-disk assertions only.

## Risks / Trade-offs

- [Wait adds up to ~30 s to an already-failing command] → Bounded timeout; stderr notice explains the pause; timeout path is behavior-identical to today plus one hint line.
- [Second CLI process spawns a redundant runner while the first rotates] → Pre-existing (per-process spawn dedup only); CAS makes double rotation harmless; out of scope per Non-Goals.
- [Rotation lands but the retry still lists empty] → Falls through to the unchanged probe flow — no false success.
- [Auth-regression gate sensitivity] → `src/auth/cookie-session.ts` is an `AUTH_SENSITIVE_PATHS` glob; the change ships `tests/auth-regression/invariant-await-rotation.test.ts` and the lifecycle-doc changelog entry in the same commit.

## Migration Plan

Single additive cutover on this branch; no persisted-state or CLI-surface migration. Rollback = revert the commit — the wait is additive and the fallback path is byte-identical to the current behavior.
