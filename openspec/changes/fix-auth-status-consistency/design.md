## Context

`ProfileManager.getStatus()` at `src/infrastructure/storage.ts:161` computes `isActive` as:

```
isActive = hasValidCookies && (expiresAt === null || expiresAt > Date.now())
```

This uses `getCookieExpiryTimestamp()` (max expiry of `__Secure-1PSID` and `__Secure-1PSIDTS`), but does NOT apply the 7-day freshness window that `checkCookieFreshness()` enforces.

Meanwhile, `hasValidCookies()` (line 198) and `loadCookiesForApi()` (line 206) both call `checkCookieFreshness()`, which rejects cookies whose `__Secure-1PSIDTS` expires within `now + 7 days`.

The `storage` spec's `Freshness and Validity` requirement already mandates consistency across all three methods.

## Goals / Non-Goals

**Goals:**
- Make `getStatus()` report `isActive: false` when the 7-day freshness window is breached, matching `hasValidCookies()` and `loadCookiesForApi()`.
- Ensure `gemiterm auth -l` never shows a green checkmark for a profile that would fail API calls.

**Non-Goals:**
- Changing the freshness threshold (7 days).
- Changing `hasValidCookies()` or `loadCookiesForApi()` behavior.
- Refactoring the broader `storage.ts` structure.

## Decisions

**Decision: Add `checkCookieFreshness()` to `getStatus()` inline**

Add `checkCookieFreshness(cookies)` to the `isActive` conjunction on line 161:

```
isActive = hasValidCookies && checkCookieFreshness(cookies) && (expiresAt === null || expiresAt > Date.now());
```

`checkCookieFreshness` is already an existing module-level function that `hasValidCookies` delegates to. No new function needed.

**Alternatives considered:**

1. **Have `getStatus()` call `this.hasValidCookies()` instead of computing `isActive` independently.** Rejected because `hasValidCookies()` swallows exceptions (returns `false` on load failure), but `getStatus()` distinguishes between "file exists but cookies bogus" (`exists: true, isActive: false`) and "file missing" (`exists: false`). Delegating would lose that distinction.

2. **Extract a shared `areCookiesFreshForApi()` helper.** Overkill for this scope — the change is a one-line boolean addition to an existing expression.

## Risks / Trade-offs

- **Risk**: The `expiresAt === null` check in `isActive` is technically unreachable after this change, since `checkCookieFreshness` returns `false` when `__Secure-1PSIDTS.expires` is 0 or missing (i.e., when `expiresAt` would be null). **Mitigation**: Accept — the redundant check is harmless and keeps the code self-documenting. Could be cleaned up in a future refactor.
