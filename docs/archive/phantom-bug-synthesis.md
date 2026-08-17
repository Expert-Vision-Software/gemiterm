> **ARCHIVED (2026-08-16) - superseded by docs/auth-cookie-lifecycle.md (canonical) and docs/cookie-ablation-findings.md (empirical record).** Historical reference only; not normative. See docs/README.md for the documentation authority order.

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

## 2026-08-09 — Definitive fix: full L2 silent refresh removed (targeted-only, no mergeCookies) **[BUG INTRODUCED: PSID discard — see 2026-08-10 entry below]**

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
| Recovery | Full L2 `mergeCookies` removed; targeted-only preserves companions | `f681c66` (this branch) | Silent refresh no longer corrupts companion cookies. **⚠ However, this also discards `__Secure-1PSID` rotation — see 2026-08-10 entry below.** |

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

## 2026-08-10 — silentRefresh targeted L2 discards __Secure-1PSID rotation, causing phantom auth after dormancy

**Discovered by:** User reported `list -i` returns 0 chats after ~2h idle despite silent refresh "succeeding". Verbose logs showed: rotateCookies → "no fresh __Secure-1PSIDTS" → silentRefresh "recovered" → CookieJar.upsert "merged 3 into jar" → "Profile is authenticated" → but Browse conversations shows "0 chats".

**Symptom:** After 1-2 hours of dormancy, `gemiterm list -i` returns "No conversations found." despite cookies on disk being valid and silent refresh succeeding. Verbose logs show the chain: rotateCookies fails → phantom detected → targeted L2 silentRefresh runs → upserts 3 cookies (PSIDTS, 3PSIDTS, SIDCC) but NOT PSID → profile "authenticated" → 0 chats.

**Root cause:** `src/services/auth-service.ts` `silentRefresh` method (lines 293-319) captures ALL browser cookies including the new `__Secure-1PSID`, but when persisting:
- cookieJar path (line 316): filters to ONLY `COOKIE_NAMES_OF_INTEREST` = {__Secure-1PSIDTS, __Secure-3PSIDTS, SIDCC}. `__Secure-1PSID` is filtered OUT.
- Non-cookieJar path (line 298-309): preserves non-`COOKIE_NAMES_OF_INTEREST` cookies from `existing` (disk), NOT from browser.

The snapshot (line 256) only captured `activePsidts`, not `activePsid`. The change-detection check (line 310) only checked `psidtsChanged`, not PSID changes.

**Bug introduced at:** Two-commit chain:
1. **`0f9154f`** (Aug 7, v2.7.0 era) — **originally introduced the bug.** Added `COOKIE_NAMES_OF_INTEREST` = {__Secure-1PSIDTS, __Secure-3PSIDTS, SIDCC} (intentionally excluding PSID) and created the dual-mode `silentRefresh` with a `"targeted"` mode that filtered to this set. The default was still `"full"` (safe — used `mergeCookies`). But `detectPhantomAuth` recovery path explicitly called `silentRefresh(name, { mode: "targeted" })` — the first caller to hit the bug.
2. **`f681c66`** (Aug 9) — **amplified the bug by removing the escape hatch.** Deleted the `"full"` mode entirely, making `COOKIE_NAMES_OF_INTEREST` filtering the ONLY path. All callers now hit the bug.

v2.4.0 (`6e82e25`) predates all of this — `silentRefresh` was introduced in `da215dc` (post-v2.4.0), so v2.4.0 has no L2 recovery at all. DHBGAMING2's 12-day session works because v2.4.0 never touches the jar after login — it just calls the SDK directly with stored cookies.

After 1-2 hours of dormancy, Google rotates BOTH `__Secure-1PSID` and `__Secure-1PSIDTS`. The targeted L2 captures the new PSID from the browser but discards it. Stored PSID stays stale, stored PSIDTS is new → mismatch → phantom auth (Google accepts session, returns 0 conversations).

The design assumption in §"Session 3" (line 95-96 of this doc): "`__Secure-1PSID` — Not silently rotated" was WRONG. Google DOES rotate PSID, just less frequently than PSIDTS.

**Fix:** Modified `silentRefresh` to:
1. Snapshot now includes `activePsid` in addition to `activePsidts` (`auth-service.ts:256-265`)
2. `REFRESH_COOKIE_NAMES` set expands `COOKIE_NAMES_OF_INTEREST` with `__Secure-1PSID` (line 253)
3. Extracts `polledPsid` from browser and detects `psidChanged` (lines 294-297)
4. Both persistence paths use `REFRESH_COOKIE_NAMES` instead of `COOKIE_NAMES_OF_INTEREST` (lines 304, 319)
5. "Nothing changed" check includes `psidChanged` (line 313)
6. Non-cookieJar path also updates PSID in the `next` array (line 301 now includes PSID in the set)
Commit: pending (not yet committed as of this entry)

