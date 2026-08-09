# Design — `prevent-auth-complexities`

## Architectural choice

The post-v2.4.0 auth architecture on `main` and `phase0-v2/regression-net` was built to solve two real bugs plus an overcorrection layer:

| Layer | What it fixed | Status on `prevent-auth-complexities` |
|---|---|---|
| `6bc51f6` full-jar capture | CookieMonitor trimmed to REQUIRED_COOKIES → lost companion cookies → `listChats` returned empty | Already cherry-picked at `2076e52` |
| `CookieStorageService.checkCookieFreshness` 7-day PSIDTS gate | dormant-session force-prompt | **Removed in this change** |
| `models()` probe + `silentRefresh` cascade | (overcorrection) | Not on this branch — skipped |
| `RotateCookies` L1 ladder | (overcorrection) | Not on this branch — skipped |
| `requireRotation` baseline-matching in `CookieMonitor.poll` | (L1/L2 coupling) | **Removed in this change** — no callers; was dead code referencing a non-existent `cookie-rotation.ts` module |

This change takes the branch to the **v2.4.0 + full-jar fix + ship-ready trust-the-cookies** posture. The cookie store trusts the on-disk cookies: if `__Secure-1PSID` is present, the profile is considered authenticated and the API call is attempted. Real session death is detected by an actual 401 from the Gemini API, which now surfaces a clear, profile-specific, actionable `AuthenticationError` message. Future silent-recovery work lives in a separate change.

## Why the freshness gate was a defect, not a feature

`checkCookieFreshness` read the **local `expires` timestamp** of the `__Secure-1PSIDTS` cookie. The Gemini auth server does not honor this timestamp as a session-lifetime bound:

