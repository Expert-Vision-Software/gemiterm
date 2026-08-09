## Why

RotateCookies 401 pre-emptively kills sessions that the Gemini API still accepts. v2.4.0 (which never calls RotateCookies) works fine with 12-day-old sessions. v2.7.0 kills sessions after ~5h idle because the RotateCookies endpoint returns 401 — but the Gemini API (`models`, `listChats`, `readChat`) still accepts the same PSID cookie. RotateCookies is an `accounts.google.com` endpoint with different session validation behavior than the Gemini API. Treating its 401 as definitive proof of Gemini API session death is incorrect.

## What Changes

- **Remove** the `sessionInvalid` throw in `ProfileAuthManager.ensureAuthenticated` (lines 121-129) that kills sessions based on RotateCookies 401/403.
- **Replace** it with a fallthrough to phantom detection + targeted L2 recovery, mirroring the existing `rotation.attempted` path.
- RotateCookies 401/403 is now treated as "rotation failed, carry on" — the actual Gemini API endpoints determine session validity.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `phantom-auth-detection`: The `ensureAuthenticated` recovery ladder no longer throws on RotateCookies 401/403. Session validity is deferred to the Gemini API endpoints rather than the RotateCookies endpoint.

## Impact

- `src/services/profile-auth-manager.ts`: Remove lines 121-129, refactor conditional chain to merge `sessionInvalid` into the existing `rotation.attempted` branch.
- Tests at `tests/services/profile-auth-manager.test.ts`: Update any tests that assert `sessionInvalid` → `AuthenticationError`; the new behavior is to fall through to phantom detection.
- `docs/phantom-bug-synthesis.md`: New ledger entry documenting this fix.