**Verified:** Test baseline 986 pass / 0 fail / 1 skip (up from previous 954). New regression test `"persists __Secure-1PSID change when browser rotates PSID (regression: silentRefresh discards PSID rotation)"` added at `auth-service.test.ts:729`. Fails on old code (PSID preserved as "old-psid" instead of "new-psid"), passes on fix. Existing test `"targeted mode updates only PSIDTS-family cookies; companions keep original values"` updated from asserting PSID NOT rotated to asserting PSID IS rotated (value "psid-original" → "psid-rotated"). Typecheck clean.

**Related ledger entries:**
- §"2026-08-06 — Session 3" (targeted-L2 design sketch, lines 257-283) — the design assumed PSID doesn't rotate. This entry proves that assumption was wrong.
- §"2026-08-09 — Definitive fix: full L2 silent refresh removed (targeted-only, no mergeCookies)" — the targeted-only design preserved companions but also preserved stale PSID. This fix adds PSID rotation to targeted L2 without re-introducing companion corruption.

**IMPORTANT NOTE:** This is the THIRD capture/persistence path to exhibit a cookie-filtering bug:
1. CookieMonitor filtered to REQUIRED_COOKIES (fixed `6bc51f6`) — capture
2. Silent refresh full-mode mergeCookies replaced all companions (fixed `f681c66`) — recovery
3. Silent refresh targeted-mode filtered to COOKIE_NAMES_OF_INTEREST, excluding PSID (fixed now) — recovery

The common pattern: a "designed subset" filter that was correct for one purpose (rotation, gating, companion preservation) but discarded cookies that later proved necessary for full API functionality.

## 2026-08-10 — Companion cookies (SID/HSID/SSID/APISID/SAPISID/SIDCC/NID) still not refreshed by any mechanism

**Discovered by:** Code review following the PSID rotation fix. While the fix above handles PSID rotation during targeted L2, companion cookies remain unrefreshed by any code path.

**Symptom:** None observed yet. Companion cookies are more stable than PSID/PSIDTS and typically set with the login envelope. However, if Google ever rotates companion cookies silently during an active session, no existing mechanism (L1 rotation, L2 silent refresh, or persistRefreshedCookies) will capture or persist the new values.

**Root cause:** All cookie persistence paths use either `COOKIE_NAMES_OF_INTEREST` (rotation) or `REFRESH_COOKIE_NAMES` (silent refresh). Neither set includes companion cookies (SID/HSID/SSID/APISID/SAPISID/SIDCC/NID). Companions are captured once at login time and never updated thereafter.

**Fix:** None at this time — low priority. Companions are more stable than PSID/PSIDTS, and the existing `listChats` regression tests (`auth-service.test.ts:945` guards companion count; `:976` guards companion values) will catch any future breakage. If companion rotation is ever observed in the wild, the fix pattern would be analogous to the PSID fix: expand the refresh cookie set.

**Verified:** Not applicable (no code change). Baseline 986/0/1 unchanged from PSID fix entry above.

**Related ledger entry:** §"2026-08-09 — Definitive fix: full L2 silent refresh removed" — the companion-preservation regression test at `:945` is the guard for this latent risk.

## 2026-08-10 — Simplify plan revised: remove all cookie-name filtering from silentRefresh

**Discovered by:** User question: "why filter at all? how are we sure we're not filtering out any more good cookies?"

The answer: **we shouldn't filter by cookie name in `silentRefresh` at all.** The correct approach is match-by-`(name, domain, path)` on ALL browser cookies — update anything that changed, preserve everything the browser doesn't have. No allowlist. No denylist. No risk of excluding a cookie Google starts rotating tomorrow.

The three cookie-filtering bugs all share the same root pattern: a "designed subset" (REQUIRED_COOKIES, COOKIE_NAMES_OF_INTEREST, REFRESH_COOKIE_NAMES) that was correct for one purpose but wrong for another. The fix for each was expanding the set. The permanent fix is removing the set entirely.

See `docs/alternate-plan-simplify.md` for the full revised plan — removes RotateCookies from hot path, removes phantom detection, removes the 5-state classifier, and rewrites `silentRefresh` to use key-based matching with no cookie-name filtering.

## 2026-08-11 — Reactive phantom detection at the response layer (not the auth gate)