- PSID cookies are issued with a one-year horizon by the server.
- PSIDTS may be issued with a 7-day or shorter `expires` in the `Set-Cookie` header, but the server-side session remains valid as long as PSID is valid.
- Server-side PSIDTS rotation happens passively (via the SDK's `set-cookie` merging during `client.init()`); the on-disk PSIDTS is a snapshot, not a deadline.

Reading the on-disk PSIDTS `expires` as "session deadline" produces false positives whenever a user is dormant for longer than 7 days. The new posture: the on-disk cookie is **trustworthy enough to attempt** the API call. If the API actually returns 401, surface `AuthenticationError` and let the user re-auth. v2.4.0 worked this way and 12-day-old sessions functioned correctly.

## Why the rename

`ProfileManager.hasValidCookies` is a lie after the freshness gate is removed: the method only checks that `__Secure-1PSID` is present in the cookie list. It does not check expiry, freshness, or server-side validity. Renaming to `hasRequiredCookies` aligns the public name with the actual behavior and makes future readers less likely to assume a freshness check is happening.

After the Phase 2 consistency change (only PSID is required, not PSIDTS), the name is even more accurate: PSIDTS-absence no longer makes a profile "invalid", it just means PSIDTS-absence.

## Why the dead-code removal

Three pieces of dead code were removed:

1. `CookieStorageService.checkCookieFreshness` had no callers on this branch before the change. Its test block in [tests/services/cookie-storage-service.test.ts](tests/services/cookie-storage-service.test.ts) was the only remaining reference. Leaving the production code in place would create a false signal: a future reader sees a freshness-check method, assumes something is using it, and either re-introduces a caller or fails to remove the dead code in a future cleanup.
2. The `COOKIE_EXPIRY_THRESHOLD_MS` constant in the same file is removed for the same reason. A second copy in [src/services/gemini-client-wrapper.ts](src/services/gemini-client-wrapper.ts) is **kept** but its value is bumped from 7 days to 1 year (Phase 2 improvement 6.3) so the on-disk `expires` field is consistent with the actual server-issued horizon.
3. `CookieMonitor.requireRotation` and the `isGoogleDomainCookie` import from `./cookie-rotation.ts` were residual L1/L2 stack code that was inadvertently introduced in the cherry-pick `2076e52`. The `cookie-rotation.ts` module never made it onto this branch; the `requireRotation` parameter has no callers anywhere. Removing it eliminates the missing-module import error and 4 pre-existing test failures (3 smoke + 1 continue-command).

## Why the PSID-only relaxation

After dropping the freshness gate, an inconsistency remained: `hasRequiredCookies` required both `__Secure-1PSID` and `__Secure-1PSIDTS` to be present, but `loadCookiesForApi` treated PSIDTS as nullable (it returns `secure_1psidts: null` when PSIDTS is missing). The SDK (`gemini-web-sdk@^2.2.0`) accepts a `secure_1psidts: undefined` cookie; PSID alone is sufficient to attempt an API call. The two checks must agree, so `hasRequiredCookies` and `CookieStorageService.validateCookies` were relaxed to PSID-only. PSIDTS-absence no longer flips a profile to "not authenticated" — it just means a slightly older capture; the API call is attempted and either succeeds or returns 401.

## Why the 1-year `persistRefreshedCookies` horizon

The `gemini-reverse` 2.1.0 upgrade removed the library's explicit cookie-rotation path; passive `set-cookie` merging during `client.init()` is the only refresh mechanism. `GeminiClientService.persistRefreshedCookies` writes the SDK-rotated cookie values back to disk and sets `expires = now + 7 days`. With the freshness gate removed, the 7-day horizon is purely informational — it does not gate any auth path — but it is still visible in `gemiterm status` output. Bumping to 1 year matches the actual PSID server-issued horizon, so a freshly captured profile does not visually appear "near expiry" in `status` output.

## Why removing the `getStatus.isActive` past-expiry filter

`ProfileManager.getStatus` previously computed `isActive = hasRequired && (expiresMs === null || expiresMs > Date.now())`. This applied a hard filter: a profile with `__Secure-1PSID` present but `PSIDTS.expires < now` was reported `isActive: false`. The auth path does not consult `isActive`, so this filter was display-only and produced confusing "inactive" statuses for profiles that would actually work. The new rule: `isActive = hasRequired`. The `expiresAt` field still shows the on-disk expiry timestamp for user reference; it no longer flips `isActive`.

## Why the 401 message improvement

The pre-change `AuthError` → `AuthenticationError` translation produced `"Session expired or invalid. Please run 'gemiterm login' again."` — three problems:

1. The command name `gemiterm login` is wrong; the actual command is `gemiterm auth`.
2. The message does not name the profile. A multi-profile user with three profiles cannot tell which one is the problem.
3. There is no hint that the underlying cause was a 401 from the Gemini API, which contextualizes the failure.

The new message: ``Session for profile '<name>' is no longer valid (Gemini returned 401). Run 'gemiterm auth <name>' to re-authenticate.`` is unambiguous and immediately actionable. Automatic silent-recovery (headless re-auth on 401) is a separate change that requires the L2 stack from `phase0-v2/regression-net`; it is **not** part of this branch's posture.

## What is NOT in this change

- No `silentRefresh`, no `RotateCookies`, no `models()` probe, no `hasStoredCookies`. These belong to the overcorrection stack on `main` / `phase0-v2/regression-net` and are explicitly out of scope.
- No automatic 401 recovery. The new posture requires the user to run `gemiterm auth <profile>` to re-authenticate; the actionable error message makes this straightforward.
- No `cookie-rotation.ts` restoration. The module's L1/L2 machinery is overcorrection for a bug that no longer exists on this branch.
- No OpenSpec main-spec sync. The committed main specs in [openspec/specs/auth/spec.md](../../specs/auth/spec.md) and [openspec/specs/storage/spec.md](../../specs/storage/spec.md) still describe the 7-day freshness requirement. The spec delta lives in [openspec/changes/prevent-auth-complexities/specs/](openspec/changes/prevent-auth-complexities/specs/) (see [proposal.md](./proposal.md) Capabilities section). A future `openspec-sync-specs` pass will fold the delta into the main specs.

## Test strategy

Five test files updated, all directly affected by the behavior changes:

- `tests/infrastructure/storage.test.ts` — `hasRequiredCookies` returns `true` for expired cookies, `loadCookiesForApi` returns cookie values for expired cookies, `getStatus.isActive` is `true` for expired cookies, `getAllStatuses` reports expired profiles as `isActive: true`. New tests: `hasRequiredCookies returns true when only PSID is present` and `hasRequiredCookies returns false when PSID is missing`.
- `tests/services/profile-auth-manager.test.ts` — `ensureAuthenticated` returns cookies for expired sessions, `getActiveProfiles` returns profiles whose required cookies are present (expired or not), `findProfileForConversation` probes all profiles with required cookies (no longer skips expired ones).
- `tests/services/cookie-storage-service.test.ts` — `checkCookieFreshness` describe block removed entirely (function deleted). `makeStaleCookies` helper removed (only used by the deleted block). `validateCookies` test block updated: PSID-only is now `true`; PSID-missing is `false`.
- `tests/services/gemini-client-wrapper.test.ts` — `AuthError → AuthenticationError` test updated to assert the new profile-name + `gemiterm auth <profile>` message; the service is now constructed with a `profileName="work"` so the message is deterministic.
- (No change) `tests/smoke/smoke.test.ts` and `tests/cli/continue-command.test.ts` — the 4 pre-existing test failures caused by the missing `cookie-rotation.ts` module are now fixed (the `requireRotation` dead code was removed in Phase 1, section 3.3). Full suite: 818 pass / 2 skip / 0 fail / 0 errors.
