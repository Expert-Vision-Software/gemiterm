## Why

`getStatus()` in `ProfileManager` computes `isActive` using only absolute cookie expiry (`expiresAt > now`), while `hasValidCookies()` and `loadCookiesForApi()` additionally enforce a 7-day freshness window on `__Secure-1PSIDTS`. This means a profile can show as ACTIVE (green checkmark) in `gemiterm auth -l` but fail with an expired-session error when actually used for API calls.

## What Changes

- Update `getStatus()` to call `checkCookieFreshness()` in its `isActive` computation, matching the check used by `hasValidCookies()` and `loadCookiesForApi()`.
- Update the `hasValidCookies` scenario in `getStatus` tests to verify that cookies expiring within the 7-day window are reported as inactive.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `storage`: The `getStatus` method must apply the same freshness check as `hasValidCookies` and `loadCookiesForApi`, as already required by the `Freshness and Validity` requirement in `storage/spec.md`.

## Impact

- `src/infrastructure/storage.ts`: `getStatus()` on `ProfileManager` (line 161) — one-line change to add `checkCookieFreshness()` to the `isActive` expression.
- `tests/` — existing test files covering `getStatus` and `getAllStatuses` need scenario updates to cover the 7-day window.
