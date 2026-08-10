# Alternate Plan — Simplify Toward v2.4.0 (Remove RotateCookies + Phantom Detection)

**Date:** 2026-08-09 (original), updated 2026-08-10 (PSID rotation fix incorporated)
**Status:** Exploration. Not the active plan. Exists as documented fallback.
**Ledger:** See `docs/phantom-bug-synthesis.md` for the 6-day, 4-release history that led here.

---

## Premise

The post-v2.4.0 auth architecture added three layers — L1 RotateCookies, phantom-auth detection, and targeted L2 recovery — to fix a symptom (`listChats` returns empty) whose **definitive root cause** was the `CookieMonitor` capture trim bug, fixed in commit `6bc51f6`.

The symptom and the fix:
- **Symptom:** `listChats` returned 0 chats after ~2h idle, despite `models()` probe passing and cookies appearing locally valid.
- **Real root cause:** `CookieMonitor.poll` filtered the browser jar to `REQUIRED_COOKIES` (PSID/PSIDTS only) before passing to persistence. Every capture path saved only 4 cookies. `listChats` requires companion cookies (SID, HSID, SSID, etc.), which were missing.
- **Real fix:** `6bc51f6` — separate gating predicate from payload. Pass the **full** browser jar.

The RotateCookies + phantom detection + targeted L2 layers were built on the false premise that the jar was complete and the session was degrading. They were individually correct as far as they went, but each introduced its own bugs:

| Layer | Commit range | Bug introduced |
|-------|-------------|----------------|
| L1 RotateCookies | `a780788` → `4dfe13c` | 401 false-positives kill valid Gemini sessions (`accounts.google.com` endpoint has different session policy than Gemini API) |
| Phantom detection | `0f9154f` | `listChats({limit:1})` probe changes cookie jar via `persistRefreshedCookies` side-effect |
| Targeted L2 | `0f9154f` (introduced) → `f681c66` (amplified) | Filters browser cookies to `COOKIE_NAMES_OF_INTEREST`, discarding `__Secure-1PSID` rotation. Leads to phantom auth after ~1h15m idle. |

**The only layers that proved correct across all releases:**
- Full-jar capture (`6bc51f6`) — fixes the definitive root cause
- `models()` server probe — cheap, definitive live/dead signal
- `silentRefresh` without name-based cookie filtering — opens a headless browser to re-capture fresh cookies when the session is genuinely dead

## Evidence

1. **v2.4.0 worked with 12-day-old sessions** (DHBGAMING2 Linux, sessions from July 29, 12 days idle, still lists 14 conversations). v2.4.0 had no RotateCookies, no probe, no phantom detection, no `silentRefresh`. Its `ensureAuthenticated` was ~34 lines: check `hasValidCookies()` → return cookies. Done.
2. **The RotateCookies 401 false-positive** (see [ledger §2026-08-09](docs/phantom-bug-synthesis.md)): `accounts.google.com/RotateCookies` returning 401 does NOT mean the Gemini API session is dead.
3. **The PSID rotation bug** (see [ledger §2026-08-10](docs/phantom-bug-synthesis.md)): `silentRefresh` targeted mode filters to `COOKIE_NAMES_OF_INTEREST` = `{__Secure-1PSIDTS, __Secure-3PSIDTS, SIDCC}`. `__Secure-1PSID` does rotate (contrary to the original design assumption). Browser captures the new PSID but it's discarded.
4. **The companion corruption bug** (see [ledger §Session 3](docs/phantom-bug-synthesis.md)): full-mode L2 `mergeCookies` replaces stored companion cookies with browser session cookies from a different login session, breaking `listChats`.

## The Plan — Remove

### Remove from hot path (every CLI command)

