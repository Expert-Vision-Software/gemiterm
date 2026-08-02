## Context

The cookie freshness system has three interacting components across two files:

1. **`gemini-client-wrapper.ts:persistRefreshedCookies()`** — After each successful API call, detects if the SDK's in-memory cookie jar has new `__Secure-1PSID`/`__Secure-1PSIDTS` values. If so, merges them into stored cookies and also overwrites `expires` to `now + 7 days`.

2. **`storage.ts:checkCookieFreshness()`** — Checks if `__Secure-1PSIDTS.expires * 1000` < `Date.now() + 7 days`. If so, the cookie fails.

3. **`cookie-storage-service.ts:checkCookieFreshness()`** — A duplicate of the above, used by `CookieStorageService` call sites.

4. **`storage.ts:getStatus()`** — Computes `isActive` using only absolute expiry (`expiresAt > Date.now()`), NOT the freshness check used by `hasValidCookies()` and `loadCookiesForApi()`.

The `freshness` threshold constant `COOKIE_EXPIRY_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000` is defined independently in all three files (`storage.ts:14`, `gemini-client-wrapper.ts:71`, `cookie-storage-service.ts:5`).

### The math bug

When `persistRefreshedCookies()` runs at time T, it sets `cookie.expires = T + 7d`. When `checkCookieFreshness()` runs at time T+Δt:
- `cookie.expires * 1000` ≈ `T + 7d`
- `threshold` = `(T + Δt) + 7d` = `T + Δt + 7d`
- `T + 7d < T + Δt + 7d` is always true when Δt > 0

The check ALWAYS fails on any subsequent use, even seconds later. The cookie value itself is valid (Google's actual cookie hasn't expired), but the freshness gate rejects it.

## Goals / Non-Goals

**Goals:**
- Fix `persistRefreshedCookies` to NOT overwrite `expires`, so Google's real cookie expiry (months/years) survives refreshes.
- Reduce the freshness threshold from 7 days to 1 hour, so the gate only rejects cookies truly about to expire (within 1 hour).
- Add `checkCookieFreshness()` to `getStatus()` so `gemiterm auth -l` displays status consistent with the actual API gate.
- Delete the superseded `fix-auth-status-consistency` change directory.

**Non-Goals:**
- Extracting a shared constant across the three files (would require rethinking the module dependency graph; deferred).
- Changing `hasValidCookies()` or `loadCookiesForApi()` structure (they already use `checkCookieFreshness`).
- Changing the `CookieStorageService`'s validation logic beyond the threshold constant.

## Decisions

### Decision 1: Stop overwriting `expires` in `persistRefreshedCookies`

Remove `expires: expirySec` from the merge object on lines 137 and 141. Only update `value`. This preserves Google's original expiry timestamp (typically months/years in the future), which the freshness check will always pass at the 1-hour threshold.

**Alternative considered**: Overwrite `expires` to a far-future date instead of removing it. Rejected — using Google's real expiry is more correct and avoids any time-drift issues entirely.

### Decision 2: Reduce freshness threshold from 7 days to 1 hour

Change `COOKIE_EXPIRY_THRESHOLD_MS` to `60 * 60 * 1000` (1 hour) in all three locations. This gate still catches truly near-expiry cookies — if a cookie's Google-assigned expiry is within 1 hour, it's genuinely about to expire. But for cookies with Google's real expiry (months+), it always passes.

**Alternative considered**: Remove the freshness check entirely. Rejected — a small threshold provides a safety net. 1 hour is conservative enough to never trigger on valid cookies but catches edge cases where a cookie is truly stale.

### Decision 3: Add `checkCookieFreshness()` to `getStatus()`

Add `checkCookieFreshness(cookies)` to the `isActive` expression on `storage.ts:161`. The new expression becomes:

```typescript
isActive = hasValidCookies && checkCookieFreshness(cookies) && (expiresMs === null || expiresMs > Date.now());
```

The `expiresMs === null` branch (session cookies with `expires: -1`) is already covered by `checkCookieFreshness` returning true for session cookies (no `__Secure-1PSIDTS` with `expires > 0`).

### Decision 4: Update all three copies of `COOKIE_EXPIRY_THRESHOLD_MS`

Since the constant is duplicated across three files and extracting a shared constant is a separate architectural concern, we update all three in-place. The `gemini-client-wrapper.ts` copy becomes unused after Decision 1 (no more `expirySec` computation), but we keep it at the new value for consistency and remove the dead code.

## Risks / Trade-offs

- **Risk**: If Google ever issues `__Secure-1PSIDTS` cookies with very short expiries (e.g., 30 minutes), the 1-hour freshness window could reject them prematurely. **Mitigation**: In practice, Google's auth cookies have multi-month expiries. The original Google `expires` field is never overwritten now, so the check compares against the real expiry. If this becomes an issue, the threshold can be reduced further (e.g., 5 minutes).

- **Risk**: The `expirySec` computation in `gemini-client-wrapper.ts:132` becomes dead code when the `expires` overwrite is removed. **Mitigation**: Remove the `expirySec` variable and the `COOKIE_EXPIRY_THRESHOLD_MS` import from that file. The constant is only used there.

- **Risk**: Changing the threshold from 7 days to 1 hour could make tests that relied on the 7-day window (e.g., "cookies expiring in 3 days are rejected") start failing. **Mitigation**: Adjust test helpers and scenarios to use the new 1-hour threshold. The existing test for "cookies expiring in 1 year are fresh" will still pass.

## Migration Plan

Not applicable — no data migration needed. Existing stored cookies with the artificial "now + 7 days" `expires` value will be refreshed on the next successful API call, which will write back the SDK's cookie values WITHOUT overwriting `expires`. After that first API call, stored cookies will carry Google's original expiry and the freshness check will pass.
