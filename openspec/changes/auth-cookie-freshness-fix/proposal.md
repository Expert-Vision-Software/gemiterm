## Why

Two tightly-related bugs in the cookie freshness/expiry system cause profiles to be rejected prematurely and display misleading status. After any API call that triggers `persistRefreshedCookies`, stored cookies get their `expires` field overwritten to "now + 7 days". This guarantees the 7-day freshness check fails on the next use (even minutes later), because the threshold advances with time while the stored expiry stays fixed. Separately, `getStatus()` does not consult the freshness check at all, so `gemiterm auth -l` shows profiles as ACTIVE even when the actual API gate would reject them.

## What Changes

- **`persistRefreshedCookies`**: Stop overwriting the `expires` field on refreshed cookies. Only update `value` (and any other mutable field). Preserve Google's original expiry timestamp.
- **`checkCookieFreshness`**: Reduce the freshness grace window from 7 days (`7 * 24 * 60 * 60 * 1000`) to 1 hour (`60 * 60 * 1000`). This acts as a safety buffer — rejects cookies truly about to expire, but always passes for cookies with Google's real expiry (months/years away).
- **`getStatus()`**: Add `checkCookieFreshness()` to the `isActive` computation so the auth menu display matches the actual API gate.
- **`cookie-storage-service.ts`**: Update the duplicate `checkCookieFreshness` and `COOKIE_EXPIRY_THRESHOLD_MS` constant to match.
- **Delete `fix-auth-status-consistency` change**: The existing change is fully absorbed into this more comprehensive fix.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `storage`: The `Freshness and Validity` requirement changes the freshness threshold from 7 days to 1 hour. `getStatus` must now apply the freshness check (it was already required but not implemented). The `persistRefreshedCookies` behavior in `GeminiClientWrapper` must preserve Google's original cookie expiry instead of overwriting it.

## Impact

- `src/services/gemini-client-wrapper.ts`: `persistRefreshedCookies()` (lines 136-138) — remove `expires` field overwrite from merge logic
- `src/infrastructure/storage.ts`: `COOKIE_EXPIRY_THRESHOLD_MS` (line 14) — change to 1 hour; `getStatus()` (line 161) — add `checkCookieFreshness()` to `isActive`
- `src/services/cookie-storage-service.ts`: `COOKIE_EXPIRY_THRESHOLD_MS` (line 5) — change to 1 hour
- `tests/infrastructure/storage.test.ts`: Update `makeValidCookies()` expiry if needed; add tests for within-window-but-not-expired and near-expiry (within 1 hour) scenarios
- `tests/services/gemini-client-wrapper.test.ts`: Update `persistRefreshedCookies` tests to verify `expires` is preserved
