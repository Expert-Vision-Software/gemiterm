## Context

v2.7.0's `ensureAuthenticated` at `profile-auth-manager.ts:121-129` throws `AuthenticationError` when `rotateCookies()` returns `sessionInvalid: true` (i.e., RotateCookies POST returned 401/403). This was added in `4dfe13c` (Gap B fix) under the assumption that RotateCookies 401 means the Gemini API session is dead.

Cross-version comparison disproves this: v2.4.0 (which never calls RotateCookies) works with 12-day-old sessions. The RotateCookies endpoint (`accounts.google.com`) has different session validation behavior than the Gemini API endpoints (`models`, `listChats`, `readChat`). A 401 from RotateCookies means the token rotation was rejected — not that the Gemini API will reject the PSID cookie.

The current code path:
1. Probe (`models()`) succeeds → session marked "valid"
2. `rotateCookies()` returns 401 → `sessionInvalid: true` → throw `AuthenticationError`
3. Session is killed before the Gemini API ever gets a chance to respond

## Goals / Non-Goals

**Goals:**
- Remove the RotateCookies 401 → `AuthenticationError` throw
- Merge `sessionInvalid` into the existing `rotation.attempted` branch so phantom detection + targeted L2 recovery can fire
- Fall through to phantom detection when RotateCookies 401/403 occurs

**Non-Goals:**
- No change to the RotateCookies endpoint behavior or cookie-rotation.ts
- No change to the probe cache, L1 throttle, or silentRefresh mechanics
- No change to how targeted L2 merge works

## Decisions

**D1: Merge `sessionInvalid` into `rotation.attempted` branch**

The existing condition chain is:
```
if (rotation.rotated) { ... }
else if (rotation.attempted) { ... phantom detection ... }
else { /* throttled/skipped */ }
```

`sessionInvalid` sets `{ rotated: false, attempted: false }`, so it currently falls into the `else` (throttled/skipped) after the throw is removed.

Change to:
```
if (rotation.rotated) { ... }
else if (rotation.attempted || rotation.sessionInvalid) { ... phantom detection ... }
else { /* throttled/skipped */ }
```

This gives RotateCookies 401/403 the same recovery path as "declined" (200 with no fresh PSIDTS): detect phantom → attempt targeted L2 → if targeted L2 fails, throw. The phantom detection step verifies whether the session is actually usable (listChats returns results) or truly dead.

**Rationale:** RotateCookies 401 can happen because (a) session is genuinely dead, (b) companion cookies expired while PSID is still valid, or (c) RotateCookies endpoint behavior differs from Gemini API. Cases (b) and (c) should not kill the session. Case (a) will surface through phantom detection failing → `AuthenticationError`.

**Alternative considered:** Log and skip entirely (no phantom detection). Rejected — if the session IS truly dead, we want targeted L2 to attempt recovery before giving up.

## Risks / Trade-offs

- **[Risk] Genuinely dead sessions take longer to surface.** Instead of immediate throw on RotateCookies 401, we run phantom detection (listChats call) + targeted L2 (browser launch). This adds ~5-10 seconds to the error path.
  - **Mitigation:** Dead sessions are rare; the common case (session still works via Gemini API) now succeeds without any user intervention.

- **[Risk] Targeted L2 on a RotateCookies-401 session may corrupt the jar.** If the browser auto-signs-in with the same cookies (phantom = frontend-valid), targeted L2 will update PSIDTS cookies while companion cookies may still be expired.
  - **Mitigation:** This is the same risk as the existing "declined" phantom path. The targeted L2 update is scoped to `COOKIE_NAMES_OF_INTEREST` only. If companion cookies are the problem, targeted L2 won't fix it and will throw `AuthenticationError` → user gets re-auth prompt. This is correct behavior — targeted L2 can't manufacture missing companion cookies.
