# Phase 0 v2 — Comprehensive regression net for the phantom-auth saga

**Date:** 2026-08-08
**From:** session that identified the Phase 0 design flaw + the user's request for a be-all-end-all test suite
**Replaces:** the "Phase 0 — The regression net" section in `C:/Users/diego/AppData/Local/Temp/architecture-review-auth-2026-08-07.html`
**Status:** Design proposal — awaiting user approval

---

## Why Phase 0 v2

The original Phase 0 design (HTML §"Phase 0 — The regression net", line 142-187) had a structural flaw: the "constant-ok fake" fixture cannot catch the 4-cookie bug. PR #19 faithfully implemented that flawed design. The result is GREEN-everywhere tests that don't trip the gate.

Beyond the design flaw, the Phase 0 design was *narrow* — it aimed at one bug scenario (capture-trim) but the saga has **at least 7 distinct regression scenarios** that have broken across releases (per the HTML's regression-map table, line 65-83):

| Regression | Catching test (RED on prod, GREEN on fix) |
|---|---|
| **6bc51f6** capture-trim (CookieMonitor filters to REQUIRED_COOKIES) | `cookie-monitor.test.ts` on `fix/v2.6.1-bugs` |
| **a780788** throttle defeated (mtime guard refreshed by `persistRefreshedCookies`) | Needs new test: throttle uses POST time, not mtime |
| **4dfe13c** 401 not surfaced (L1 401 bucket = "throttled/skipped") | Needs new test: 401 → throw `AuthenticationError` |
| **9762845** L2 cookie corruption (L2 `mergeCookies` replaces full set) | Needs new test: L2 doesn't wholesale replace |
| **809240a** continue-chat restart (cid-only fallback starts new chat) | Needs new test: `sendMessage(cid)` threads onto existing |
| **b1d0df0** PROBE column (3rd probe path diverges from 1st/2nd) | Architectural; defer to Candidate D |
| **0f9154f** targeted L2 (4th merge strategy) | Needs new test: silentRefresh only updates PSIDTS-family |

The user wants Phase 0 to be the be-all-end-all: catch every regression in the saga, not just the 4-cookie one. That requires ~10 tests across 5+ test files, possibly some src/ refactoring for seams that aren't currently exposed.

---

## Goals

1. **RED on prod v2.6.1** for every regression scenario in the saga.
2. **GREEN on `fix/v2.6.1-bugs`** for the same scenarios.
3. **Survives the Candidates A-E refactor** — the tests must test through stable interfaces, not implementation details.
4. **Time-passing axis** — T+0, T+30min, T+1hr with deterministic clock injection.
5. **No manual waiting** — every test must complete in < 1 second of wall-clock time.

---

## Test suite (Phase 0 v2)

### 0a — Capture integrity (already exists, backport from `fix/v2.6.1-bugs`)

**File:** `tests/services/cookie-monitor.test.ts` (committed `7b2d55f` on `fix/v2.6.1-bugs`).

**Tests:**
- `poll` invokes `onCookiesFound` with the **full** jar when both required cookies are present.
- `poll` does NOT invoke `onCookiesFound` if either required cookie is missing (gating preserved).
- `checkCookies` returns the full jar when both required cookies are present.
- `checkCookies` returns `[]` when cookieListFromState throws.

**Status:**
- RED on `main@v2.6.1` (callback receives 2 cookies, not 7).
- GREEN on `fix/v2.6.1-bugs` after `6bc51f6`.

### 0b — Auth round-trip (new)

**File:** `tests/services/auth-service.test.ts` (extend existing).

**Setup:** mock `PlaywrightCliDriver` returning full jar (7 cookies); real `CookieStorage` (in tmp dir); real `AuthService`.

**Tests:**
- `AuthService.authenticate("test")` → `cookieStorage.save` receives the full jar (7 cookies), not the trimmed subset (2).
- `AuthService.renew("test")` → same.
- `AuthService.authenticate` rejects on timeout (5 min) if no login detected.
- `AuthService.authenticate` calls `closeSession` in `finally` even on error.

**Status:**
- RED on `main@v2.6.1` (save called with 2 cookies).
- GREEN on `fix/v2.6.1-bugs` after `6bc51f6`.

### 0c — Time-passing + cookie freshness (new)

**File:** `tests/services/cookie-storage-service.test.ts` (extend existing).

**Setup:** inject `now()` via `Date.now` mock or `CookieStorageService` constructor (might need a small refactor).

**Tests:**
- T+0: cookies with `expires` 1 hour out → `checkCookieFreshness` returns `true`.
- T+30min (faked clock): cookies still 30 min from expiry → `true`.
- T+1hr + 1ms: cookies past freshness threshold → `false`.
- Session becomes "stale" between T+0 and T+1hr+1ms — the guest being `cookieStorageService.checkCookieFreshness` controls `ensureAuthenticated`'s `autoExtendSession` path.

**Status:**
- Already GREEN on prod (the freshness logic exists). The test REINS the contract; doesn't go RED on prod.
- This is a *characterization* test, not a regression test. It's a baseline that catches future drift.

### 0d — Continue-chat metadata (new)

**File:** `tests/services/gemini-client-wrapper.test.ts` (extend existing).

**Setup:** mock SDK with `readChat` returning existing conversation with `rid`/`rcid`; real `GeminiClientService`.

**Tests:**
- `sendMessage("existing-cid", "msg")` threads onto the existing conversation (new turn has same `cid`, populated `rid`/`rcid`).
- After `sendMessage`, `chatMetadata` is persisted with the conversation's `rid`/`rcid`.
- `ctx` (metadata[9]) round-trip: if `ctx` is set in `chatMetadata`, the SDK call receives `ctx` in the positional array.

**Status:**
- RED on `main@v2.6.1` (cid-only fallback starts new chat).
- GREEN on `fix/v2.6.1-bugs` after `809240a` (seedMetadataFromChat).

### 0e — Profile routing (new)

**File:** `tests/cli/index.test.ts` (currently tests `reauth.ts`; may rename).

**Setup:** mock `setupMediator`'s factory with injected `getGeminiClient(profileName)`; spy on which profile's `cookieStorage.load` is called.

**Tests:**
- `listChats` with `profileName = "dhb-zeek"` calls `cookieStorage.load("dhb-zeek")`, not the default.
- `sendMessage` with `profileName = "dhb-zeek"` uses the right client's cookies.
- `startNewChat` with `profileName = "dhb-zeek"` uses the right client's cookies.

**Status:**
- RED on `main@v2.6.1` (factory uses default profile per `cli/index.ts:117`).
- GREEN on `fix/v2.6.1-bugs` after... **wait, this isn't fixed on `fix/v2.6.1-bugs` yet.** The synthesis doc lists `profile-aware-factory-wiring` as an open change.

**Implication:** Phase 0 would catch a regression that the fix branch hasn't closed yet. This is fine — the test goes RED on prod, stays RED on `fix/v2.6.1-bugs` until that fix lands, then goes GREEN. The test fires when the actual fix is made.

### 0f — Recovery ladder (new)

**File:** `tests/services/cookie-rotation.test.ts` (extend existing) + `tests/services/profile-auth-manager.test.ts` (extend existing).

**Setup:** mock `fetcher` to return controlled responses; inject `now()`.

**Tests:**
- L1 RotateCookies returns 401 → `performRotateCookies` returns `{ rotated: false, sessionInvalid: true }`; `ensureAuthenticated` throws `AuthenticationError`.
- L1 RotateCookies returns 200 with fresh PSIDTS → `cookieStorage.save` called with updated PSIDTS.
- L1 RotateCookies returns 200, no fresh PSIDTS → returns `false`, no silentRefresh.
- L1 RotateCookies returns 200 with fresh PSIDTS but `cookieStorage` already has same PSIDTS → returns `false` (no-op).
- Throttle: 2nd L1 call within 600s is suppressed (uses in-memory POST time, not mtime).
- Throttle: 2nd L1 call after 600s+1ms succeeds.

**Status:**
- RED on `main@v2.6.1` (uses mtime guard; 401 bucketed as throttled).
- GREEN on `fix/v2.6.1-bugs` after `a780788` + `4dfe13c`.

### 0g — L2 cookie corruption (new)

**File:** `tests/services/auth-service.test.ts` (extend existing).

**Setup:** seed `cookieStorage` with full jar (40 cookies); mock L2 browser to return different cookies (browser session has different PSID); trigger `silentRefresh`.

**Tests:**
- After `silentRefresh`, the original login's companions (SID, HSID, SSID, APISID, SAPISID) are preserved.
- After `silentRefresh`, only PSIDTS-family cookies are updated from the browser.
- After `silentRefresh`, the next `rotateCookies` call does NOT return 401.

**Status:**
- RED on `main@v2.6.1` (L2 `mergeCookies` replaces full set).
- GREEN on `fix/v2.6.1-bugs` after `9762845` (L2 escalation removed) + `0f9154f` (targeted L2).

### 0h — Probe convergence (new — architectural)

**File:** `tests/core/query-handlers.test.ts` (new or extend).

**Setup:** mock `geminiClient` with controlled `models()` and `listChats()` responses; probe three paths.

**Tests:**
- `ProfileAuthManager.probeServerSession` result matches `ProbeProfileQueryHandler` result for the same canned state.
- `detectPhantomAuth` result matches `ProbeProfileQueryHandler` result for the same canned state.
- All three probe paths return the same `phantom` flag when `models()` works and `listChats` returns 0.

**Status:**
- Architectural risk: the 3 probe paths are tested in isolation today, not for convergence.
- This test goes RED on prod, stays RED until Candidate D consolidates them.
- This is the most aggressive test — it tests the *architecture*, not the *behavior*.

**Recommendation:** defer to Candidate D. Phase 0 v2 should not include this unless the user wants to gate Candidate D's landing on a probe-convergence test.

### 0i — Context roundtrip (ctx slot)

**File:** `tests/services/gemini-client-wrapper.test.ts` (extend existing).

**Setup:** set `chatMetadata` with `ctx` populated; call `sendMessage`.

**Tests:**
- `sendMessage` with `ctx` in metadata → SDK call receives `ctx` in metadata[9].
- `startNewChat` captures `ctx` from initial response.
- `fetchChat` returns `ctx` for downstream consumers.

**Status:**
- RED on `main@v2.6.1` (ctx not actually threaded).
- GREEN on `fix/v2.6.1-bugs` after `742521e` (preserve chatMetadata ctx in fetchChat).

---

## Test seams needed

Some of these tests require seams that aren't currently exposed:

| Seam | Currently exposed? | What's needed |
|---|---|---|
| `CookieMonitor` with mock driver | ✅ Yes | Nothing; `cookie-monitor.test.ts` already does this. |
| `AuthService` with injected cookieMonitor factory | ✅ Yes | `silentRefreshMonitorFactory` injection in `AuthServiceDeps`. |
| `cookie-rotation.ts` with injected `fetcher` + `now` | ✅ Yes | `RotateCookiesOptions` already supports both. |
| `GeminiClientService` with mock SDK | ✅ Yes | `mockDeps` injection in constructor. |
| `ProfileAuthManager` with mock geminiClient | ✅ Yes | `gimme(modelsImpl)` pattern. |
| `setupMediator` factory closure | ❌ No | Need to expose `getGeminiClient(profileName)` for testability. Currently `cli/index.ts:80-98` is a closure, not callable from outside. |
| Injected clock for time-passing | ❌ No | `Date.now()` is hardcoded throughout. Need to inject `now: () => number` into the freshness check + the `ensureAuthenticated` flow. |

### Required src/ changes (small, surgical)

1. **Expose `getGeminiClient` from `setupMediator`** — return `getGeminiClient` as a property of the returned `ProfileAuthManager`, or wrap the whole `setupMediator` in a class. This is a refactor for testability, not a behavior change.
2. **Inject `now: () => number` into freshness checks** — extend `ProfileAuthManager` and `cookie-storage-service` to accept `now` in their deps. Use `Date.now` as default. Enables time-passing tests.

These are the **only** src/ changes Phase 0 v2 needs. They are refactors (no behavior change) and should not require their own OpenSpec change.

---

## Phasing

Phase 0 v2 is a multi-session effort. Suggested sequence:

### Phase 0 v2.1 — Cookie capture + recovery ladder (1 session)

- Backport `cookie-monitor.test.ts` from `fix/v2.6.1-bugs`.
- Add 0b (auth round-trip), 0d (continue-chat), 0f (recovery ladder), 0g (L2 corruption), 0i (context roundtrip).
- All tests use existing seams. No src/ changes needed.
- **Verify:** all RED on prod v2.6.1, all GREEN on `fix/v2.6.1-bugs`.

### Phase 0 v2.2 — Profile routing + time-passing (1 session)

- Add the 2 src/ refactors (getGeminiClient exposure, now injection).
- Add 0e (profile routing), 0c (time-passing).
- **Verify:** all RED on prod v2.6.1, all GREEN on `fix/v2.6.1-bugs` (after profile-routing fix lands).

### Phase 0 v2.3 — Probe convergence (deferred to Candidate D)

- Defer 0h (probe convergence) to Candidate D's scope.
- Don't include in Phase 0 v2.

### Phase 0 v2.4 — CI gating (after each test lands)

- Ensure CI fails on `main` (where the unfixed code lives) with RED tests.
- Ensure CI passes on `fix/v2.6.1-bugs` after `6bc51f6` (and follow-ups) land.
- This is the **actual iron-tight gate** the original plan wanted.

### Phase 0 v2.5 — Live verification (user-driven)

- After Phase 0 v2.1 + v2.2 land on `main`, user runs `gemiterm list` after a 30-min wait to confirm the bug is reproducible.
- This is the human-in-the-loop step that no test can replace.

---

## Estimated scope

- **Tests:** 10 tests across 6 files (some existing, some new).
- **src/ changes:** 2 small refactors (getGeminiClient exposure, now injection).
- **Effort:** 2-3 sessions estimated.
- **Documentation:** updated synthesis doc entries for each new test.

---

## What this preserves from the original plan

- ✅ 5-candidate taxonomy (A-E)
- ✅ Synthesis-as-journal rule
- ✅ "Regression net before deepening" principle
- ✅ `fix/v2.6.1-bugs` scope (no env-related changes)
- ✅ Branch-off-v2.6.2 for overhaul
- ✅ Three ticket-prefixed OpenSpec changes (extend to 5 tickets for v2.1 + v2.2)

## What this corrects

- ❌ The "constant-ok fake" design — replaced with real-service-stack tests.
- ❌ "Phase 0 closes gap #2" claim — actually closes it (real services, mock at driver boundary only).
- ❌ "merge-while-RED" strategy — Phase 0 v2 IS RED on prod; the strategy works.
- ❌ The 1-test-trips-the-gate assumption — Phase 0 v2 has 10 tests, all of which must pass for the gate to clear.

---

## What the user must decide

I cannot make this call unilaterally. The plan was ambitious; Phase 0 v2 is more ambitious. The user must decide:

1. **Phase 0 v2.1 only** (the cookie capture + recovery ladder tests, no src/ changes). 1 session. Catches the 7 main regressions. Doesn't catch profile-routing or time-passing.
2. **Phase 0 v2.1 + v2.2** (full suite with 2 src/ refactors). 2-3 sessions. Catches everything except probe convergence.
3. **Phase 0 v2.1 + v2.2 + v2.3** (full suite including probe convergence). 3-4 sessions. Catches everything including the architectural divergence.
4. **Something else** — the user has a different priority or wants to scope differently.

My recommendation: **Option 2.** Option 1 is the floor; Option 3 includes an architectural test that better belongs in Candidate D's scope. The 2 src/ refactors are small and surgical.

---

## Action items when this plan is approved

1. Close PR #19 (Phase 0 v1's cookie-aware-fake-based tests).
2. Create branch `phase0-v2/regression-net` from `main@v2.6.1`.
3. Backport `cookie-monitor.test.ts` from `fix/v2.6.1-bugs`.
4. Add the 4 most-feasible tests (0b, 0d, 0f, 0g, 0i) using existing seams.
5. Verify all RED on prod.
6. Merge `fix/v2.6.1-bugs` and re-verify all GREEN.
7. Add the 2 src/ refactors (0e, 0c).
8. Add the 2 remaining tests using the new seams.
9. Re-verify.
10. Tag v2.6.2.
11. Branch `overhaul/cookie-jar-unification` off `main@v2.6.2` for Candidates A-E.

No CHANGELOG entry until step 10. Tests stay in their own commit(s) for review.
