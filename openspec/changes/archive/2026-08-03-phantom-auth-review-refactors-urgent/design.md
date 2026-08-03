## Context

The `phantom-auth-ultimate-fix` code review (commit `99af2dc` and later) surfaced three warning-severity correctness issues in the L1 RotateCookies and L2 headless refresh paths:

1. **Single-header `set-cookie` parsing** (`cookie-rotation.ts:125`). `response.headers.get("set-cookie")` returns only the first `Set-Cookie` header per the Fetch API spec. When Google responds with multiple `Set-Cookie` headers (e.g., `__Secure-1PSIDTS`, `__Secure-3PSIDTS`, `SIDCC`), only the first is captured. Bun supports `response.headers.getSetCookie()` which returns all values as a `string[]`.

2. **Inconsistent domain matching** (`auth-service.ts:219-224` vs `cookie-rotation.ts:34-38`). `cookie-rotation.ts` uses strict `normalized === ".google.com"` via `isGoogleDomainCookie`. `auth-service.ts` uses `(c.domain ?? "").endsWith("google.com")` which matches `somethinggoogle.com`. These two sites must agree on what constitutes a Google auth cookie.

3. **`CookieStorage.save` bypass** (`cookie-rotation.ts:142`). The spec says "save via `saveCookiesForProfile`" but the code calls `CookieStorage.save(profileName, next)` directly. If `saveCookiesForProfile` gains bookkeeping logic (freshness recalculation, last-used timestamps), L1 rotation will silently bypass it.

Current state verified at HEAD (`87178cb`).

## Goals / Non-Goals

**Goals:**
- Fix `set-cookie` parsing to capture all response headers via `getSetCookie()`.
- Unify domain matching between `cookie-rotation.ts` and `auth-service.ts` on the strict `.google.com` check.
- Route L1 persistence through `CookieStorageService.saveCookiesForProfile`.
- Fix the spec typo (`[000,...]` → `[0,...]`) in the POST body.
- Add test coverage for multi-header responses and domain edge cases.
- Zero test-count regression; 901-test baseline stays green.

**Non-Goals:**
- No changes to the `CookieMonitor` polling loop or the `requireRotation` parameter semantics.
- No restructuring of `cookie-rotation.ts` internals beyond the three fixes.
- No changes to the `phantom-auth-review-refactors` change (which handles cookie-constants extraction, `gimme` helper lift, and io.ts call-site compliance).
- No spec typo fix in the POST body literal `[000,...]` — the code already uses `[0,...]` correctly; only the spec document needs updating.

## Decisions

### D1. `getSetCookie()` over `get("set-cookie")`

**Choice:** Replace `response.headers.get("set-cookie")` with `response.headers.getSetCookie()` and parse each element of the returned array.

**Rationale:** `Headers.get()` for `set-cookie` is specified to return only the first value (https://fetch.spec.whatwg.org/#concept-header-get). `Headers.getSetCookie()` is the correct API for multi-valued Set-Cookie headers. Bun supports it. The current code only parses one header, so if Google returns `__Secure-3PSIDTS` and `SIDCC` in separate headers (which is standard HTTP behavior), they are silently dropped.

**Alternatives considered:**
- Manual `getAll("set-cookie")` — rejected: `getSetCookie()` is the idiomatic Bun/Fetch API.
- Leaving as-is — rejected: multi-header response will silently lose cookies.

### D2. Lift `isGoogleDomainCookie` to shared import

**Choice:** Export `isGoogleDomainCookie` from `cookie-rotation.ts` and import it in `auth-service.ts`. (If `phantom-auth-review-refactors` lands first and moves it to `cookie-constants.ts`, import from there instead.)

**Rationale:** The two-site inconsistency is a latent bug. `endsWith("google.com")` matches `somethinggoogle.com`, `notgoogle.com`, etc. The strict check `normalized === ".google.com"` is correct for Google's auth cookie scoping. Unifying on one function eliminates the drift risk.

**Impact on auth-service.ts:** The snapshot extraction at lines 219-224 has fallback logic (`?? stored.find((c) => c.name === "__Secure-1PSID")?.value ?? ""`) that catches cookies without a `.google.com` domain. With strict matching, this fallback still works — the `isGoogleDomainCookie` filter is applied first, and if no `.google.com` match exists, the fallback finds any cookie by name. No behavioral change for existing valid profiles.

### D3. `CookieStorageService.saveCookiesForProfile` over `CookieStorage.save`

**Choice:** Add `cookieStorageService: CookieStorageService` to the `RotateCookiesOptions` interface and call `cookieStorageService.saveCookiesForProfile(profileName, merged)` instead of `cookieStorage.save(profileName, merged)`.

**Rationale:** The spec explicitly says "save via `saveCookiesForProfile`." The current code bypasses this, going to the raw storage layer. If `saveCookiesForProfile` gains additional behavior (e.g., updating freshness metadata, emitting telemetry), L1 rotation would silently skip it.

**Alternatives considered:**
- Keep `CookieStorage.save` — rejected: violates spec contract and creates a maintenance trap.
- Add bookkeeping to `CookieStorage.save` itself — rejected: `saveCookiesForProfile` is the intended service-level entry point.

## Risks / Trade-offs

- **[Risk] `getSetCookie()` availability.** The API is available in Bun 1.0+ and all modern Fetch implementations. No risk for this project (requires Bun 1.3+ per `package.json`). **Mitigation:** Already verified in Bun 1.3.14.
- **[Risk] `saveCookiesForProfile` semantics differ from `CookieStorage.save`.** If `saveCookiesForProfile` does additional work (e.g., filtering, validation), it might reject the merged cookie set. **Mitigation:** `saveCookiesForProfile` currently wraps `CookieStorage.save` with minimal overhead; the merge result is a valid cookie array.
- **[Risk] Strict domain matching breaks edge cases.** Profiles with cookies stored without a leading dot (e.g., `google.com` instead of `.google.com`) would be excluded by the strict check. The `isGoogleDomainCookie` normalizes `google.com` to `.google.com` before comparison, so this is handled. **Mitigation:** Verify the normalization logic in tests.

## Migration Plan

- **Backward compatibility:** No public API changes. `rotateCookies` options gain a new field (`cookieStorageService`), but the interface is not exported to consumers — only called by `AuthService`.
- **Rollout:** Single commit covering all three fixes.
- **Rollback:** Revert the commit. No data migration.
- **Interaction with `phantom-auth-review-refactors`:** If `phantom-auth-review-refactors` lands first and exports `isGoogleDomainCookie` from `cookie-constants.ts`, this change should import from there instead of `cookie-rotation.ts`. The task list notes this dependency.
