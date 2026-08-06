# Phantom Authentication — Synthesis & Options

**Date:** 2026-08-06
**Scope:** retrospective of the 4-day, 3-release sprint (v2.6.0 → v2.6.2), the 4-cookie-jar discovery later the same day, and an evaluation of the background-service idea.

> **STATUS (updated later, 2026-08-06):** The original headline of this doc — *"the phantom-auth bug is already fixed at the architectural level in v2.6.2"* — is **wrong**, and was disproven the same afternoon by the **4-cookie-jar discovery**. v2.6.2's fixes (probe + L1 rotation + L2 escalation) were **necessary but insufficient**: they operate on an *already-trimmed* cookie jar. The real root cause of the persistent `list returned 0 chats` symptom is a cookie-**capture** bug in `CookieMonitor`, which was identified, harnessed, specified, and fixed on 2026-08-06 (commits `efab987` → `6bc51f6`). The historical analysis below is retained for context, but read **§The 4-cookie discovery** first; it supersedes the conclusions in §TL;DR (original) and §Recommendation (original).

---

## The 4-cookie discovery (2026-08-06, afternoon) — the definitive root cause

### What was found

After v2.6.2 was declared "done" (but before tagging), the original symptom re-occurred (`list -i` → 0 chats after stepping away ~1 h). Empirical testing against live `%APPDATA%\gemiterm` profiles:

| Probe | Result | Meaning |
|---|---|---|
| `list` (post v2.6.2 L2 fix) | L2 silentRefresh "recovered" PSIDTS → **still 0 chats** | L2 fix necessary, not sufficient |
| `status -v` (3 profiles) | all show **4 cookies**, "next expiry 364d" | the jar is far-future-fresh yet incomplete |
| Jar inspection | exactly 4 cookies: `__Secure-1PSID`+`__Secure-1PSIDTS` on `.google.com` and `.youtube.com` | **missing ~10–12 companion cookies** (`SID`/`HSID`/`SSID`/`APISID`/`SAPISID`/`SIDCC`/`NID`/`__Secure-3PSID`/…) |

### The trimmer — `CookieMonitor`

The full browser jar is trimmed at the **source**, before any persistence path runs. In `src/services/cookie-monitor.ts`:

- `checkCookies` (`:117`) and `poll` (`:159`) both do `cookies.filter((c) => REQUIRED_COOKIES.has(c.name))` where `REQUIRED_COOKIES = {"__Secure-1PSID","__Secure-1PSIDTS"}`, then pass **only that filtered subset** to `onCookiesFound` (poll) / as the return (checkCookies).
- **Every capture path flows through that callback:** headed `authenticate`/`renew` via `waitForLogin`, and `silentRefresh` L2 via `waitForSilentLogin`. So `extractCookies`→`cookieStorage.save` (headed) and `mergeCookies(...)`+`saveCookiesForProfile` (silentRefresh) only ever see PSID/PSIDTS.

### Why this explains everything

- `models()` is PSID-only → succeeds with 4 cookies → probe says "valid" **indefinitely**.
- `readChat(<id>)` works by conversation id (PSID-only) → `continue <id>` succeeds even in the degraded state.
- `listChats` enumeration requires the **full auth set** (companions included) → returns **empty** from a 4-cookie jar.
- `silentRefresh`'s `mergeCookies` (`auth-service.ts:20-30`) is a **correct** upsert-by-`(name, domain, path)` — it preserves existing entries and appends new ones. But it can only merge what the monitor hands it (the trimmed set), so it **faithfully preserves the already-degraded jar**. The L2 escalation (`0b91cde`) "recovers" PSIDTS by its own criterion; `listChats` stays empty.

In one sentence: **the prior fixes addressed detection and rotation; the capture path was silently truncating the jar the whole time.**

### The fix (committed `6bc51f6`)

Separate the **gating predicate** from the **payload**. Keep `REQUIRED_COOKIES` as the login gate (the callback fires only once both required cookies are present); pass the **full** `cookies` array as the payload. Surgical 2-line change in `cookie-monitor.ts` (`:121` `return authCookies`→`return cookies`; `:179` `onCookiesFound(authCookies)`→`onCookiesFound(cookies)`). Downstream `mergeCookies`/`save` code is already correct and **unchanged**.

### Today's commit chain (all on `fix/v2.6.1-bugs`)

