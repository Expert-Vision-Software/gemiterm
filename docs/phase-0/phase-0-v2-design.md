# Phase 0 v2 — Comprehensive regression net for the phantom-auth saga

**Date:** 2026-08-08
**From:** session that identified the Phase 0 design flaw + the user's request for a be-all-end-all test suite
**Replaces:** the "Phase 0 — The regression net" section in `C:/Users/diego/AppData/Local/Temp/architecture-review-auth-2026-08-07.html`
**Status:** ✅ Implemented — all 9 tests GREEN, 0e profile routing fix applied

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

**Status:** ✅ GREEN — merged from `fix/v2.6.1-bugs` via `0fea620`.

### 0b — Auth round-trip (new)

**File:** `tests/services/auth-service.test.ts` (extend existing).

**Setup:** mock `PlaywrightCliDriver` returning full jar (7 cookies); real `CookieStorage` (in tmp dir); real `AuthService`.

**Tests:**
- `AuthService.authenticate("test")` → `cookieStorage.save` receives the full jar (7 cookies), not the trimmed subset (2).
- `AuthService.renew("test")` → same.
- `AuthService.authenticate` rejects on timeout (5 min) if no login detected.
- `AuthService.authenticate` calls `closeSession` in `finally` even on error.

**Status:** ✅ GREEN — merged from `fix/v2.6.1-bugs` via `0fea620`.

### 0c — Time-passing + cookie freshness (new)

**File:** `tests/services/cookie-storage-service.test.ts` (extend existing).

**Setup:** inject `now()` via `Date.now` mock or `CookieStorageService` constructor (might need a small refactor).

**Tests:**
- T+0: cookies with `expires` 1 hour out → `checkCookieFreshness` returns `true`.
- T+30min (faked clock): cookies still 30 min from expiry → `true`.
- T+1hr + 1ms: cookies past freshness threshold → `false`.
- Session becomes "stale" between T+0 and T+1hr+1ms — the guest being `cookieStorageService.checkCookieFreshness` controls `ensureAuthenticated`'s `autoExtendSession` path.

**Status:** ✅ GREEN — characterization tests (`9eb4809`). Now injection added (`now?: () => number`).

### 0d — Continue-chat metadata (new)

**File:** `tests/services/gemini-client-wrapper.test.ts` (extend existing).

**Setup:** mock SDK with `readChat` returning existing conversation with `rid`/`rcid`; real `GeminiClientService`.

**Tests:**
- `sendMessage("existing-cid", "msg")` threads onto the existing conversation (new turn has same `cid`, populated `rid`/`rcid`).
- After `sendMessage`, `chatMetadata` is persisted with the conversation's `rid`/`rcid`.
- `ctx` (metadata[9]) round-trip: if `ctx` is set in `chatMetadata`, the SDK call receives `ctx` in the positional array.

**Status:** ✅ GREEN — merged from `fix/v2.6.1-bugs` via `0fea620`.

### 0e — Profile routing (new)

**File:** `tests/cli/index.test.ts` (currently tests `reauth.ts`; may rename).

**Setup:** mock `setupMediator`'s factory with injected `getGeminiClient(profileName)`; spy on which profile's `cookieStorage.load` is called.

**Tests:**
- `listChats` with `profileName = "dhb-zeek"` calls `cookieStorage.load("dhb-zeek")`, not the default.
- `sendMessage` with `profileName = "dhb-zeek"` uses the right client's cookies.
- `startNewChat` with `profileName = "dhb-zeek"` uses the right client's cookies.

**Status:** ✅ GREEN — fixed via `ListChatsQueryHandler` wiring change (`0fea620`): `getGeminiClient(profile)` now passes profile from payload.

Note: this fix was not on `fix/v2.6.1-bugs` — it was applied directly to `phase0-v2/regression-net` as the `profile-aware-factory-wiring` OpenSpec change didn't merge.

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

**Status:** ✅ GREEN — merged from `fix/v2.6.1-bugs` via `0fea620`. Test assertions updated for `RotateCookiesResult` return type.

### 0g — L2 cookie corruption (new)

**File:** `tests/services/auth-service.test.ts` (extend existing).

**Setup:** seed `cookieStorage` with full jar (40 cookies); mock L2 browser to return different cookies (browser session has different PSID); trigger `silentRefresh`.

**Tests:**
- After `silentRefresh`, the original login's companions (SID, HSID, SSID, APISID, SAPISID) are preserved.
- After `silentRefresh`, only PSIDTS-family cookies are updated from the browser.
- After `silentRefresh`, the next `rotateCookies` call does NOT return 401.

**Status:** ✅ GREEN — merged from `fix/v2.6.1-bugs` via `0fea620`.

### 0h — Probe convergence (new — architectural)

**File:** `tests/core/query-handlers.test.ts` (new or extend).

**Setup:** mock `geminiClient` with controlled `models()` and `listChats()` responses; probe three paths.

**Tests:**
- `ProfileAuthManager.probeServerSession` result matches `ProbeProfileQueryHandler` result for the same canned state.
- `detectPhantomAuth` result matches `ProbeProfileQueryHandler` result for the same canned state.
- All three probe paths return the same `phantom` flag when `models()` works and `listChats` returns 0.

**Status:** ⏸️ Deferred to Candidate D (probe consolidation).

### 0i — Context roundtrip (ctx slot)

**File:** `tests/services/gemini-client-wrapper.test.ts` (extend existing).

**Setup:** set `chatMetadata` with `ctx` populated; call `sendMessage`.

