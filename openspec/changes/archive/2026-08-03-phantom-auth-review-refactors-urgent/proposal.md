## Why

The `phantom-auth-ultimate-fix` code review surfaced three **warning-severity** bugs that ship a correctness risk in production cookie handling. Two are in L1 RotateCookies (single-header Set-Cookie parsing loses cookies; domain matching is inconsistent with the rest of the auth code). One is the `CookieStorage.save` direct-call bypass that skips `CookieStorageService.saveCookiesForProfile` bookkeeping. These are not blockers today (Google's response typically uses a single Set-Cookie per header and `.google.com` domains don't collide with `somethinggoogle.com`), but they will bite when conditions change.

## What Changes

- **Fix single-header `set-cookie` parsing in `cookie-rotation.ts`.** `response.headers.get("set-cookie")` only returns the first `Set-Cookie` header per the Fetch spec. When Google returns `__Secure-1PSIDTS`, `__Secure-3PSIDTS`, and `SIDCC` in separate headers, only the first is captured. Replace with `response.headers.getSetCookie()` (available in Bun) which returns all header values as an array, then parse each entry.

- **Unify domain matching across `auth-service.ts` and `cookie-rotation.ts`.** `cookie-rotation.ts` uses strict `normalized === ".google.com"` matching via `isGoogleDomainCookie`. `auth-service.ts` uses `(c.domain ?? "").endsWith("google.com")` which matches `somethinggoogle.com`. Replace the `endsWith` calls in `auth-service.ts` with a shared `isGoogleDomainCookie` helper (lifted from `cookie-rotation.ts` to `cookie-constants.ts` as part of `phantom-auth-review-refactors`, or imported directly).

- **Route `rotateCookies` persistence through `CookieStorageService.saveCookiesForProfile` instead of `CookieStorage.save`.** The spec says "save via `saveCookiesForProfile`" but the code calls `CookieStorage.save(profileName, next)` directly. If `saveCookiesForProfile` adds bookkeeping (e.g., freshness recalculation, last-used timestamps) in a future change, L1 rotation will silently bypass it.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `silent-refresh-tightening`: MODIFIED — L1 RotateCookies MUST parse all `Set-Cookie` headers (not just the first), and MUST persist via `CookieStorageService.saveCookiesForProfile` (not `CookieStorage.save` directly). Domain matching in `auth-service.ts` L2 snapshot extraction MUST use the same strict `.google.com` check as `cookie-rotation.ts`.

## Impact

- **Code touched**
  - `src/services/cookie-rotation.ts` — replace `headers.get("set-cookie")` with `headers.getSetCookie()`; parse array; replace `CookieStorage.save` with `CookieStorageService.saveCookiesForProfile`; export or share `isGoogleDomainCookie`.
  - `src/services/auth-service.ts` — replace `endsWith("google.com")` with shared `isGoogleDomainCookie` from `cookie-rotation.ts` (or `cookie-constants.ts` if that lands first).
  - `tests/services/cookie-rotation.test.ts` — add multi-Set-Cookie header response test; add domain-matching edge cases.
  - `tests/services/auth-service.test.ts` — verify `isGoogleDomainCookie` used in snapshot extraction.
- **APIs / public surface** — `isGoogleDomainCookie` may need to be exported from `cookie-rotation.ts` (or moved to `cookie-constants.ts` if `phantom-auth-review-refactors` lands first). `rotateCookies` options interface gains a `cookieStorageService` dependency (replacing the raw `CookieStorage`).
- **Dependencies** — none new.
- **Multi-profile** — unaffected; fixes apply uniformly across profiles.
- **TTY** — unaffected.
- **Conformance** — `gemiterm list` non-interactive output unchanged. Full test suite must remain green.