| commit | what |
|---|---|
| `efab987` | repro harness — `tests/services/cookie-jar-repro.test.ts`: a cookie-aware fake at the `GeminiClientService`/SDK seam (returns chats iff the on-disk jar carries the companions `listChats` needs). Replaces the ~1 h server-degradation wait with an instant local repro. |
| `7b2d55f` | RED tests — 2 failing tests in `tests/services/cookie-monitor.test.ts` pinning the full-jar contract (intentional red, committed ahead of the fix). |
| `1ce47ec` | OpenSpec change `cookie-jar-integrity` — proposal/design/specs(`auth` delta)/tasks. Validates clean. |
| `6bc51f6` | **the fix** — `CookieMonitor` passes the full jar; CHANGELOG patched; tasks status. Greens the 2 RED tests. |

(Concurrent, not part of this thread: `f747fc6` `spec(auth-daemon)` — the user's own same-day proposal for a background heartbeat. See §Background service below; the cookie-jar fix reframes its premise.)

**Verified:** `bun run typecheck` clean · `bun test` **928 pass / 0 fail / 2 skip / 1945 expects / 57 files**. The existing characterization tests passed unchanged (they stub `cookieListFromState` with exactly the cookies they assert against).

---

## TL;DR (original, earlier 2026-08-06 — superseded by §The 4-cookie discovery)

> Retained for history. The "already fixed" claim below was the working belief before the afternoon replay exposed the capture-trim bug.

The phantom-auth bug was believed fixed at the architectural level in v2.6.2 (CHANGELOG.md). The CLI:

1. Probes the server with `models()` on every `ensureAuthenticated` (catches hard session death).
2. Unconditionally calls `rotateCookies` (L1 `accounts.google.com/RotateCookies` POST) on every valid-cookie `ensureAuthenticated` (proactively rotates `__Secure-1PSIDTS`, 600 s disk-mtime guard throttles).
3. Falls back to a headless browser refresh (L2) only when the probe says "stale" — and, after `0b91cde`, escalates to L2 when L1 reaches Google (HTTP 200) but the server declines to issue fresh PSIDTS.
4. Persists refreshed cookies via a `(name, baselineValue)` merge and an upsert-by-`(name, domain, path)` rule.

**What this got right:** it closed the *detection* gap (H1 — no layer asked Google) and the *rotation* mechanics. **What it missed:** the jar being rotated/probed/persisted was already truncated upstream, so no amount of rotation could restore cookies the monitor had discarded. That gap is what §The 4-cookie discovery closed.

---

## The bug — what it actually was

Authoritative evidence: `openspec/changes/archive/2026-08-03-phantom-auth-ultimate-fix/investigation.md` (637 lines, 5-hypothesis grilling).

The symptom is `gemiterm list -i` returns `0 chats` while the log says `Profile '<name>' is authenticated`, recurring after auth. The 5 subagent hypotheses ranked:

| # | Hypothesis | Verdict |
|---|---|---|
| H1 | `expires` is a cap, not a contract. Server-side session can be invalidated before the cookie's local `expires`. **No layer in the auth gate ever asks Google.** | SUPPORTED — root cause of the **detection** gap (fixed v2.6.0–v2.6.2). |
| H2 | `client.cookies` jar diverges from disk. | REFUTED. |
| H3 | `persistRefreshedCookies` merges by `name` only, not `(name, domain)` — cross-domain duplicates silently overwritten. | BUG CONFIRMED (latent; fixed). |
| H4 | `silentRefresh` is a no-op when loaded cookies are still valid AND is gated behind a local freshness short-circuit. | BUG CONFIRMED (both halves; fixed). |
| H5 | Cookie `expires` ordering is anomalous. | Reframed — the −35-day `PSIDTS−PSID` delta is a fingerprint of SDK renewal behavior, not a client bug. |
| **H6 (added 2026-08-06 PM)** | **The cookie *capture* path truncates the browser jar to `REQUIRED_COOKIES` before persisting, so `listChats` (which needs companion cookies) runs against a 4-cookie jar.** | **ROOT CAUSE of the persistent 0-chats symptom. Fixed `6bc51f6`.** |

H1–H4 share one shape: **the client never consulted the server, or did so on an unreachable path.** H6 is a different class: **the client consulted the server with an incomplete credential set.** The freshness model was entirely local (H1–H4); H6 is a capture-integrity defect that no amount of server-consultation can expose, because `models()` is PSID-only and stays green.

### The PSID vs PSIDTS asymmetry (corrected)

The two tokens serve different roles, but the original table understated `listChats`'s requirements:

| Token | Role | Lifetime | Server-side rotation |
|---|---|---|---|
| `__Secure-1PSID` | Long-lived identity | ~400 days | Not silently rotated |
| `__Secure-1PSIDTS` | Short-lived session | hours (locally far-future-looking) | **Yes — rotated silently** |
| `SID`/`HSID`/`SSID`/`APISID`/`SAPISID`/… | Companion auth cookies | session-scoped | Set with the login envelope |

| RPC | Requires PSID | Requires PSIDTS | Requires companions |
|---|---|---|---|
| `models()` | yes | no | no |
| `readChat(<id>)` | yes | (works PSID-only in practice) | no |
| `listChats()` | yes | yes | **yes — returns empty without them** |

This is why the `models()` probe reported "valid" indefinitely while `listChats` was broken: the probe and the symptom live on different credential requirements, and the capture path was starving `listChats` of exactly the cookies it needs.

---

## The 3-release arc — what was shipped (detection + rotation; not capture)

| Release | Date | Change | Effect |
|---|---|---|---|
| v2.6.0 | 2026-08-03 | `phantom-auth-ultimate-fix` + `phatom-auth-repro-with-tests` | L1 `RotateCookies` POST, server-side probe, L2 headless hardening, `persistRefreshedCookies` `(name, baselineValue)` merge. |
| v2.6.1 | 2026-08-04 | `phantom-auth-probe-rewrite` | Replaced ambiguous `listChats` probe with definitive `models()`. Retired `profile-has-chats` marker. |
| v2.6.2 | 2026-08-05 | `silent-refresh-stale-psidts-detection` + `phantom-auth-data-integrity` + `profile-resolution-client-init` + `profile-has-conversation-lookup` | L1 rotation always on the valid path; `mergeCookies` upsert; `resolveCookie` `.google.com`-preference; async `forProfile`; unbounded `profileHasConversation`. Plus (this branch, `0b91cde`) L2 escalation on server-decline. |

**In hindsight:** these all targeted the *detection/rotation* layer and were correct as far as they went — but they operated on a jar that `CookieMonitor` had already truncated, so they could not resolve the 0-chats symptom. The capture-integrity fix (`6bc51f6`, to ship under v2.6.2) is what actually closes it.

### What the L1 rotation actually does (unchanged, accurate)

`src/services/cookie-rotation.ts` POSTs `[0,"-0000000000000000000"]` to `https://accounts.google.com/RotateCookies` with the current `.google.com` cookie jar. Google's response carries fresh `Set-Cookie` headers for `__Secure-1PSIDTS`, `__Secure-3PSIDTS`, and `SIDCC`. The new values are merged into storage if different. Three guards protect against abuse: a 600 s in-memory throttle keyed off the last POST time (previously a disk-mtime guard, replaced by `a780788`), a concurrent-call dedup (`inFlightRotations`), and the `GEMITERM_SKIP_ROTATE_COOKIES` opt-out.

---

## Current state (updated for the cookie-jar fix)

**The capture-integrity bug is fixed and verified deterministically (`6bc51f6`).** Open changes (excluding `commander-cli-parser`, unrelated):

| Change | Status | Notes |
|---|---|---|
| `cookie-jar-integrity` | **Implemented, not archived.** Tasks 1–4 done; task 5.1 (spec sync/archive) pending. | The 0-chats headline fix. Delta targets `openspec/specs/auth/spec.md`. |
| `silent-refresh-stale-psidts-detection` | Tasks 1–4 done, task 5.1 spec sync pending | Code shipped in v2.6.2; delta pending merge into `openspec/specs/phantom-auth-detection/spec.md`. |
| `auth-daemon` (concurrent, `f747fc6`) | Proposal only | Background heartbeat. Its premise (see below) is reframed by the cookie-jar fix; also carries an `auth` spec delta — **archive order vs `cookie-jar-integrity` matters to avoid a delta conflict.** |
| `phantom-auth-review-refactors` | No tasks done | Extract `cookie-constants.ts`, lift `gimme` helper, fix `io.ts` single-call-site violations. Pure refactor. |
| `profile-aware-factory-wiring` | Open | `gemiterm list -p <name>` authenticates the default profile instead of the named one. |
| `interactive-non-interactive-divergence` | Open, large | Interactive paths must route through the mediator. |

Remaining open work:

1. **Investigate 401 on fresh login.** The recovery-ladder fixes (`a780788`, `4dfe13c`) correctly surface dead sessions, but live testing (2026-08-06 evening) shows `rotateCookies` → 401 immediately after a fresh headed `gemiterm login` (41 cookies captured, PSID present). The cookies work for `models()` (PSID-only) but the API rejects them. Possible causes: login cookies differ from API-required cookies; L2 silentRefresh overwrites with API-invalid browser cookies; cookie quality issue; RotateCookies endpoint bot-detection. This must be diagnosed before the fix can be judged effective.
2. **Live-verify the recovery-ladder fix.** After #1 is resolved, confirm `list` returns chats with the full fix in place.
3. **Archive `cookie-jar-integrity`** (task 5.1) → syncs the two MODIFIED `auth` CookieMonitor requirements into the main spec. ⚠️ Coordinate with `auth-daemon` (also an `auth` delta).
4. **`/test-baseline eval`** — promote `docs/testing-baseline.xml` from BL-007 (913/1909) → BL-009 (933/1959).
5. **Ship gate HOLD** — v2.6.2 must not tag until #1 is resolved and #2 confirms live `list` returns chats. The test baseline is at 933/1959 (0 fail, typecheck clean); the code changes are 2 surgical commits on `fix/v2.6.1-bugs`.
6. Already-degraded on-disk jars are **not** retroactively backfilled by the fix; users run `gemiterm login` / `auth -e <name>` once to repopulate. `status -v` surfaces cookie ages.

---

## The recovery-ladder recurrence (2026-08-06, evening) — two recovery gaps

~30 min after the capture fix was live-verified (`list` returned chats right after a fresh `login`), the **0-chats symptom returned** — but with a **full 39–41 cookie jar**, not the 4-cookie trimmed jar. The capture fix held. The diagnostic at 06:27Z (forcing L1 past the mtime guard) confirmed **Hypothesis B**: the session was genuinely server-side signed out. `rotateCookies` → **401 Unauthorized**; `models()` (PSID-only) still succeeded → probe said "authenticated" → `listChats` empty. No branch threw `AuthenticationError`, so `getGeminiClient`'s headed-reauth path (`cli/index.ts:81-99` → `promptAndReauth`) never fired. This is H1's caveat ("`models()` alone is insufficient") realized exactly.

### The two recovery gaps

**Gap A — throttle defeated by unrelated writes.** `shouldSkipForDiskMtime` read `getFileMtime(getProfilePath(...))` — the jar file's mtime. `GeminiClientService.persistRefreshedCookies` wrote the file on every API call (SDK self-rotation → divergence → save → mtime refreshed), so the 600 s guard was refreshed by unrelated saves and **almost never allowed an explicit rotation**. At 06:04Z the file was 3 min old → throttled → the 401 was never observed → the symptom was silently masked.

**Gap B — no `AuthenticationError` surface path.** `performRotateCookies` classified ALL non-200 (including 401) as `{rotated:false, attempted:false}` — same bucket as "throttled/skipped." `ensureAuthenticated`'s `else` branch debug-logged and returned "authenticated." `escalateAfterServerDecline` (L2 fallback) warned but never threw. Nothing reached the existing headed-reauth prompt.

### The fix (two commits, `fix/v2.6.1-bugs`)

Behind RED tests at the `ProfileAuthManager` and `cookie-rotation` seams (TDD, `gimme(modelsImpl)` pattern from `tests/services/phantom-auth.test.ts`):

**`a780788` — Gap A**: Replace `shouldSkipForDiskMtime` with an in-memory per-process `lastRotatePostAt` Map keyed off the actual RotateCookies POST time. The throttle still guards long-running processes (daemon/REPL); one-shot CLI commands always rotate (exposes the 401). No persisted state, no path-mediation change.

**`4dfe13c` — Gap B**:
- `RotateCookiesResult` gains `sessionInvalid?: boolean`. `performRotateCookies` sets it on **401/403** responses (400/429/5xx/network → transient, unchanged).
- `ensureAuthenticated` throws `AuthenticationError` on `sessionInvalid` → `getGeminiClient` catch → `promptAndReauth`.
- `escalateAfterServerDecline` (200-but-declined phantom case) throws on L2 `silentRefresh` failure **and** on cooldown-skip (previously only warned). L2 still attempted first.
- Two pre-existing tests updated: cooldown contract (`profile-auth-manager.test.ts:720` → `.rejects.toThrow`) and throttle-isolation (`auth-service.test.ts` → `beforeEach` reset).

**933 pass / 0 fail / 2 skip / 1959 expects**, typecheck clean (baseline was 928/1945).

### Open: 401 on fresh login

Live verification exposed a **new problem**: even after a headed `gemiterm login -p evs-diegohb` (41 cookies captured, PSID present), `rotateCookies` returns **401** immediately on the next command — within minutes of login. The B-fix correctly throws (surfaces the dead session), but *why a fresh login produces API-dead cookies* is not understood.

Evidence:
- `list -i` at 07:38Z: L1 got 200 "no fresh PSIDTS" → L2 recovered via browser → authenticated. But `listChats` may have still returned empty.
- `list -p evs-diegohb` at 07:40Z: **401** (session dead again — possibly L2 browser capture overwrote the jar with API-invalid cookies).
- `models -p evs-diegohb` at 07:41Z: also **401**.

Possible causes (uninvestigated):
1. The login captures cookies for the Gemini web app — those differ from what the API endpoints require, so the session is dead-at-birth for programmatic use.
2. L2 `mergeCookies` overwrites the login's cookies with browser-only cookies that lack the API-critical companions.
3. Cookie quality issue (SIDCC mismatch, PSIDTS stale-envelope) the API rejects.
4. RotateCookies endpoint behavior changed (rate-limiting, bot-detection for non-browser User-Agent).

### Implication for the B-fix's "401 → immediate throw" decision

The grill decision (Q2/Q3) chose "401 → throw immediately, skip L2" on the assumption L2 can't save a dead session. But the `list -i` evidence shows L2 CAN recover from degraded states. It's possible that 401 should also attempt L2 silentRefresh before throwing — the browser path may produce working API cookies that RotateCookies alone can't. Worth revisiting if the fresh-login 401 investigation doesn't find a simpler cause.

---

## The background-service idea — re-evaluation

**Original framing:** a persistent process that heartbeats L1 rotation keeps the session fresh between CLI invocations, preventing the symptom.

**Reframed by the cookie-jar discovery:** the 0-chats symptom was **never** "the session rots between invocations." It was "the jar is captured incomplete." A background heartbeat rotates PSIDTS on a 4-cookie jar and persists a 4-cookie jar — it would **not** have fixed the symptom either. The capture fix (`6bc51f6`) is what makes the jar complete; only *after* that does a heartbeat's freshness value become meaningful.

So:

- **What a daemon still usefully addresses:** the narrow case of keeping `__Secure-1PSIDTS` warm for long-running scripted automation that polls `gemiterm list` while the user is away (post-capture-fix, with a *complete* jar). Real but small.
- **What it does not address:** the historical 0-chats symptom (that was capture, now fixed), hard session death after a long absence (no daemon can manufacture a session it never had), or any of the already-fixed detection/merge bugs.
- **Cost remains:** Windows Service / launchd / systemd plumbing, autostart permissions, sleep/resume lifecycle, a new failure mode ("daemon died"). 10x scope expansion for a single-process CLI.

**Verdict (unchanged direction, sharper premise):** a background service is not the fix for phantom-auth (the capture fix is). It is, at most, a small opt-in freshness convenience for automation users — and only worth proposing *after* v2.6.2 (with the capture fix) is confirmed working live. The user's same-day `auth-daemon` proposal (`f747fc6`) is best treated as exploration of that convenience, not as a 0-chats remedy.

### Alternatives (still valid, post-capture-fix)

1. **`gemiterm watch`** — foreground heartbeat (~80 lines, opt-in, no OS service). The CLI itself is the daemon.
2. **`gemiterm login --keepalive`** — piggyback on login; same heartbeat, no new command.
3. **OS-native templates** — ship `gemiterm watch` + systemd/Task Scheduler snippets; OS handles sleep/resume.
4. **`gemiterm status --health`** — surface session age/last-rotation; warn at high risk. Surfaces info without prescribing the fix.

---

## Recommendation (rewritten)

The original recommendation ("confirm whether v2.6.2 closed the bug") is moot — we now know it did **not** close the 0-chats symptom, and the capture fix that does close it has landed (`6bc51f6`). The path forward:

1. **Live-verify** the capture fix: headed `gemiterm login` on a degraded profile, then immediate `gemiterm list` — confirm chats return. (User-driven; closes the inference loop.)
2. **Archive `cookie-jar-integrity`** (task 5.1) and run `/test-baseline eval` (BL-008). Coordinate archive order with `auth-daemon`'s `auth` delta.
3. **Tag v2.6.2** only after step 1 confirms. The CHANGELOG already attaches the 0-chats headline to the capture fix.
4. **Then** decide on the background service: if the user wants warm-session automation, ship `gemiterm watch` as a small opt-in follow-up. Defer a real OS daemon to a separate proposal *after* confirming `gemiterm watch` is insufficient.

The background service is not wrong; it was just answering the wrong question. The capture fix answers the right one.
