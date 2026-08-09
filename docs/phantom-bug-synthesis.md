# Phantom Authentication — Write-Once Bug Ledger

**Convention:** this is a **write-once ledger** of every attempt to deal with the phantom-auth bug. New entries are appended (never rewritten) when a bug, symptom, or finding is reported AFTER a supposed fix was implemented and failed, or when a new attempt (fix or refactor) is made. Past entries are not edited. See `docs/agents/domain.md` for the convention.

**Original title:** Phantom Authentication — Synthesis & Options (2026-08-06). Scope: retrospective of the 4-day, 3-release sprint (v2.6.0 → v2.6.2), the 4-cookie-jar discovery later the same day, and an evaluation of the background-service idea.

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

## Current state (updated for session 3)

**The capture-integrity bug is fixed and verified deterministically (`6bc51f6`).** The recovery-ladder gaps (A + B) are fixed (`a780788`, `4dfe13c`), the L2-escalation-removal (`9762845`) closes the 401-on-fresh-login regression, the continue-conversation regression is fixed (`809240a`), and the status PROBE column (`b1d0df0`) makes the phantom-auth state visible at a glance.

Branch `fix/v2.6.1-bugs` is now at 8 commits: `6bc51f6` → `f747fc6` → `fced072` → `df7ab32` → `a780788` → `4dfe13c` → **`9762845`** → **`809240a`** → **`b1d0df0`**.

**932 pass / 0 fail / 1 skip / 1952 expects**, typecheck clean. Baseline BL-010 (was BL-009 at 933/1959 in session 2; the −1 test is the removed cooldown contract from `profile-auth-manager.test.ts`, the un-skipped test in `gemini-client-wrapper.test.ts` cancels that out — net test count: −1 test, −7 expects; the `seedMetadataFromChat` change net +1 expect).

Open changes (excluding `commander-cli-parser`, unrelated):

| Change | Status | Notes |
|---|---|---|
| `cookie-jar-integrity` | **Implemented, not archived.** Tasks 1–4 done; task 5.1 (spec sync/archive) pending. | The 0-chats headline fix. Delta targets `openspec/specs/auth/spec.md`. |
| `silent-refresh-stale-psidts-detection` | Tasks 1–4 done, task 5.1 spec sync pending | Code shipped in v2.6.2; delta pending merge into `openspec/specs/phantom-auth-detection/spec.md`. |
| `auth-daemon` (concurrent, `f747fc6`) | Proposal only | Background heartbeat. Its premise (see below) is reframed by the cookie-jar fix; also carries an `auth` spec delta — **archive order vs `cookie-jar-integrity` matters to avoid a delta conflict.** |
| `phantom-auth-review-refactors` | No tasks done | Extract `cookie-constants.ts`, lift `gimme` helper, fix `io.ts` single-call-site violations. Pure refactor. |
| `profile-aware-factory-wiring` | Open | `gemiterm list -p <name>` authenticates the default profile instead of the named one. (Discovered during session 3 PROBE work — `ListChatsQueryHandler` is wired with `getGeminiClient()` (no profile arg) at `cli/index.ts:119`, so the auth path always uses the default profile even when a specific profile is requested.) |
| `interactive-non-interactive-divergence` | Open, large | Interactive paths must route through the mediator. |

Remaining open work:

1. **Design + implement phantom-auth recovery (the current focus).** With L2 escalation removed (`9762845`), sessions in phantom-auth state (models works, listChats empty) cannot self-recover — the user must re-login every time. The leading design idea is a *targeted L2* that refreshes only PSIDTS-related cookies (from `COOKIE_NAMES_OF_INTEREST`) instead of `mergeCookies` (which replaces the full set). See §Session 3 — phantom-auth is now visible for the design sketch.
2. **Investigate whether targeted L2 + phantom detection should replace L1 decline's `logger.debug` branch.** Today's `else if (rotation.attempted)` branch is a no-op. The replacement path needs to: detect phantom (models ✓ AND listChats empty) → trigger targeted L2 → recover or throw `AuthenticationError`.
3. **Archive `cookie-jar-integrity`** (task 5.1) → syncs the two MODIFIED `auth` CookieMonitor requirements into the main spec. ⚠️ Coordinate with `auth-daemon` (also an `auth` delta).
4. **`/test-baseline eval`** — promote `docs/testing-baseline.xml` from BL-009 (933/1959) → BL-010 (932/1952).
5. **Ship gate HOLD** — v2.6.2 must not tag until #1 lands and live `list` returns chats on phantom-auth sessions. Code changes are 5 surgical commits on `fix/v2.6.1-bugs`.
6. Already-degraded on-disk jars are **not** retroactively backfilled by the cookie-jar fix; users run `gemiterm login` / `auth -e <name>` once to repopulate. `status` PROBE column now flags in-place whether a jar is functional (`✓ live`), phantom (`⚠ phantom`), or dead (`✗ dead`).

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

## Session 3 (2026-08-06, late evening) — L2-removal, continue-chat fix, PROBE column

