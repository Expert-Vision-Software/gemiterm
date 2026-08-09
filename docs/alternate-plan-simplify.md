# Alternate Plan — Simplify Toward v2.4.0 (Remove RotateCookies + Phantom Detection)

**Date:** 2026-08-09
**Status:** Exploration. Not the active plan for the current branch.
**Active plan:** Option 2 (explicit state machine + CookieJar unification) on branch `fix/rotate-cookies-401-session-kill`.

---

## Premise

The post-v2.4.0 auth architecture added three layers — L1 RotateCookies, phantom-auth detection, and targeted L2 recovery — to fix a symptom (`listChats` returns empty) whose **definitive root cause** was the `CookieMonitor` capture trim bug, fixed in commit `6bc51f6` (the cookie-jar-integrity fix).

The symptom and the fix:
- **Symptom:** `listChats` returned 0 chats after ~2h idle, despite `models()` probe passing and cookies appearing locally valid.
- **Apparent cause:** Server-side session degradation (PSIDTS rotation, companion cookie expiry) invisible to local freshness checks.
- **Real root cause:** `CookieMonitor.poll` filtered the browser jar to `REQUIRED_COOKIES` (PSID/PSIDTS only) before passing to persistence. Every capture path saved only 4 cookies. `listChats` requires companion cookies (SID, HSID, SSID, APISID, SAPISID, etc.), which were missing.
- **Real fix:** `6bc51f6` — separate gating predicate from payload. Keep REQUIRED_COOKIES as the login gate; pass the **full** browser jar as the payload.

The RotateCookies + phantom detection + targeted L2 layers were built on the false premise that the jar was complete and the session was degrading. They were each individually correct but collectively unnecessary once the jar is captured intact.

## Evidence

1. **v2.4.0 worked with 12-day-old sessions** (DHBGAMING2 Linux, sessions from July 29, 12 days idle, still lists 14 conversations). v2.4.0 had no RotateCookies, no probe, no phantom detection. Its `ensureAuthenticated` was 34 lines, sync: check `hasValidCookies()` → return cookies. Done.
2. **The RotateCookies 401 false-positive** (latest ledger entry in `docs/phantom-bug-synthesis.md`): `accounts.google.com/RotateCookies` returning 401 does NOT mean the Gemini API session is dead. v2.7.0 killed sessions after ~5h idle; v2.4.0 didn't kill them at all.
3. **Every phantom-auth fix addressed detection/rotation, not the data.** The jar flowing through all the layers was already degraded by the capture trim. The probe, rotation, and phantom detection were operating on 4 cookies and couldn't fix what they couldn't see.

## The Plan

### Remove

| Layer | File | Why |
|-------|------|-----|
| L1 RotateCookies from hot path | `profile-auth-manager.ts:114-140` | `accounts.google.com` endpoint has different session validation than Gemini API. False-positive 401 kills valid sessions. With full-jar capture, SDK self-rotation (`persistRefreshedCookies`) is sufficient. |
| `detectPhantomAuth` | `profile-auth-manager.ts:190-199` | Phantom-auth was the capture bug. With full jars, `listChats` shouldn't return empty on valid sessions. |
| Targeted L2 | `auth-service.ts:310-328` | Phantom-auth recovery not needed when jars are complete. |
| `RotateCookiesResult` type + `rotateCookies` dep | `profile-auth-manager.ts` deps interface | No longer called from ensureAuthenticated. |
| `rotateCookies` adapter on `AuthService` | `auth-service.ts:216-233` | If RotateCookies is removed from hot path. |

### Keep

| Layer | Why |
|-------|-----|
| `models()` probe | Cheap, definitive live/dead signal. One round-trip to Google. |
| `silentRefresh` (full mode) | Headless browser re-auth when session is genuinely dead. |
| `persistRefreshedCookies` | SDK self-rotation must be persisted between CLI runs. |
| Full-jar capture (`6bc51f6`) | The definitive root cause fix. Never regress. |

### Simplified `ensureAuthenticated`

The result would look like:

```
ensureAuthenticated(name):
  1. Check hasValidCookies → no → throw (or try autoExtendSession → silentRefresh → throw if fail)
  2. Probe server with models() → stale → silentRefresh → throw if fail
  3. Return cookies
```

~20 lines. Sync where possible. No rotation. No phantom detection. No targeted L2. The RotateCookies endpoint could still be called by a `gemiterm watch` background process, but it would not be in the critical path of every CLI command.

## Risks

1. **Server-side PSIDTS rotation** — without L1 RotateCookies, `__Secure-1PSIDTS` will only rotate via SDK self-rotation (which requires an API call). If the user goes days without using gemiterm, PSIDTS may expire server-side while PSID is still valid. The `models()` probe would still catch this and trigger `silentRefresh`. This is the same behavior as v2.4.0, which worked in practice.
2. **Companion cookie expiry** — SID/HSID/SSID/etc. are session-scoped. If they expire server-side, `listChats` will return empty even with full jars. v2.4.0 didn't handle this either. The `models()` probe + `silentRefresh` ladder would surface it as a dead session → re-auth.
3. **No proactive rotation** — without L1 RotateCookies, there's no mechanism to keep PSIDTS warm between CLI invocations. A `gemiterm watch` background process could fill this gap for automation users.

## Migration Path

1. Branch `simplify/remove-roteta-phantom` off main@v2.7.0.
2. Remove `rotateCookies` call from `ensureAuthenticated`.
3. Remove `detectPhantomAuth`.
4. Remove targeted L2 from `silentRefresh`.
5. Simplify `RotateCookiesResult` type or remove the `sessionInvalid` field.
6. Remove `rotateCookies` dep from `ProfileAuthManagerDeps`.
7. Update tests — the 10-test Phase 0 v2 regression net must stay GREEN.
8. Live-verify with a fresh login, wait ~2h, run `gemiterm list` — should still work.

## Comparison with Active Plan (Option 2)

| Aspect | Option 1 (Simplify) | Option 2 (Explicit state machine) |
|--------|---------------------|----------------------------------|
| Lines of code | ~100 removed | ~200 added (new modules) |
| Complexity | Decreased | Same, reorganized |
| Bug surface | Smaller | Same, typed |
| Defense-in-depth | Probe + silentRefresh only | All current layers, explicit |
| Risk | PSIDTS may expire between uses; `models()` probe catches it | RotateCookies 401 false-positives (already fixed); transition bugs (already surfaced) |
| Test changes | Remove tests for removed paths | Add tests for new modules |
| Migration effort | ~1 day | ~3-5 days |

## Decision

This is the **alternate plan**, documented for future consideration. The active plan (Option 2: explicit state machine + CookieJar unification) is being implemented on `fix/rotate-cookies-401-session-kill`. If Option 2 proves too complex or introduces new regressions, this plan is the fallback.

## Related

- `docs/phantom-bug-synthesis.md` — write-once bug ledger
- `docs/phase-0/phase-0-v2-design.md` — regression net design
- Commit `6bc51f6` — the cookie-jar-integrity fix (definitive root cause)
- Commit `c4870de` — RotateCookies 401 session-kill fix
- OpenSpec change `cookie-jar-integrity` — the capture fix
- `C:\Users\diego\AppData\Local\Temp\architecture-review-auth-2026-08-08-v3.html` — v3 architecture review