| Layer | File(s) | Why |
|-------|---------|-----|
| L1 `rotateCookies` from `ensureAuthenticated` | `profile-auth-manager.ts:129-133` | Unreliable — `accounts.google.com` endpoint has different session validation than Gemini API. 401 false-positives kill valid sessions. With full jars, SDK self-rotation (`persistRefreshedCookies`) is sufficient for in-session use. |
| `detectPhantomAuth` | `profile-auth-manager.ts:206-215` | Phantom-auth was the capture bug. With full jars from `6bc51f6`, `listChats` shouldn't return empty on valid sessions. If it does, the sessions is genuinely dead → `silentRefresh` should handle it. |
| `classifySession` / `getRecoveryAction` / `SessionState` / `RecoveryAction` | `session-state.ts` (entire file), `profile-auth-manager.ts:142-156` | Five-state classifier and recovery-action dispatcher. Built to route between L1 rotation outcomes. Not needed if rotation and phantom detection are removed. |
| `RotateCookiesResult` type from `ensureAuthenticated` signature | `profile-auth-manager.ts` deps interface | No longer called from the hot path. |
| `rotateCookies` adapter on `AuthService` | `auth-service.ts:216-233` method | If RotateCookies is removed from hot path, this adapter is dead code. Keep `authService.rotateCookies` for opt-in use by `gemiterm renew` / `gemiterm watch`. |

### Remove entirely (dead code after the above)

| File | Why |
|------|-----|
| `session-state.ts` | Five-state classifier becomes dead code. 67 lines. |
| `SilentRefreshOptions.mode` | The "targeted" mode was the bug. No mode param needed. |
| `COOKIE_NAMES_OF_INTEREST` import from `silentRefresh` | This set was the wrong filter for browser-captured cookies. `silentRefresh` should match by `(name, domain, path)` on ALL cookies, not filter by name. |
| `mergeCookies` function in `auth-service.ts:20-30` | Dead export after targeted L2 removal. Was the old full-mode mechanism that corrupted companions. |

## The Plan — Keep

| Layer | Why |
|-------|-----|
| `models()` server probe | Cheap, definitive live/dead signal. One round-trip. |
| `silentRefresh` — **rewritten without cookie-name filtering** | Headless browser re-auth when session is genuinely dead. See §Silent Refresh Rewrite below. |
| `persistRefreshedCookies` | SDK self-rotation must be persisted between CLI runs. |
| Full-jar capture (`6bc51f6`) | The definitive root cause fix. Never regress. |
| RotateCookies endpoint (opt-in) | Keep `authService.rotateCookies` and `cookie-rotation.ts` available for `gemiterm renew` and `gemiterm watch`. Just not in the hot path. |

## Silent Refresh Rewrite — No Cookie-Name Filtering

**Principle:** Match browser cookies to stored cookies by `(name, domain, path)`. Update any matching cookie whose value changed. Preserve any stored cookie the browser doesn't have. Never add browser-only cookies.

Why this works:
- If Google rotated `__Secure-1PSID` → browser has new value → matched by key → updated
- If Google rotated `__Secure-1PSIDTS` → same
- If Google rotated `__Secure-3PSIDTS` → same
- If Google rotated `SIDCC` → same
- Companion cookies (`SID`, `HSID`, `SSID`, `APISID`, `SAPISID`, `NID`) → browser has them too (from login) but values are stable → unchanged → no update
- Browser session cruft (`OTZ`, `SEARCH_SAMESITE`, etc.) → stored cookie doesn't have them → NOT added

**Non-cookieJar path (pseudocode, no COOKIE_NAMES_OF_INTEREST):**

```typescript
const existing = this.cookieStorageService.loadAllCookiesForProfile(name);
let updated = false;
const next = existing.map((c) => {
  const browser = cookies.find((bc) =>
    bc.name === c.name && bc.domain === c.domain && bc.path === c.path,
  );
  if (browser && browser.value !== c.value) {
    updated = true;
    return { ...c, value: browser.value };
  }
  return c;
});
if (!updated) return false;
this.cookieStorageService.saveCookiesForProfile(name, next);
return true;
```

**CookieJar path:**

Use `cookieJar.upsert` with ALL browser cookies that MATCH stored cookies by key. Do NOT add browser-only cookies. The simplest approach: pass the full browser cookie array but have `upsert` skip non-matching entries. Or write a variant: `cookieJar.updateOnly(name, browserCookies)` that only updates matching entries, never adds.

