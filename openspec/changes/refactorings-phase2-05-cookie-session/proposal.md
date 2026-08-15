## Why

The cookie lifecycle is scattered across five modules with triplicated constants, three divergent expiry computations, no transactional sync between the SDK's live cookie jar and persisted state, and passive-only refresh — the structural root beneath the phantom-auth bug class ("models() works but listChats returns 0"). This change collapses the lifecycle into a single deep `CookieSession` module so every load and every write flows through one seam — and then uses that seam to fix a small, explicitly-enumerated set of faulty behaviors that the scattered structure made impossible to fix in one place.

It is the last remaining candidate from `docs/refactorings-phase-2.html` (#1). Scope was grilled item-by-item in review: structural consolidation plus four bounded functional improvements; one candidate improvement was rejected with rationale (design D7).

Duplication inventory (revalidated at v2.4.2 HEAD):

- `COOKIE_EXPIRY_THRESHOLD_MS` (7 days) defined identically in `src/services/cookie-storage-service.ts:5`, `src/services/gemini-client-wrapper.ts:69`, and `src/infrastructure/storage.ts:14`.
- Three divergent expiry computations: `storage.ts:25` (max over `__Secure-1PSID` + `__Secure-1PSIDTS`), `cookie-storage-service.ts:68` (`__Secure-1PSIDTS` only), `auth-service.ts:187` (`__Secure-1PSIDTS` only).
- Validation/freshness duplicated between `CookieStorageService` methods and module functions in `storage.ts:20,41`.
- No single jar↔disk boundary: `GeminiClientService.persistRefreshedCookies()` (`gemini-client-wrapper.ts:117-150`) is invoked from 7 internal call sites; `AuthService.extractCookies` (`auth-service.ts:152-156`) writes raw `CookieStorage.save()`, bypassing the service layer entirely.

## What Changes

**Structural (no user-perceivable effect):**

- **New `CookieSession` module** (`src/services/cookie-session.ts`) — single owner of the cookie lifecycle:
  - `ensureSession(profile)` — the **only** load path: load, two-tier validate (primary `__Secure-1PSID` binding; secondary `__Secure-1PSIDTS` binding), run the typed recovery ladder, resolve `{ cookies, secure1psid, secure1psidts, expiresAt }`.
  - `commit(...)` — the **only** persistence path, in two input modes: auth-capture (`entries`) and wrapper jar-merge (`{ jar }`).
  - `sessionStatus(profile)` — pure read for status-style callers.
  - Two-tier validation with the same boolean outcomes as today's rules; both preserved expiry semantics in one home (`sessionExpiry` max-over-both for status; `psidtsExpiry` for the auth line); injectable clock and rotator.
- **Writer migration** — `persistRefreshedCookies` (7 call sites) and `AuthService.extractCookies` route through `commit`.
- **Reader migration** — `ProfileAuthManager.ensureAuthenticated`, `ProfileManager.hasValidCookies`/`loadCookiesForApi`/`getStatus` delegate to CookieSession with byte-identical outcomes and error messages.
- **Deletions** — `cookie-storage-service.ts` deleted; wrapper constant + merge logic deleted; `storage.ts` slims to raw persistence. On-disk `{ cookies: [...] }` layout preserved.

**Functional improvements (explicitly approved, each fixing faulty behavior):**

1. **Fail-fast on PSID-less capture** — an auth capture missing `__Secure-1PSID` can never yield a working session; today it silently saves partial cookies (printing `Has __Secure-1PSID: ❌`) and every later command fails confusingly. `commit` (capture mode) now rejects it: nothing written, `authenticate`/`renew` throw an actionable retry error.
2. **Uniform expiry stamping** — all persisted writes stamp tracked cookies' `expires` to `now + 7 days` (the single freshness constant), matching the wrapper's existing model. Fixes the phantom-capture bug where Google issues `__Secure-1PSIDTS` with a short TTL (~600 s): today such a capture lands on disk already failing the 7-day freshness check, so `gemiterm auth` "succeeds" and the very next command reports an expired session.
3. **Skip-unchanged writes** — an identical re-capture no longer rewrites the profile file; pointless writes (and the mtime/`lastUsedAt` distortion they cause in `gemiterm status`) disappear.
4. **Proactive cookie rotation (gated)** — an in-repo `POST https://accounts.google.com/RotateCookies` (precedent: upstream `HanaokaYuzu/Gemini-API` `rotate_1psidts`; the SDK exposes no rotation API) refreshes `__Secure-1PSIDTS` using only the long-lived `__Secure-1PSID`. At most one attempt per `ensureSession`, min-interval rate limit, failures never invalidate a working session. Ships **disabled by default** until the live request envelope is captured and verified (implementation gate task); the ladder degrades to pre-change behavior until then.

**Rejected (see design D7):** switching the auth "Session expires" line to max-over-both expiry — `__Secure-1PSIDTS` is the binding that actually gates usability; max-over-both would overstate session health. The line keeps the PSIDTS read (now reflecting the stamped 7-day value).

## Capabilities

### New Capabilities

- `cookie-session`: The `CookieSession` module — the `ensureSession(profile)` load contract, the single `commit` persistence path with both input modes and their gating/stamping/skip semantics, two-tier validation, the recovery ladder with gated rotation, both preserved expiry computations, and the injectable clock.

### Modified Capabilities

- `auth`: The four `CookieStorageService` requirements are removed with the class; `AuthService.authenticate`/`renew` persist via `commit` (fail-fast on PSID-less capture, stamped expiry, skip-unchanged) and throw the new actionable error on rejected captures; `ProfileAuthManager.ensureAuthenticated` delegates to `ensureSession` (same throw contract, byte-identical messages).
- `storage`: `CookieStorage` slims to raw persistence; the `Freshness and Validity` requirement and helpers are relocated to `cookie-session`; `ProfileManager.hasValidCookies`/`loadCookiesForApi`/`getStatus` keep their observable contracts but source validation/expiry from `cookie-session`.
- `gemini-client`: `GeminiClientService` persists refreshed cookies exclusively through `CookieSession.commit`; the 7 internal call sites collapse to the one seam; caller-side change detection retained.

## Impact

- **Code touched**: `src/services/cookie-session.ts` (**new**); `gemini-client-wrapper.ts` (delete constant + merge internals; 7 call sites → `commit`); `auth-service.ts` (capture via `commit`; delete private `getCookieExpiry`); `profile-auth-manager.ts` (delegate to `ensureSession`); `storage.ts` (delete constant + 3 helpers; `ProfileManager` consumes session functions); `cli/index.ts` (wiring); `cookie-storage-service.ts` (**deleted**).
- **Sensitive area** — `auth-service.ts` and `cookie-storage-service.ts` are in the AGENTS.md regression gate; re-read their service-level tests before implementing. `cookie-monitor.ts` and `playwright-cli-driver.ts` are not modified.
- **User-visible changes** — enumerated exhaustively: (1) PSID-less captures now fail at capture time with a retry message (previously silent partial save + later confusing failures); (2) the auth "Session expires" line now shows capture-time + 7 days (previously the browser-provided `__Secure-1PSIDTS` TTL, which could print minutes); (3) identical re-captures no longer bump the profile file's mtime. Everything else — CLI output, error messages, on-disk layout, network behavior absent rotation enablement — is byte-identical. CHANGELOG entry required.
- **Coordination** — no overlap with in-flight `chat-list-bulk-actions`. Sequenced after `2026-08-14-refactorings-phase2-01..04` (all archived).
- **Dependencies** — none new; rotation is a direct `fetch` (no SDK support — it only passively absorbs `Set-Cookie` headers into its public jar).
- **Test baseline** — 657 pass / 0 fail at proposal time; count moves when `tests/services/cookie-storage-service.test.ts` is replaced by `tests/services/cookie-session.test.ts`. Update open changes' baseline numbers.