**Discovered by:** Diego, after live dormancy test failed again on `fix/remove-full-l2-mergecookies` (which already removed probe, RotateCookies, phantom detection, and L2 from the hot path). Even with `ensureAuthenticated` reduced to `hasStoredCookies` + `loadCookiesForProfile` (~30 lines), `listChats` still returned 0 chats after ~1-2h idle.

**Symptom:** `gemiterm list` returns "No conversations found" after dormancy, with no error. The session is phantom — cookies are on disk, `models()` would succeed, but `listChats` enumerates 0 conversations. There is no preemptive probe to detect this, so the user sees a silent empty result with no guidance.

**Root cause:** The simplified auth gate (`ensureAuthenticated`) correctly loads cookies from disk and builds a client. The SDK accepts these cookies for `models()` but `listChats` returns empty (the phantom-auth state). With no probe on the hot path (correct — per Point 2 below), there is no opportunity to surface the degradation before the user sees the empty result.

**Three-point design (per user instructions, 2026-08-11):**

**Point 1 — full-jar capture (hygiene, NOT the dormancy fix):** The `CookieMonitor` full-jar capture fix (`6bc51f6`) ensures all companion cookies are captured at login time. This is correct hygiene but does not prevent dormancy phantom-auth. Both working (13-day) and phantom (6-hour) profiles have identical 4-cookie jars.

**Point 2 — remove probe from hot path (already done, still correct):** The preemptive `models()` probe on the hot path was accurate about session validity but had a destructive consequence: when it said "stale" and `silentRefresh` failed, it killed a session that might have worked for the actual API call. v2.4.0 had no such probe. The `ensureAuthenticated` on this branch has no probe — correct.

**Point 3 — detect phantom at the response layer, not the auth gate (NEW):** After `listChats` returns 0 conversations, probe with `models()` to distinguish phantom from dead:
- `models()` succeeds → phantom → "Session is active but no conversations were returned. The session may be stale. Re-authenticate?"
- `models()` fails → dead → session is dead, existing error handling applies
- Don't try to predict it preemptively; react after the fact

**Fix:** Three changes:

1. **`src/core/query-handlers.ts`**: `ListChatsQueryHandler.handle()` — after `listChats` returns 0 for a single profile, call `client.models()`. If models succeeds, set `phantom: true` on the result. `ListChatsQueryResult` gains `phantom?: boolean`.

2. **`src/cli/command-registry.ts`**: `CliCommandContext` gains optional `authService?: AuthService` for re-auth flow.

3. **`src/cli/commands/list-command.ts`**: If `result.phantom`, show confirm prompt and run `runReauthFlow` to re-authenticate. On success, retry the list query.

The phantom check is skipped for `allProfiles` queries (profiles aggregate, per-profile detection is complex). For single-profile queries (`gemiterm list`, `gemiterm list -p <name>`), phantom detection fires when `chats.length === 0`.

**Verified:** 953 pass / 0 fail / 1 skip, typecheck clean. Test mock (`query-handlers.test.ts`) updated with `models: mock(...)` to match new `IGeminiClientService.models()` call in the handler.

**Related ledger entries:**
- §"2026-08-10 — Simplify plan revised" — the companion design doc; this fix is the reactive phantom detection described in the simplify plan's `ensureAuthenticated` ladder but implemented at a higher layer (command/query handler, not auth gate). 

## 2026-08-15 — First-principles ablation: PSIDTS supersession is the root cause; companions theory dead; auth replacement planned

**Discovered by:** Diego-directed ablation study (raw-wire harness, zero gemiterm auth code, methodology mirrored from notebooklm-py `docs/auth-cookie-lifecycle.md` §3.3). Full findings: `docs/cookie-ablation-findings.md`. Plan: `docs/auth-replacement-plan.md`.

**Symptom (captured live):** profile `dhb-zeek` after 9.1 h idle — jar byte-unchanged on disk, init GET returns 200 signed-out HTML (no tokens, no redirect). Earlier stage of the same decay = the phantom state (init tokens ✓, listChats 0).

**Root cause:** server-side `__Secure-1PSIDTS` supersession during zero-rotation idle. Proven: identical jar *shape* with a fresh PSIDTS value → live; byte-stale jar → dead. Also proven (4/4 attempts): HTTP `RotateCookies` returns 200 + `hfcr=600` + SIDCC-family rotation but **withholds PSIDTS** on this account — for dead, sentinel, AND live sessions. Live RPC/init traffic rotates only SIDCC-family, never PSIDTS. The only working rotation engine: browser page-load on the persistent profile (headless, via playwright-cli) — resurrected the 9h-dead session end-to-end.

