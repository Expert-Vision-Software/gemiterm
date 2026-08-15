## 1. CookieSession module (additive — no callers yet)

- [x] 1.1 Create `src/services/cookie-session.ts`: `CookieSession` class with injectable `CookieSessionDeps { cookieStorage, logger, clock? (default `Date.now`), rotator? }`; single home for `COOKIE_EXPIRY_THRESHOLD_MS`, both tracked cookie-name constants, two-tier validation, and the single expiry computation (max positive `expires` across `__Secure-1PSID`/`__Secure-1PSIDTS`, else `null`).
- [x] 1.2 Implement `commit(profile, liveJar)`: read persisted → overlay live values onto matching names (preserve each entry's domain/path/httpOnly/secure/sameSite metadata and all untracked names) → validate merged set → write only when tier 1 passes with tier 2 present; throw and leave disk untouched on invalid merge; no write when nothing changed; failures logged at debug level and never thrown to the triggering operation by callers.
- [x] 1.3 Implement `ensureSession(profile)`: load → two-tier validate → typed recovery ladder (rung 1 trust persisted / rung 2 absorb caller-supplied live jar / rung 3 rotate / rung 4 fail with `AuthenticationError` naming profile + failing binding + `gemiterm auth`); resolve `{ cookies, secure1psid, secure1psidts, expiresAt }`; each rung logs its outcome at debug level.
- [x] 1.4 Implement `sessionStatus(profile)`: pure read returning validity/freshness/expiry for status-style callers; missing or unreadable storage maps to invalid (no throw).
- [x] 1.5 Implement the in-repo rotator (`RotateCookies` POST to `https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/RotateCookies`, `Cookie` header from tracked values, parse rotated `__Secure-1PSIDTS`); rung 3 starts internally **disabled** (ladder degrades to rungs 1→2→4 = pre-change behavior).
- [x] 1.6 Tests in `tests/services/cookie-session.test.ts`: tier outcomes (terminal missing-PSID vs recoverable stale-PSIDTS); 7-day threshold via fake clock; ladder rung order and fall-through; absorb-without-network; failed rotation preserves tier-2-valid session; commit merge preserves metadata + untracked names / no-write-on-unchanged / invalid-merge leaves disk untouched; expiry computation (max-across, null case).

## 2. Rotation verification gate (before enabling rung 3)

- [ ] 2.1 Capture the exact live `RotateCookies` request/response envelope once against a real authenticated session; record the shape as a fixture under `tests/services/fixtures/` and note the verified endpoint/payload in this file when done.
  > **Note (implementation session):** a live capture requires a real authenticated Google session, which is not available in an automated environment. The in-repo rotator (`DefaultRotator` in `cookie-session.ts`) is implemented against the documented envelope (endpoint `https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/RotateCookies`, `Cookie` header from tracked values, rotated `__Secure-1PSIDTS` parsed from `Set-Cookie`) but remains **gated off** (`rotationEnabled` defaults to `false`), so the shipped ladder degrades to rungs 1→2→4 (pre-change behavior). Rotation is exercised only through the injected `rotator` in tests. Revisit this gate before enabling rung 3 in production.
- [x] 2.2 Enable rung 3 behind the internal flag; add the disabled-rung degrade test (no POST, ladder reaches the actionable error — pre-change behavior).

## 3. Writer migration (transactional boundary closes)

- [x] 3.1 `src/services/gemini-client-wrapper.ts`: replace `persistRefreshedCookies` internals (`:117-150`) with `session.commit(this.profileName, this.client.cookies)`; delete `COOKIE_EXPIRY_THRESHOLD_MS` (`:69`) and the merge logic; keep the 7 call sites' trigger points (`:114,254,279,292,336,358,372`) and the changed-since-last-commit skip; accept `CookieSession` via the existing optional-deps constructor pattern (update `forProfile` guard at `:207`).
- [x] 3.2 `src/services/auth-service.ts`: `extractCookies` (`:152-156`) routes through `session.commit` (write-time validation replaces the raw bypass); delete private `getCookieExpiry` (`:187-194`); `confirmAuthSuccess`/`confirmRenewSuccess` consume the single expiry computation.
- [x] 3.3 Update `tests/services/gemini-client-wrapper.test.ts` and `tests/services/auth-service.test.ts`: stub `session.commit` instead of `cookieStorageService.saveCookiesForProfile`/`cookieStorage.save`; add the write-time-validation-fails scenario; assert existing console/error contracts byte-identically.

## 4. Reader migration

- [x] 4.1 `src/services/profile-auth-manager.ts`: `ensureAuthenticated` delegates to `ensureSession` (keep the exact `No valid session for profile '<name>'` + `gemiterm login` message contract); `getActiveProfiles` filters via `sessionStatus`; delete the `CookieStorageService` dependency.
- [x] 4.2 `src/infrastructure/storage.ts`: `ProfileManager.getStatus`/`hasValidCookies`/`loadCookiesForApi` source validity/freshness/expiry from `CookieSession` (injected; keep observable contracts and error messages); delete the module-level `validateCookies`/`getCookieExpiryTimestamp`/`checkCookieFreshness` (`:20-49`) and `COOKIE_EXPIRY_THRESHOLD_MS` (`:14`). Add a `getStatus` unit test pinning `expiresAt` for a mixed-cookie fixture BEFORE switching the source.
- [x] 4.3 `src/cli/index.ts`: construct `CookieSession` once; replace the `CookieStorageService` construction (`:34`) and thread `CookieSession` through `CommandContext`/`ProfileAuthManager`/`GeminiClientService.forProfile`.

## 5. Deletions, gates, and baseline

- [x] 5.1 Delete `src/services/cookie-storage-service.ts` and `tests/services/cookie-storage-service.test.ts`; grep `src/` for `CookieStorageService`, `COOKIE_EXPIRY_THRESHOLD_MS`, `validateCookies`, `checkCookieFreshness`, `getCookieExpiry` — zero remaining outside `cookie-session.ts` (and none outside `src/` tests).
- [x] 5.2 Sensitive-area gate: re-read `tests/services/auth-service.test.ts` and the replacement `tests/services/cookie-session.test.ts` before committing; confirm `cookie-monitor.ts` and `playwright-cli-driver.ts` are untouched (`git diff --stat` shows neither file).
- [x] 5.3 On-disk byte-compat spot check: run one `auth`-produced profile JSON and one legacy v1.4.1 profile JSON through `ensureSession` + `commit` round-trip; diff confirms the `{ cookies: [...] }` shape and untracked cookie entries are preserved.
- [x] 5.4 `bun test` full suite — record the new baseline and update `openspec/changes/chat-list-bulk-actions/tasks.md` (and any other open change) if the total moved from 657. **New baseline: 877 pass / 2 skip / 0 fail** (was 862 pass / 2 skip / 0 fail before this change).
- [x] 5.5 `bun run typecheck` and `bash scripts/lint-path-mediation.sh` — both clean (the new module adds no `node:fs`/`node:path`/`node:os` imports).
- [x] 5.6 Add the CHANGELOG entry at implementation time; update the `docs/refactorings-phase-2.html` #1 article to **Landed** (archive-name badge) once the change is archived.