**Snapshot:** Still checks PSIDTS for rotation detection as the exit-early gate (if nothing changed, skip persistence). No longer creates hardcoded sets of "interesting" cookie names.

## Simplified `ensureAuthenticated`

```
ensureAuthenticated(name):
  1. If hasValidCookies(name):
       a. Probe server with models()
       b. If models() succeeds → return cookies
       c. If models() fails → try silentRefresh → if succeeds → return cookies; if fails → throw AuthenticationError
  2. If hasStoredCookies but not valid (expired/stale):
       a. Try silentRefresh → if succeeds → return cookies; if fails → throw AuthenticationError
  3. If no stored cookies → throw AuthenticationError
```

~25 lines. Sync where possible. No rotation. No phantom detection. No cookie-name allowlists. No state machine.

## What about PSIDTS expiry between uses?

v2.4.0 didn't handle this and worked for 12 days. The SDK's `init()` re-extracts the access token from Gemini's HTML on every cold start — it doesn't need a warm PSIDTS to function. The `models()` probe catches genuinely dead sessions and `silentRefresh` recovers them. This is sufficient.

For automation users who want proactive rotation, `gemiterm watch` or `gemiterm renew` can call the (still-existing) `rotateCookies` endpoint explicitly. It just won't be in the critical path of every `gemiterm list`.

## Migration Path

1. Branch `simplify/remove-rotate-phantom` off current HEAD.
2. Rewrite `silentRefresh` to use `(name, domain, path)` matching on ALL cookies — remove `COOKIE_NAMES_OF_INTEREST` filter.
3. Remove `rotateCookies` call from `ensureAuthenticated` → `finishAuthentication`.
4. Remove `detectPhantomAuth`.
5. Remove `classifySession` / `getRecoveryAction` — simplify the recovery flow to the 3-step ladder above.
6. Remove `session-state.ts` (dead module).
7. Remove `mergeCookies` (dead export from `auth-service.ts`).
8. Remove `RotateCookiesResult` from `ProfileAuthManagerDeps`. Keep `rotateCookies` method on `AuthService`.
9. Update tests — existing regression tests for companion preservation and full-jar capture must stay GREEN.
10. Live-verify with fresh login, wait ~2h, run `gemiterm list` — should work.

## Comparison with Active Plan

| Aspect | Simplify (Option 1) | Current (post-PSID-fix) |
|--------|---------------------|-------------------------|
| Lines of code removed | ~150 | 0 (just fixed, not removed) |
| Cookie filtering in silentRefresh | None — match by (name, domain, path) | `REFRESH_COOKIE_NAMES` = `COOKIE_NAMES_OF_INTEREST` + PSID |
| RotateCookies in hot path | No | Yes |
| Phantom detection | No | Yes |
| State machine | No | Yes (5 states, 4 recovery actions) |
| Bug surface | Minimal | Larger (layers can reintroduce filtering bugs) |
| Defense-in-depth | Probe + match-all silentRefresh | Probe + rotation + phantom + targeted recovery |
| Risk of next filtering bug | Zero (no name-based filter) | Non-zero (companions added to filter? Some other cookie excluded?) |

## Decision

This is the **preferred end-state**, documented for the next simplifying refactor. The current code (with the PSID rotation fix) is a working increment but carries unnecessary complexity. The simplify plan should be executed as the next release after v2.7.1 is confirmed working live.

## Related

- `docs/phantom-bug-synthesis.md` — write-once bug ledger, full history
- `docs/phase-0/phase-0-v2-design.md` — regression net design
- Commit `6bc51f6` — cookie-jar-integrity fix (definitive root cause)
- Commit `0f9154f` — introduced `COOKIE_NAMES_OF_INTEREST` filtering and targeted L2
- Commit `f681c66` — removed full-mode escape hatch, amplified the PSID-discard bug
- OpenSpec change `cookie-jar-integrity` — the capture fix