**Tests:**
- `sendMessage` with `ctx` in metadata → SDK call receives `ctx` in metadata[9].
- `startNewChat` captures `ctx` from initial response.
- `fetchChat` returns `ctx` for downstream consumers.

**Status:** ✅ GREEN — merged from `fix/v2.6.1-bugs` via `0fea620`.

---

## Test seams needed

Some of these tests require seams that aren't currently exposed:

| Seam | Currently exposed? | Status |
|---|---|---|
| `CookieMonitor` with mock driver | ✅ Yes | — |
| `AuthService` with injected cookieMonitor factory | ✅ Yes | — |
| `cookie-rotation.ts` with injected `fetcher` + `now` | ✅ Yes | — |
| `GeminiClientService` with mock SDK | ✅ Yes | — |
| `ProfileAuthManager` with mock geminiClient | ✅ Yes | — |
| `setupMediator` factory closure | ✅ Exposed | `setupMediator` returns `{ profileAuthManager, getGeminiClient }` per `9eb4809` |
| Injected clock for time-passing | ✅ Exposed | `now?: () => number` injected into `CookieStorageServiceDeps` + `ProfileAuthManagerDeps` per `9eb4809` |

### Required src/ changes (completed)

1. ✅ **Expose `getGeminiClient` from `setupMediator`** — `setupMediator` now returns `{ profileAuthManager, getGeminiClient }` per `9eb4809`.
2. ✅ **Inject `now: () => number` into freshness checks** — `CookieStorageServiceDeps` and `ProfileAuthManagerDeps` accept optional `now`. Defaults to `Date.now`. Per `9eb4809`.
3. ✅ **Wire profile into `ListChatsQueryHandler.getGeminiClient`** — factory now receives `(profileName?: string)`. Per `0fea620`.

---

## Phasing

### Phase 0 v2.1 — Cookie capture + recovery ladder ✅ COMPLETE

- ✅ Backport `cookie-monitor.test.ts` from `fix/v2.6.1-bugs`.
- ✅ Add 0b (auth round-trip), 0d (continue-chat), 0f (recovery ladder), 0g (L2 corruption), 0i (context roundtrip).
- ✅ All tests GREEN after merge of `fix/v2.6.1-bugs`.

### Phase 0 v2.2 — Profile routing + time-passing ✅ COMPLETE

- ✅ Add the 2 src/ refactors (getGeminiClient exposure, now injection).
- ✅ Add 0e (profile routing), 0c (time-passing).
- ✅ All tests GREEN after merge + wiring fix (`0fea620`).

### Phase 0 v2.3 — Merge fix branch + verify ✅ COMPLETE

- ✅ Merge `fix/v2.6.1-bugs` → `phase0-v2/regression-net` (`20b4a50`).
- ✅ Resolve conflicts (profile-auth-manager deps, synthesis doc).
- ✅ Fix 0e wiring + 0f test assertions (`0fea620`).
- ✅ Verify: **951 pass / 0 fail / 1 skip**.

### Phase 0 v2.4 — CI gating ⏳ NEXT

- ⏳ Open PR: merge `phase0-v2/regression-net` → `main`.
- CI workflow at `.github/workflows/test.yml` runs `bun test` on pushes/PRs — gate fires naturally.

### Phase 0 v2.5 — Tag + live verification ⏳ PENDING

- ⏳ Tag `v2.6.2`.
- ⏳ Live verification: `gemiterm auth` → fresh browser session → ~30min wait → `gemiterm list` confirms no phantom auth.

### Phase 0 v2.6 — Probe convergence ⏸️ DEFERRED to Candidate D

- ⏸️ 0h (probe convergence) belongs in Candidate D's probe-consolidation scope.

### Phase 0 v2.7 — Overhaul ⏳ PENDING

- ⏳ Branch `overhaul/cookie-jar-unification` off `main@v2.6.2` for Candidates A-E.

---

## Estimated scope

- **Tests:** 9 tests across 7 files (0a–0i, excluding deferred 0h). ✅ Done.
- **src/ changes:** 3 small refactors (getGeminiClient exposure, now injection, profile-routing wiring). ✅ Done.
- **Effort:** 3 sessions across 2026-08-08.
- **Baseline:** 951 pass / 0 fail / 1 skip (952 total). Typecheck clean.

## What the user decided

**Option 2** (v2.1 + v2.2, full suite with src/ refactors). Option 3's probe convergence (0h) deferred to Candidate D. All 9 non-deferred tests are GREEN.

---

## Action items

1. ✅ Close PR #19 (Phase 0 v1's cookie-aware-fake-based tests).
2. ✅ Create branch `phase0-v2/regression-net` from `main@v2.6.1`.
3. ✅ Backport `cookie-monitor.test.ts` from `fix/v2.6.1-bugs`.
4. ✅ Add the 0b, 0d, 0f, 0g, 0i tests using existing seams (`988d5d3`, `4220e7b`, `d34d603`).
5. ✅ Verify all RED on prod.
6. ✅ Add the 2 src/ refactors (0e, 0c) (`9eb4809`).
7. ✅ Merge `fix/v2.6.1-bugs` → `phase0-v2/regression-net` (`20b4a50`).
8. ✅ Fix 0e wiring + 0f test assertions (`0fea620`).
9. ✅ Re-verify — **951 pass / 0 fail / 1 skip**.
10. ⏳ Open PR to merge `phase0-v2/regression-net` → `main`.
11. ⏳ Tag `v2.6.2`.
12. ⏳ Branch `overhaul/cookie-jar-unification` off `main@v2.6.2` for Candidates A-E.
