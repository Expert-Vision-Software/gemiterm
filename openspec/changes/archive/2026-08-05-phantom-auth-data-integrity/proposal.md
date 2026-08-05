## Why

The v2.6.0 phantom-auth fix shipped with two data-integrity bugs that corrupt the cookie jar and manufacture the staleness condition the probe then "detects." `loadCookiesForProfile` is domain-blind — it builds a name-keyed `Map`, so once the `.google.com` `__Secure-1PSIDTS` is lost, it silently injects the `.youtube.com` variant into the SDK. `silentRefresh` then seals the corruption by wholesale-overwriting the jar with the degraded polled set, evicting the surviving `.google.com` PSIDTS and making recovery impossible. Fixing these two data-integrity bugs stops the jar from degrading and the silent refresh from destroying it — regardless of whether the probe premise is also wrong.

## What Changes

- **Domain-scoped cookie loading.** `loadCookiesForProfile` currently builds a name-keyed `Map` resolving `__Secure-1PSID` and `__Secure-1PSIDTS` to the first match by name only. Change to prefer `.google.com` domain entries, falling back to the first match if none exist. Ensures the SDK receives the correct domain's rotating token.
- **Merge-by-name-domain-path upsert in `silentRefresh`.** `silentRefresh` currently calls `extractCookies` which wholesale-overwrites the jar. Replace with a merge that upserts each polled cookie by `(name, domain, path)` key, preserving entries not present in the polled set. Reuses the pattern already implemented in `GeminiClientService.persistRefreshedCookies`.

## Capabilities

### New Capabilities

(none — this is a fix to existing capabilities, no new capability surface)

### Modified Capabilities

- `auth`: `loadCookiesForProfile` MUST prefer `.google.com` domain entries for `__Secure-1PSID` and `__Secure-1PSIDTS`. `silentRefresh` MUST merge polled cookies by `(name, domain, path)` upsert rather than wholesale overwrite.
- `silent-refresh-tightening`: `silentRefresh` cookie persistence MUST be an upsert merge, not a replacement. The L2 snapshot extraction already uses strict `.google.com` domain matching; this change extends domain-awareness to the persistence path.

## Impact

- **Code touched:** `src/services/cookie-storage-service.ts` (domain-scoped `loadCookiesForProfile`), `src/services/auth-service.ts` (merge in `silentRefresh`)
- **APIs / public surface:** none — `loadCookiesForProfile` returns the same `LoadedCookies` shape; `silentRefresh` returns `boolean` as before
- **Dependencies:** none new
- **Test baseline:** Two new red tests on branch `prototype/phantom-smoke-harness` lock the B1+B2 false-positive and B3 4→3 corruption; both flip green when fixes land
- **Conformance:** `gemiterm list` non-interactive output unchanged
