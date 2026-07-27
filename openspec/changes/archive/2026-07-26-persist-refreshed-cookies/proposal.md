# Proposal: Persist refreshed Gemini cookies back to profile storage

## Why

`gemini-reverse` (both 1.0.12 and 2.1.0) merges every Gemini response's
`set-cookie` headers into the live client's in-memory cookie jar — and 2.1.0
makes this the *only* refresh mechanism (the explicit rotate-cookies flow was
removed). We never read those refreshed values back, so the stored
`__Secure-1PSID` goes stale even though every CLI run receives fresh cookies.
Persisting them extends the session each time gemiterm is used: fewer
`gemiterm auth` re-logins, longer-lived profiles — for free, using data the
library already gives us.

## What Changes

- **New save seam on `CookieStorageService`:** add
  `saveCookiesForProfile(profileName, cookies)` delegating to the composed
  `CookieStorage` (today only `auth-service.ts` saves, directly — the wrapper
  has no write path).
- **`GeminiClientService` persists refreshed cookies:** after each successful
  public operation (`init`, `listChats`, `fetchChat`, `sendMessage`,
  `startNewChat`, `deleteChat`, `listModels`), compare the client's live
  `cookies['__Secure-1PSID']` / `['__Secure-1PSIDTS']` against the values the
  instance was constructed with; when changed, merge them into the profile's
  stored cookie list (preserving each entry's existing
  domain/path/httpOnly/secure/sameSite metadata, refreshing `expires`) and
  save. No-op when the instance has no `profileName`/`cookieStorageService`
  (e.g. the CLI's factory client), when nothing changed, or when the client
  holds no value for a cookie. Persistence failures are logged at debug and
  never fail the user-facing operation.
- **Scope:** only `__Secure-1PSID` and `__Secure-1PSIDTS` — the two cookies we
  store, load, and pass to the client today. The on-disk cookie JSON layout is
  unchanged.
- **Ordering:** implement AFTER `upgrade-gemini-reverse-2-1-0` lands. (Passive
  merge exists in 1.0.12 too, but 2.1.0 makes it the sole refresh path, and
  sequencing avoids two changes rewriting the same wrapper concurrently.)

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `auth`: ADDED requirement — refreshed session cookies observed by the
  Gemini client are persisted to the active profile's cookie storage
  (new behavior on `CookieStorageService`/`GeminiClientService`; no existing
  requirement's semantics change — `CookieStorage.save`, freshness, and
  validity rules are untouched).

## Impact

- **Code:** `src/services/cookie-storage-service.ts` (one additive method —
  sensitive area, re-read `tests/services/cookie-storage-service.test.ts`
  before committing) and `src/services/gemini-client-wrapper.ts` (private
  persist helper + call sites). No interface changes; no CLI changes.
- **Tests:** new cases in `tests/services/gemini-client-wrapper.test.ts`
  (changed value → saved with metadata preserved + expiry refreshed; unchanged
  → no write; no profileName → no-op; save throws → operation still succeeds)
  and `tests/services/cookie-storage-service.test.ts` (new method delegates).
- **User-visible effect:** sessions stay alive across runs as long as Google
  keeps issuing refreshed cookies; the 7-day local freshness window still
  applies to cookies that are never refreshed.
- **Out of scope:** persisting any other Google cookies, changing the
  freshness window, and cookie persistence for guest-mode clients (not
  adopted).