**Ablation verdicts (3× deterministic):** dropping `__Secure-1PSIDTS` alone → DEAD-INIT. Dropping ANY other single cookie (incl. `SID`, `__Secure-1PSID`) → OK. Dropping the full companion set → OK. The historical trimmed 4-cookie jar → OK when fresh. The "companions required for listChats" hypothesis (this ledger, §The 4-cookie discovery) is therefore misattributed: jar shape was never the dormancy mechanism; PSIDTS freshness was.

**Fix (planned):** full auth replacement — `CookieSession` facade mirroring notebooklm-py architecture (browser-backed refresh as primary engine, L3 headless recovery, CAS cookie store, two-tier validation with tier-1 = PSIDTS routability, reactive phantom detection, full-jar domain-filtered capture). Three OpenSpec changes: `cookie-session-core` → `phantom-detection` → `session-keepalive`.

**Verified:** harness logs in `.gemiterm/harness/` (gitignored): 31-variant ablation + 3× stress matrix + rotate probes + L3 recovery, all deterministic. Post-recovery live check: `gemiterm list` → 14 conversations on restored profile.

**Related ledger entries:**
- §"2026-08-09 — RotateCookies 401 pre-emptively kills sessions" — correct instinct (don't trust RotateCookies), now moot: endpoint omits PSIDTS entirely on this account.
- §"2026-08-11 — Reactive phantom detection" — the classifier design survives; detection now knows dead-vs-phantom boundary exactly (tokens ✗ vs tokens ✓ + 0 chats).
- §"The 4-cookie discovery" — capture fix was necessary hygiene but was never the dormancy mechanism.

## 2026-08-15 — fix-1 implemented: CookieSession core landed (`fix-1-cookie-session-core`)

**Implemented by:** OpenSpec change `fix-1-cookie-session-core` (first of the three-change auth replacement; branch `notebooklm-grilled-auth-fix`).

**What landed:** the auth surface is now `src/auth/` composed around the `CookieSession` facade — `ensureSession` (arm-first; spawns detached `refresh-runner` when jar mtime > 30 min, never blocks the current command), `captureLogin` (headed, gate = PSID+PSIDTS presence, payload = complete domain-filtered jar — the gate-is-not-payload rule is now structural), `probe`/`activeProfiles` (read-only classifier: init-GET tokens + `listChats({limit:1})`), `refresh` + the refresh-and-retry-once `RecoveryRung` (throws `AuthenticationError`, preserving the headed re-login prompt contract for fix-2 wiring). `BrowserRefresher` is the only PSIDTS rotation engine (headless persistent-profile page load → poll `cookie-list` → `state-save` → full-jar write through the CAS `CookieStore`). Storage: snapshot/delta compare-and-swap saves + cross-process `storage_state.json.lock` (exclusive-create `wx`, CAS fail-open 10 s, full-jar fail-closed 90 s, 120 s stale-lock steal — pure Bun fs, no shell). Validation: tier-1 raises when PSIDTS is not RFC-6265-routable to `gemini.google.com`; tier-2 warns once on companion-less jars. Deleted: `src/services/{auth-service,cookie-monitor,cookie-storage-service,profile-auth-manager}.ts`; `GeminiClientService` no longer persists cookies (fed 2-cookie via `ProfileCookieLoader` from `ensureSession`).

**Hard rule made structural:** no cookie-name filtering exists in any capture or persistence path — jars are filtered by domain only (`.google.com`, `.youtube.com`, `accounts.google.com`), pinned by `tests/auth/full-jar-contract.test.ts` (greppable: no `REQUIRED_COOKIES`-style sets under `src/auth/`).

**Verified:** full suite 851 pass / 2 skip / 0 fail / 1797 expects / 60 files (baseline 862/2/0/1748/56; net = +65 new auth/pin tests, −76 deleted-service tests); `tsc --noEmit` clean; path-mediation lint clean; non-interactive `list` byte-equivalence intact. Post-review fixes: detached-runner spawn path now resolved from the runner's own module dir (was silently pointing at a nonexistent `src/cli/refresh-runner.ts`), and the composition root moved inside `src/auth/` (`createCookieSession` factory — `src/cli/index.ts` no longer imports any collaborator directly). Live verification (fresh capture → `gemiterm list` → idle > 1 h → `gemiterm list`) is the user-assisted gate tracked in the change's task 7.4.


## 2026-08-16 - fix-1 idle gate failed: the detached refresh-runner was silently dying (and double-spawning)

**Discovered by:** continuation session executing the approved plan `plan-fix-1-detached-refresh-si-2026-08-16-approved.md`; trigger was the fix-1 task 7.4 idle gate.

**Symptom:** `list` OK at 2026-08-16T00:55Z, "No conversations found." at 04:38Z after 3 h 43 m idle - the phantom signature, jar byte-unchanged on disk. The detached refresh-runner, spawned by every stale-jar `list` since the fix-1 cutover, had persisted nothing in 4 days: stdio discarded (`"ignore"`), zero `page-*.yml` sessions between 2026-08-15T23:23Z and 2026-08-16T05:14Z.

**Root cause (two defects):**

1. `spawnDetachedRefreshRunner` spawned the runner as a plain in-tree child. Under `bun run dev`, the script-runner teardown killed the whole tree: on fast-exit phantom lists the runner died <2 s in, before the browser (reproduced 07:31Z); on slower real-network lists it died mid-poll after opening the browser, orphaning the playwright daemon + headless chromium (05:16Z, 05:58Z). Foreground runs (`bun src/auth/refresh-runner.ts`) worked fine - the %TEMP% spawn-test that "proved" plain-child survival never included the `bun run` wrapper, which was the operative variable.
2. The `list` path armed the profile twice (`getGeminiClient` -> `profileCookieLoader`, then `forProfile(same)` -> loader again, ~106 ms apart), so two runners raced the persistent-profile lock; the loser failed with "Browser is already in use".

**Fix:** runner spawns `detached: true` (own process group, survives the CLI tree); stdout+stderr append-redirected to `<configDir>/gemiterm.log` via new sync `openAppendFd` (`io.ts`; mediation-legal single call site per the `writeFileExclusive` precedent) + `getLogFilePath()` (`path-utils.ts`); child env carries absolute `GEMITERM_CONFIG_DIR`; `ensureSession` memoizes spawned profiles (max one runner per profile per process); `runRefresh` logs a start line (profile + pid). A log-open failure degrades to discarded output - never blocks a refresh.

**Verified:** 864 pass / 2 skip / 0 fail / 1822 expects / 60 files; typecheck + path-mediation clean. Live no-wait recipe (backdate jar mtime -2 h, then `bun run dev list`): exactly one runner, `rotated=true`, 41 cookies persisted, jar write + `gemiterm.log` entry within ~8.4 s, browser closed. Foreground control at 07:46Z rotated the same jar in 4.8 s. One observed miss: the 07:41Z detached run timed out at 60 s without a PSIDTS change (cold-start page-load mint slower than the poll window); the next invocation self-heals. Timeout kept at 60 s on n=1.

**Related ledger entries:**
- "2026-08-08 - minimal wait time to reproduce phantom/dead state: ~1h15m idle" - the idle cadence this engine defect was hiding behind; with a live runner the jar now self-heals instead of rotting
- "The 4-cookie discovery (2026-08-06, afternoon)" - jar shape was never the dormancy mechanism; PSIDTS freshness plus a rotation engine that actually runs were
- "2026-08-15 - fix-1 implemented" - shipped the (silently dead) runner this entry resurrects

---

## Ledger closed (2026-08-16) - fix-1..3 landed; fix-4 guards the invariants

fix-1 (CookieSession core), fix-2 (phantom detection in `list`/`status`), and fix-3 (REPL keepalive + shared rotation floor) are implemented and archived under `openspec/changes/archive/`. The validated replacement - full-jar capture, browser-backed PSIDTS rotation, CAS persistence, honest read-only classifier - runs in production code. Empirical basis: `docs/cookie-ablation-findings.md`; canonical design: `docs/auth-cookie-lifecycle.md`.

fix-4 (`openspec/changes/fix-4-auth-regression-guards`) closes this ledger: every bug class recorded above now has a named invariant test in `tests/auth-regression/` asserting on-disk truth, an auth-sensitive-path gate (`scripts/check-auth-gate.sh`, `bun run check:auth-gate`) that fails CI when auth code changes without the suite changing, and a nightly mutation canary (`bun run canary:auth`) that re-applies the three historical bug shapes - capture name-filter, PSIDTS-discard on persist, stale-clobber save - and asserts the suite goes RED.

**This ledger is now write-once history.** It lives in `docs/archive/` and is non-normative. New auth regressions get a new test in `tests/auth-regression/` plus a changelog entry in `docs/auth-cookie-lifecycle.md` - not a new ledger entry. See `docs/README.md` for the documentation authority order.