Three more commits on `fix/v2.6.1-bugs`. This section is a strict addendum — the previous narrative stands; these updates close two residual gaps and add one diagnostic.

### 3a. `9762845` — L2 escalation on L1 decline is **harmful**; remove it

**Discovered by:** live verification of the recovery-ladder fix (session 2). Symptom: after a fresh headed `gemiterm login` (40 cookies captured, PSID present, expiry 1 year out), `bun run dev list` returns 23 chats on the first call but throws `AuthenticationError` (rotateCookies 401) on the second call ~30 seconds later.

**Root cause (Hypothesis #2 from session 2 confirmed):** the L2 `silentRefresh` path's `mergeCookies(existing, cookies)` (auth-service.ts:300-302) replaces ALL cookies in the stored jar with browser session cookies. The browser creates a new session (different PSID, different companion cookies), and the merged set is rejected by `accounts.google.com/RotateCookies` with 401 on the next command.

Evidence that the *cookies* are valid (not the session):
- `GEMITERM_SKIP_ROTATE_COOKIES=1 bun run dev list -p evs-diegohb` → listChats call returns "No conversations found" (no error). The cookies work for listChats.
- `bun run dev models -p evs-diegohb` → 7 models returned. The cookies work for models.
- `gemini.google.com/app` GET with the cookies returns 200, with a redirect header to gemini.google.com. The cookies work for the frontend.

So the session is in **phantom-auth state**, not dead. L2 was attempting to "recover" by launching a headless browser that re-signed-in and captured a different session's cookies, then merged them in — actively breaking what was working.

**The fix (commit `9762845`):** remove `escalateAfterServerDecline()` from `ProfileAuthManager`. When L1 RotateCookies returns 200-but-declined (no fresh PSIDTS in Set-Cookie), the session is valid — just log and continue. Three test files updated; the cooldown test and the L2-success-after-decline test were removed (no longer relevant). **931 pass / 0 fail / 2 skip.**

Verified live: two consecutive `bun run dev list` calls after fresh login both return 23 conversations. No 401. The recovery-ladder recurrence (`a780788` + `4dfe13c`) still works correctly for genuinely-dead sessions — that contract is preserved.

### 3b. `809240a` — `continue conversation` regression (pre-existing, exposed by `list -i` flow)

**Discovered by:** user ran `bun run dev list -i`, picked a conversation, chose "Continue conversation". The model responded "I'd love to, but we're just starting our conversation!" — a new chat started instead of threading onto the existing one.

**Root cause:** `sendMessage` in `src/services/gemini-client-wrapper.ts:311-344` had a cid-only fallback when `chatMetadata.lookup` returned null. The fallback built a session with only `session.cid` set (which populates `_meta[0]`) but no `rid` (`_meta[1]`) or `rcid` (`_meta[2]`). The Gemini server requires all three slots to thread onto an existing conversation turn — without `rid`/`rcid`, it treats the request as a new chat and starts a fresh conversation.

This was an explicit non-goal of the archived OpenSpec change `2026-07-27-fix-continue-chat-session-metadata`: "Backfilling metadata for chats that existed before this change." The `list -i` "Continue conversation" path doesn't call `fetchChat` to seed metadata (only the "View full conversation" action does), so the user hits the cid-only fallback.

**The fix:** added a `seedMetadataFromChat()` private method that reads the existing conversation via `this.client!.readChat()`, extracts `rid`/`rcid` from the last model turn, saves to `chatMetadata`, then `sendMessage` re-runs `lookup` and uses the proper metadata path. Self-healing at the service layer — covers `list -i` continue, direct `gemiterm continue <cid>`, and REPL. Test: un-skipped the existing `test.skip(...)` and rewrote it to validate metadata seeding.

### 3c. `b1d0df0` — `status` PROBE column

**User insight:** "what column is missing so that status display is truly indication of things working or not?" Status previously only validated cookies locally (`checkCookieFreshness` on `__Secure-1PSIDTS.expires`) — never touched Google's API. A profile showed `✓ Yes` if its jar file had fresh-looking cookies, even if those cookies were server-side dead.

**The fix:** new `ProbeProfileQueryHandler` in `src/core/query-handlers.ts` runs `models()` and `listChats({ limit: 1 })` in parallel via `Promise.allSettled`. The result is one of three states:

| State | Meaning | Detection |
|---|---|---|
| `✓ live (N≥1)` | Session works for listChats | listChats returned ≥1 chat |
| `⚠ phantom (models N)` | PSID valid, but listChats returns empty — **the bug state** | models works, listChats empty |
| `✗ dead: <error>` | Session is server-side dead | both probes rejected (401, network error, etc.) |

This catches the exact phantom-auth state that was hiding from the local freshness check. The column is always-on (per user's request) — `bun run dev status` now probes every profile on every invocation.

Verified live against the user's 3 profiles:

```
NAME             ACTIVE    PROBE             EXPIRES              LAST USED            DEFAULT
dhb-diegohb      ✓ Yes     ⚠ phantom (mode…  Sep 10, 2027, 04:22… Aug 6, 2026, 04:23 …
dhb-worker       ✓ Yes     ⚠ phantom (mode…  Sep 10, 2027, 04:24… Aug 6, 2026, 04:24 …
evs-diegohb *    ✓ Yes     ⚠ phantom (mode…  Sep 10, 2027, 04:13… Aug 6, 2026, 04:25 … Yes
```

All 3 confirmed in phantom-auth. The user can now see exactly which sessions need re-login and which are dead vs recoverable.

### What session 3 didn't fix (the real remaining problem)

The PROBE column made phantom-auth visible. But phantom-auth is **not yet recoverable** in the current code — the recovery-ladder recurrence (`a780788` + `4dfe13c`) only catches dead sessions (401/403), and the L2 path that *could* recover phantom-auth was removed in 3a because it was actively corrupting cookies.

The leading design idea (not yet implemented) is a **targeted L2 recovery** — modify `silentRefresh` to only update PSIDTS-related cookies (from the `COOKIE_NAMES_OF_INTEREST` set in `cookie-rotation.ts:9` — `__Secure-1PSIDTS`, `__Secure-3PSIDTS`, `SIDCC`) when the browser captures a fresh session, instead of calling `mergeCookies` which replaces the full set. This keeps the original login's PSID + companion cookies (`SID`/`HSID`/`SSID`/`APISID`/`SAPISID`) aligned with each other (so RotateCookies still accepts them) while picking up a fresh PSIDTS from the browser session.

Sketch:

```typescript
// instead of:
const merged = mergeCookies(existing, cookies);
this.cookieStorageService.saveCookiesForProfile(name, merged);

// do:
let updated = false;
const next = existing.map((c) => {
  const browser = cookies.find((bc) => bc.name === c.name && bc.domain === c.domain && bc.path === c.path);
  if (browser && COOKIE_NAMES_OF_INTEREST.has(c.name) && browser.value !== c.value) {
    updated = true;
    return { ...c, value: browser.value };
  }
  return c;
});
if (updated) this.cookieStorageService.saveCookiesForProfile(name, next);
```

Trigger condition: L1 declines (200 OK, no fresh PSIDTS) AND models probe succeeds AND listChats returns empty (phantom-auth detected). Models fails → throw `AuthenticationError` (full reauth). ListChats returns ≥1 → no recovery needed. The detection logic is the new bit — today the L1-decline branch is a `logger.debug` no-op.

### Profile-routing bug noticed during session 3 (not fixed)

When the user ran `bun run dev list -p dhb-worker`, the auth/rotation log said `rotateCookies: ... for profile 'evs-diegohb'` — the default profile, not the requested one. Root cause: `ListChatsQueryHandler` is wired with `getGeminiClient()` (no profile arg) at `src/cli/index.ts:119`, so the auth path always uses the default profile. Then `client.forProfile(profile)` loads the target profile's cookies directly without auth. So the auth/rotation phase runs against the default, while the listChats phase runs against the named profile — a real bug, listed as `profile-aware-factory-wiring` in the open-changes table. Not fixed this session (out of scope for the recovery-ladder work); flagged for the next session.

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

## Recommendation (rewritten, post-session-3)

The original recommendation ("confirm whether v2.6.2 closed the bug") is moot — we now know it did **not** close the 0-chats symptom, and the capture fix that does close it has landed (`6bc51f6`). Session 3 closed two more gaps (L2 cookie-corruption, continue-conversation) and added one diagnostic (status PROBE column). The path forward:

1. **Design + implement phantom-auth recovery** (the *new* top-priority item). The L2-escalation-removal (`9762845`) made phantom-auth visible and stable — sessions don't degrade from cookie corruption anymore — but phantom-auth itself is not yet recoverable. See §Session 3 — phantom-auth is now visible for the targeted-L2 design sketch. TDD at the `ProfileAuthManager` DI seam (`gimme(modelsImpl)` pattern from `tests/services/phantom-auth.test.ts`); write RED tests first.
2. **Live-verify** the capture fix *and* the recovery-ladder fix: headed `gemiterm login` on a degraded profile, then `gemiterm list` after the session naturally drifts into phantom-auth — confirm the targeted L2 recovers without user intervention. (User-driven; closes the inference loop.)
3. **Archive `cookie-jar-integrity`** (task 5.1) and run `/test-baseline eval` (BL-010). Coordinate archive order with `auth-daemon`'s `auth` delta.
4. **Tag v2.6.2** only after steps 1–2 confirm. The CHANGELOG will need to attach the targeted-L2 fix to v2.6.2 if it lands in time.
5. **Then** decide on the background service: if the user wants warm-session automation, ship `gemiterm watch` as a small opt-in follow-up. Defer a real OS daemon to a separate proposal *after* confirming `gemiterm watch` is insufficient.

The background service is not wrong; it was just answering the wrong question. The capture fix answers the right one. With session 3's PROBE column, the user can finally see the question clearly: phantom sessions exist, they're stable, and now they need a recovery mechanism that doesn't break what's working.

---

## Appendix · new entries after 2026-08-06

_New entries are appended here in chronological order when a bug, symptom, or finding is reported AFTER a supposed fix was implemented and failed, or when a new attempt (fix or refactor) is made. The doc preserves the full history of attempts — every fix that worked AND every fix that regressed, in order. Past entries are not edited._

_Entry template:_

```
## YYYY-MM-DD — <one-line summary>
**Discovered by:** <who/what>
**Symptom:** <live repro or test output>
**Root cause:** <with code:line>
**Fix (if any):** <commit hash>
**Verified:** <test count, live>
**Related ledger entry:** <cross-ref to earlier section>
```

## 2026-08-08 — WSL investigation: bug is in code, not environment

**Discovered by:** user-reported finding that DHBGAMING2 (Windows host + WSL Ubuntu) has gemiterm v2.4.0 prod running fine (54 conversations, 3 active profiles, expires 2027), while the local Windows-native install shows phantom-auth (`list` returns 0 chats). Hypothesis raised that the WSL environment might be the difference.

**Symptom (observation):** v2.4.0 WSL on DHBGAMING2 → `gemiterm list --all-profiles` returns 54 conversations; v2.6.1 / dev-branch on Windows-native → `gemiterm list` returns 0 conversations despite locally-valid cookies and "Profile '<name>' is authenticated" log line.

**Root cause:** **No new root cause** — `cookie-monitor.ts:121` and `:179` (the `REQUIRED_COOKIES` filter before `onCookiesFound`/return) is the same root cause as §The 4-cookie discovery. The WSL environment is incidental, not causal.

Evidence:
- `git show v2.4.0:src/services/cookie-monitor.ts` shows the **same filter** as HEAD: `const authCookies = cookies.filter((c) => REQUIRED_COOKIES.has(c.name)); ... onCookiesFound(authCookies);` (lines 117 and tail of v2.4.0 file; lines 121 and 179 of HEAD).
- DHBGAMING2's `storage_state.json` files contain full-jar cookies (~40 per profile). The local Windows-native `storage_state.json` files contain 4-cookie trimmed jars.
- v2.4.0 captures via `CookieMonitor` would produce 4 cookies. So DHBGAMING2's sessions must have been captured via a **non-CookieMonitor mechanism** (most likely: manual Playwright export, browser-direct copy, or a pre-v2.4.0 capture that survived through the `storage_state.json` lifecycle).
- CI matrix (`.github/workflows/test.yml:14`) runs `ubuntu-latest` only — Windows-native is not exercised in CI. This is a separate concern but doesn't affect this bug; the bug is platform-agnostic.

**Fix (recommended):** none to `cookie-monitor.ts` (already fixed in `6bc51f6` on `fix/v2.6.1-bugs`).

**Process change:**
- Close PR #19 (Phase 0 regression net) — the 19 tests are GREEN on every branch because `tests/helpers/full-stack-fixture.ts` exercises the symptom (full jar → `listChats` works) without exercising the cause (`CookieMonitor.poll` filters the jar before persisting). The "RED on prod" gate that Phase 0 was designed to provide cannot fire as designed.
- The regression net that *does* catch the bug already exists at `tests/services/cookie-monitor.test.ts` (committed `7b2d55f` on `fix/v2.6.1-bugs`); it pins the full-jar contract at the `CookieMonitor.poll` callback payload, which is where the bug actually lives. That test goes RED on `main@v2.6.1` and GREEN after `6bc51f6`.
- `fix/v2.6.1-bugs` scope: no change. All 11 commits are code improvements targeting the auth/chat flow. None are env-specific.

**User recovery path:**
1. Merge `fix/v2.6.1-bugs` → `main` (or pull the branch into local working copy).
2. Tag v2.6.2 once merged.
3. Run `gemiterm auth` per affected profile to re-capture with the fixed `CookieMonitor`.
4. Existing 4-cookie jars are not retroactively backfilled; one-time re-auth per profile.
5. `status` command's PROBE column (`b1d0df0`) shows per-profile state: `✓ live (N≥1)`, `⚠ phantom (models N)`, or `✗ dead: <error>`.

**Verified:** no test count change (investigation-only, no code changes). Full investigation report at `docs/phase-0/investigation-report.md`.

**Related ledger entry:** §The 4-cookie discovery — same root cause; this entry documents the WSL/Windows-native investigation that confirmed the root cause is code, not environment.

## 2026-08-08 — dhb-worker session expired after ~2 hours; targeted L2 failed

**Discovered by:** Diego, manual e2e testing transcript at `.gemiterm/a32169f4ec06a340bb61d60d0062983fb9acd88d-e2e-manual.txt` (branch `phase0-v2/regression-net` at `a32169f`, v2.7.0).

**Symptom:** `dhb-worker` profile was set up fresh at 5:50 AM, worked through ~6:42 AM (list returned chats, continue/fetch worked). At 7:57 AM (~2 hours later, ~1h15m idle after last verified working command), the session was dead/phantom. `status -v` triggered a re-auth prompt which the user cancelled. The `evs-diegohb` profile (set up at 6:42 AM, ~1h15m old) was still valid.

**Root cause (two layers):**

**Layer 1 — targeted L2 has zero direct test coverage.** The `auth-service.ts` `silentRefresh` method with `mode: "targeted"` (lines 309-327) is never called in any test. The two tests at `auth-service.test.ts:1057` and `:1088` call `silentRefresh("test-profile")` without `{ mode: "targeted" }` — they exercise the "full" mode's `mergeCookies` path (lines 330-338), not the targeted branch. The test title at :1088 describes targeted behavior but tests the wrong mode.

**Layer 2 — phantom-auth targeted L2 is blocked by `requireRotation`.** When phantom-auth is detected (`detectPhantomAuth` at `profile-auth-manager.ts:200` returns true), `ensureAuthenticated` calls `silentRefresh(name, { mode: "targeted" })` (:137). The targeted L2 opens a headless browser, loads existing cookies via `stateLoad`, and waits for `silentRefreshMonitorFactory()` (`CookieMonitor`) to capture fresh cookies. But in phantom-auth, the session is *frontend-valid*: the browser auto-signs-in with the SAME cookies (same PSID, same PSIDTS). The `requireRotation` check in `CookieMonitor.poll` (:164-176) blocks the callback because neither PSID nor PSIDTS changed from the snapshot. After the 30 s timeout (`SILENT_REFRESH_TIMEOUT_MS`), `silentRefresh` returns false → `ensureAuthenticated` throws `AuthenticationError` → re-auth prompt fires.

The design assumption was that the browser would produce *different* cookies (rotation detected), but in phantom-auth the session is still frontend-valid, so the browser produces the *same* cookies. The targeted L2 is a no-op for the exact phantom state it was designed to recover.

**Fix (recommended):** Two-part:
1. Add direct test coverage for `silentRefresh` with `mode: "targeted"` (the `auth-service.test.ts:1088` test should pass `{ mode: "targeted" }`). This exercises lines 309-327 for the first time.
2. The targeted L2 design needs to be re-evaluated: requiring cookie rotation as the gate-keeper for recovery is fundamentally incompatible with phantom-auth (the frontend-session-is-valid case). Possible approaches:
   - Bypass `requireRotation` when `mode === "targeted"` and phantom-auth is the trigger — capture any browser cookies, update PSIDTS-related ones if they differ, and if they don't differ, attempt a full silent re-sign-in.
   - Or: when phantom-auth is detected AND targeted L2 fails, fall back to a headed re-auth prompt (current behavior, but with the expectation set that this is the designed recovery path for stable-phantom sessions).

**Verified:** 951 pass / 0 fail / 1 skip, typecheck clean. Tests are GREEN because the targeted code path is never exercised.

**Related ledger entry:** §Session 3 (targeted-L2 design sketch) — the design was implemented but the `requireRotation` incompatibility was not caught during design review.

## 2026-08-08 — Phase 0 v1 flaw + Phase 0 v2 design

**Discovered by:** user-requested deeper review after the WSL investigation; user feedback: "production has been broken for the past three releases...I was hoping that phase zero can be the be-all-end-all of the full testing suite that gives me red tests in all the scenarios."

**Symptom (Phase 0 v1, PR #19):**
- All 19 tests in PR #19 were GREEN on every branch (dev, prod, fix).
- The cookie-aware fake in `tests/helpers/full-stack-fixture.ts` is "constant-ok" — it always returns OK regardless of jar state.
- The fixture seeds cookies directly via `cookieStorage.save(profileName, options.seedCookies)`, bypassing the actual `CookieMonitor.poll` capture path.
- The bug lives at `cookie-monitor.ts:121` and `:179` (the `REQUIRED_COOKIES` filter), which is un-exported from the fixture's reach.
- The Phase 0 v1 design's premise ("Phase 0 closes gap #2") was contradicted by its own fixture design.

**Root cause (Phase 0 v1 design flaw, not implementation):** the architecture review HTML (line 176-177) explicitly described the fixture as "constant-ok for Phase 0 (Phase 0 tests the CLIENT, not server-side degradation)" while the test list (line 158) claimed Phase 0 would "catch capture-trim, the 4-cookie bug." A constant-ok fake cannot catch the bug. The plan was tested against `fix/v2.6.1-bugs` HEAD (the fixed code), so the inconsistency wasn't caught during design.

**Fix (Phase 0 v2):** see `docs/phase-0/phase-0-v2-design.md`.

- Closed PR #19 (Phase 0 v1) with documentation comment.
- Created branch `phase0-v2/regression-net` from `main@v2.6.1`.
- Cherry-picked docs commit (`71d2f0a` → `f60ae20`) for `CONTEXT.md`, `docs/agents/*`, `docs/phase-0/plan.md`, `docs/phantom-bug-synthesis.md`.
- 0a — backported `tests/services/cookie-monitor.test.ts` from `fix/v2.6.1-bugs` (committed `7b2d55f`). 2 of 22 tests are RED on prod (the cookie-monitor contract); all 22 GREEN after `6bc51f6`.
- 0b — added `auth-service.test.ts` integration test using real `CookieMonitor` + mock driver returning full jar (7 cookies). RED on prod (Saved 2 cookies; Expected length 7, Received 2); GREEN after `6bc51f6`.
- 2 commits on `phase0-v2/regression-net`: `988d5d3` (foundation), `4220e7b` (0b).

**Verified:** typecheck clean. `bun test`: 909 pass / 3 fail / 2 skip. The 3 failing tests are 2 from 0a + 1 from 0b — all pin the cookie-monitor filter bug.

**Pending (deferred to follow-up sessions, documented in phase-0-v2-design.md):**
- 0d — Continue-chat metadata (catches `809240a`)
- 0f — Recovery ladder (catches `a780788` + `4dfe13c`)
- 0g — L2 cookie corruption (catches `9762845` + `0f9154f`)
- 0i — Context roundtrip (catches `742521e`)
- v2.2: 0c time-passing, 0e profile routing (requires 2 src/ refactors: `getGeminiClient` exposure + `now()` injection)
- v2.3: CI gating (the actual iron-tight gate)
- v2.4: live verification (user-driven, **requires manual browser auth** — the only step in the v2 plan that does)

**Related ledger entry:** §"The 4-cookie discovery" — same root cause; this entry documents the Phase 0 v1 design flaw (constant-ok fake contradicting RED-on-prod claim) and the Phase 0 v2 corrective plan.

## 2026-08-08 — profile-routing lambda drops profile argument, re-auth targets wrong profile

**Discovered by:** manual e2e testing on `phase0-v2/regression-net` (session after targeted-L2 `requireRotation` fix `c160726`). Two profiles (`dhb-worker`, `evs-diegohb`) freshly authed, then left idle ~6h. On re-test: `status -v` showed both `PROBE: ✗ dead`. Phantom-detection triggered targeted L2 (failed fast, ~6s — `requireRotation` fix working). Full re-auth happened. But `list` returned "No conversations found." Both profiles had many chats in Gemini web. Also: `list -p evs-diegohb` authenticated `dhb-worker` (the default) in its logs.

**Symptom:**
- `list` after phantom-triggered re-auth → "No conversations found" despite chats present in Gemini web UI.
- `list -p evs-diegohb` log shows `rotateCookies: ... for profile 'dhb-worker'` — default profile authenticated instead of requested.
- Unit tests: same run `list -p evs-diegohb` shows the correct `evs-diegohb` chats in the PROFILE column (chats existed in the stale on-disk jar), confirming the problem was in the *auth/refresh* path, not the *query* path.

**Root cause:** `src/cli/index.ts:121` — the `ListChatsQueryHandler` factory lambda is `async () => getGeminiClient()` (zero arguments). The handler at `query-handlers.ts:108` correctly extracts `profile` from the query payload and passes it: `this.getGeminiClient(profile)`. But JavaScript silently discards extra arguments to a zero-arg function. `getGeminiClient()` receives `undefined` for `profileName` and defaults to `getDefaultProfileName()` at `index.ts:92`.

The full corrupted flow:
1. Handler extracts `profile = "evs-diegohb"` from payload. Calls `getGeminiClient("evs-diegohb")`.
2. Lambda drops argument. `getGeminiClient()` resolves to `ensureAuthenticated("dhb-worker")`.
3. Phantom detected on `dhb-worker`, targeted L2 fails, full re-auth fires. Browser opens, user logs in. Fresh cookies saved to disk for `dhb-worker`.
4. `getGeminiClient` returns a `GeminiClientService` wired with `dhb-worker`'s fresh cookies.
5. Back in handler: `client.forProfile("evs-diegohb")` loads `evs-diegohb`'s cookies from **disk** (stale, never refreshed). `listChats` returns 0.
6. Result: "No conversations found" — the actual profile was never re-authenticated.

The existing test at `tests/core/query-handlers.test.ts:253-263` passes because its mock factory `(_profileName?: string) => ...` accepts the parameter. The test validates the handler's behavior (correct), but the production wiring (`index.ts:121`) drops the argument (broken).

**Fix:** Changed `src/cli/index.ts:121` from:
```typescript
async () => getGeminiClient()
```
to:
```typescript
async (profileName?: string) => getGeminiClient(profileName)
```
Committed `b5dc3de`. Test baseline unchanged (954 pass / 1 skip / 0 fail). Typecheck clean.

**Verified:** typecheck clean, tests 954/1/0 (existing query-handler test already validates handler passes profile; production wiring was the gap). Live verification completed 2026-08-08 — two interactive test rounds confirm `list -p evs-diegohb` correctly authenticates and lists the named profile's chats. Consecutive commands show no L2 corruption. Targeted L2 recovery ladder verified (targeted → AuthenticationError → re-auth → chats accessible).

**Related ledger entries:**
- §Session 3 — "Profile-routing bug noticed during session 3 (not fixed)" described this exact symptom (line 285-287) and filed `profile-aware-factory-wiring` in open changes. This is the fix.
- §"2026-08-08 — dhb-worker session expired after ~2 hours" — the targeted L2 `requireRotation` fix (`c160726`) was verified fast-failing (~6s, no 30s timeout) on the same test run that exposed this lambda bug.

## 2026-08-08 — minimal wait time to reproduce phantom/dead state: ~1h15m idle

**Question:** Diego, planning the next interactive test round on `phase0-v2/regression-net` after the lambda fix (`b5dc3de`) and `requireRotation` fix (`c160726`). Asked: "any evidence to show it is less than 6h? yes or no, if yes, how long? looking for minimal wait time."

**Answer:** Yes, ≤2h. Tightest floor: **~1h15m idle since last verified working command**.

**Evidence:**
- `docs/phantom-bug-synthesis.md:380` (this ledger, earlier today) — "dhb-worker profile was set up fresh at 5:50 AM, worked through ~6:42 AM (list returned chats, continue/fetch worked). At 7:57 AM (~2 hours later, **~1h15m idle after last verified working command**), the session was dead/phantom." The "~2h" framing in the handoff counts from profile-creation; the floor from last working command is ~1h15m.
- Independent confirmation at `:437` (same session): profiles left idle ~6h → `status -v` showed both `PROBE: ✗ dead`. Different elapsed-time metric, same dataset.

**Mechanism (what actually drives the boundary):**
- **Local freshness gate** (`src/services/cookie-storage-service.ts:6`): `COOKIE_EXPIRY_THRESHOLD_MS = 60 * 60 * 1000` = 1 h. Gates *L1 rotation*, not phantom detection.
- **Probe cache TTL** (`src/services/profile-auth-manager.ts:36`): `DEFAULT_PROBE_CACHE_TTL_MS = 150_000` = 2.5 min. Cache is per-profile, per-process; expires fast.
- **Server-side drift** (Google): `__Secure-1PSIDTS` is "hours" locally-future-looking but server-side rotated silently. No client clock predicts it.

**Practical reproduction recipe:** wait ~1h15m after last verified working command, then `bun run dev status -v`. First profile to flip is usually `⚠ phantom` (models ✓, listChats 0) before any flips to `✗ dead`. To trigger the targeted-L2 recovery path (not just PROBE display), the next command after idle must trigger `ensureAuthenticated` — e.g., `gemiterm list`, not `status -v`.

**Faster alternatives (no code change):**
- `GEMITERM_PROBE_TTL_MS=1000 bun run dev status -v` after idle forces cache to expire every second. Doesn't speed the underlying server-side drift.
- Manual: delete only `__Secure-1PSIDTS` from `%APPDATA%\gemiterm\profiles\<name>\storage_state.json`. Forces server-side 401 on next API call → skips phantom state, hits dead directly. Tests `AuthenticationError` → re-auth flow but bypasses the phantom→targeted-L2 path that exercises the `requireRotation` fix.

**Verified:** documentation-only entry, no code changes. Test baseline 954/1/0 unchanged. To-be-applied: Diego waiting until 5 PM (idle ~5h from ~12 PM Pacific) before re-running the sleep→fail cycle test.

**Related ledger entries:**
- §"2026-08-08 — dhb-worker session expired after ~2 hours" — the source data point for the ~1h15m floor.
- §"2026-08-08 — profile-routing lambda drops profile argument" — the lambda fix being re-verified after the next idle cycle.

## 2026-08-09 — RotateCookies 401 pre-emptively kills sessions that the Gemini API still accepts

**Discovered by:** Diego, cross-version comparison. v2.4.0 on Linux (DHBGAMING2, sessions from July 29, 12 days old) still lists chats fine. v2.7.0 on Windows kills sessions after ~5h idle with `AuthenticationError("Session for profile 'dhb-worker' is no longer valid (server rejected RotateCookies)")`.

**Symptom:**
- `gemiterm list` on v2.7.0 after ~5h idle: first call targeted-L2 recovers but returns "No conversations found"; second call gets `AuthenticationError` because RotateCookies returns 401.
- `gemiterm list` on v2.4.0 after 12 days idle: returns 14 conversations, no errors.
- The core PSID cookie expires Sep 2027 on both machines. It is still valid. Google's Gemini API accepts it. RotateCookies rejects it.

**Root cause:** `profile-auth-manager.ts:121-129` treats RotateCookies 401 as definitive proof of Gemini API session death:

```typescript
if (rotation.sessionInvalid) {
  throw new AuthenticationError(
    `Session for profile '${name}' is no longer valid (server rejected RotateCookies). Run 'gemiterm login'...`,
  );
}
```

In v2.4.0, `ensureAuthenticated` had none of this — it checked `hasValidCookies()` (7-day local freshness) and returned cookies immediately. No RotateCookies call, no probe, no phantom detection. The gemini-web-sdk used the cookies directly, and Google's Gemini API accepted them.

The design flaw: **RotateCookies is an `accounts.google.com` endpoint, not a Gemini API endpoint.** Its session validation behavior differs from the Gemini API endpoints (`models`, `listChats`, `readChat`). A 401 from RotateCookies means Google Accounts won't rotate the PSIDTS token — it does NOT mean the Gemini API will reject the PSID cookie. These are separate services with separate session policies.

The second call in the test session got a 401 because the targeted L2 refresh on the first call partially updated the jar (PSIDTS-family cookies refreshed) while companion cookies (SID/HSID/SSID/etc.) from the expired session remained — creating an inconsistent cookie envelope that RotateCookies rejected. But the Gemini API may have still accepted that envelope for `listChats`/`models`.

**Fix:** Remove the `sessionInvalid` throw. Treat RotateCookies 401/403 the same as "declined" — rotation simply didn't happen, carry on. Run phantom detection (as we do for "declined" already) to attempt targeted L2 recovery. Only throw if targeted L2 also fails. This defers session-validity judgment to the actual Gemini API endpoints rather than a secondary Google Accounts endpoint.

The change is in `profile-auth-manager.ts:121-129` — replace the existing `sessionInvalid` throw block with a fallthrough that mirrors the `rotation.attempted` path (phantom detection → targeted L2 → throw on failure).

**Verified:** TBD after implementation. Test baseline expected unchanged (954/1/0).

**Related ledger entries:**
- §"2026-08-06 — The recovery-ladder recurrence" (Gap B: `sessionInvalid` surface path) — the original design that added the `sessionInvalid` flag. This entry argues the 401 throw was the wrong fix for Gap B.
- §"The 3-release arc" — traces how RotateCookies detection was added across v2.6.0–v2.6.2.
- §"2026-08-06 — Session 3" (L2 removal) — the earlier removal of the L2 cookie-corruption path; this is the companion fix for RotateCookies 401.

## 2026-08-09 — Definitive fix: full L2 silent refresh removed (targeted-only, no mergeCookies)

**Discovered by:** Diego, live dormancy verification (~1h40m idle → `gemiterm list` still returns chats). Code review of `fix/remove-full-l2-mergecookies` branch.

**Symptom (chain, three layers):** After ~1h15m idle, `list` returned 0 chats. The chain:

1. Server-side PSIDTS rotation during idle → `probeServerSession` (`models()`) detects stale state
2. `ensureAuthenticated` calls `rotateCookies` (L1) → server declines or returns 401
3. Phantom detection triggered → `silentRefresh` (L2) launches headless browser
4. **Full-mode L2**: `mergeCookies(existing, browserCookies)` replaces ALL stored cookies — companion cookies (SID/HSID/SSID/APISID/SAPISID) from the original login are replaced with browser session cookies from a different session → jar is corrupted
5. Next command: corrupted jar → RotateCookies 401 OR `listChats` returns 0 → user forced to re-auth

**Three fixes, each necessary, together sufficient:**

| Layer | Fix | Commit | What it closes |
|-------|-----|--------|---------------|
| Capture | CookieMonitor passes full jar, not just PSID/PSIDTS | `6bc51f6` | Companions captured at login time (definitive root cause) |
| Detection | RotateCookies 401 treated as "declined", not session-death | `85f3e7f` (on `main`) | Valid sessions no longer killed by secondary endpoint |
| Recovery | Full L2 `mergeCookies` removed; targeted-only preserves companions | `f681c66` (this branch) | Silent refresh no longer corrupts companion cookies |

The capture fix (`6bc51f6`) was necessary but insufficient: companions were captured at login, but the *recovery* path (triggered after idle) overwrote them with browser session cookies. The targeted-only fix closes the recovery corruption gap — after idle recovery, the jar retains original companion cookies with updated PSIDTS-family cookies. `listChats` works because companions are intact.

**Regression tests (all RED on full-mode re-introduction):**

| Test | File:Line | What it guards |
|------|-----------|---------------|
| `silentRefresh preserves original companions after L2` | `auth-service.test.ts:945` | 8 companion cookie names (SID/HSID/SSID/APISID/SAPISID/SIDCC/NID/OGPC) present after silentRefresh |
| `targeted mode updates only PSIDTS-family; companions keep original values` | `auth-service.test.ts:976` | SID/HSID/APISID values unchanged; `__Secure-1PSID` NOT rotated |
| `targeted silentRefresh returns false when PSIDTS unchanged` | `auth-service.test.ts:1008` | No save when no rotation (prevents spurious writes) |
| `start passes full browser jar to onCookiesFound` | `cookie-monitor.test.ts:366` | Full jar (7 cookies) flows through monitor (capture integrity) |

If someone re-adds full-mode `mergeCookies` to `silentRefresh`, `:945` goes RED because companion names disappear from the saved jar, and `:976` goes RED because `sidCookie.value` is no longer `"sid-original"`.

**Live verified:** `list -i` at `2026-08-09T21:44:57Z`, then again at `2026-08-09T23:23:54Z` (~1h40m idle). Still returns chats. Browser did not open. No cookie corruption.

**Related ledger entries:**
- §"The 4-cookie discovery" — the capture fix (layer 1)
- §"2026-08-09 — RotateCookies 401 pre-emptively kills sessions" — the detection fix (layer 2)
- §"2026-08-06 — Session 3" — predicted targeted L2 as the recovery design; implemented here

