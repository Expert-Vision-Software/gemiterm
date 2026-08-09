# Design — `prevent-auth-complexities`

## Architectural choice

The post-v2.4.0 auth architecture on `main` and `phase0-v2/regression-net` was built to solve two real bugs plus an overcorrection layer:

| Layer | What it fixed | Status on `prevent-auth-complexities` |
|---|---|---|
| `6bc51f6` full-jar capture | CookieMonitor trimmed to REQUIRED_COOKIES → lost companion cookies → `listChats` returned empty | Already cherry-picked at `2076e52` |
| `CookieStorageService.checkCookieFreshness` 7-day PSIDTS gate | dormant-session force-prompt | **Removed in this change** |
| `models()` probe + `silentRefresh` cascade | (overcorrection) | Not on this branch — skipped |
| `RotateCookies` L1 ladder | (overcorrection) | Not on this branch — skipped |

This change takes the branch to the **v2.4.0 + full-jar fix** posture and stops. Future work (401-triggered recovery, etc.) lives in separate changes tracked under `openspec/changes/`.

## Why the freshness gate was a defect, not a feature

`checkCookieFreshness` read the **local `expires` timestamp** of the `__Secure-1PSIDTS` cookie. The Gemini auth server does not honor this timestamp as a session-lifetime bound:

- PSID cookies are issued with a one-year horizon by the server.
- PSIDTS may be issued with a 7-day or shorter `expires` in the `Set-Cookie` header, but the server-side session remains valid as long as PSID is valid.
- Server-side PSIDTS rotation happens passively (via the SDK's `set-cookie` merging during `client.init()`); the on-disk PSIDTS is a snapshot, not a deadline.

Reading the on-disk PSIDTS `expires` as "session deadline" produces false positives whenever a user is dormant for longer than 7 days. The new posture: the on-disk cookie is **trustworthy enough to attempt** the API call. If the API actually returns 401, surface `AuthenticationError` and let the user re-auth. v2.4.0 worked this way and 12-day-old sessions functioned correctly.

## Why the rename

`ProfileManager.hasValidCookies` is a lie after the freshness gate is removed: the method only checks that `__Secure-1PSID` and `__Secure-1PSIDTS` are present in the cookie list. It does not check expiry, freshness, or server-side validity. Renaming to `hasRequiredCookies` aligns the public name with the actual behavior and makes future readers less likely to assume a freshness check is happening.

The rename is mechanically simple: 1 method definition, 4 call sites, 4 test references. The behavior change is documented in the test names themselves ("returns true when required cookies are present (trusts cookies, ignores expires)").

## Why the dead-code removal

`CookieStorageService.checkCookieFreshness` ([src/services/cookie-storage-service.ts:58-66](src/services/cookie-storage-service.ts#L58-L66)) had no callers on this branch before the change. Its test block at [tests/services/cookie-storage-service.test.ts:174-213](tests/services/cookie-storage-service.test.ts#L174-L213) was the only remaining reference. Leaving the production code in place would create a false signal: a future reader sees a freshness-check method, assumes something is using it, and either re-introduces a caller or fails to remove the dead code in a future cleanup.

The `COOKIE_EXPIRY_THRESHOLD_MS` constant in the same file is removed for the same reason. A second copy in [src/services/gemini-client-wrapper.ts:71](src/services/gemini-client-wrapper.ts#L71) is **kept** because `persistRefreshedCookies` uses it to set the saved cookie `expires` field — that use is independent of the freshness gate and is left to a future change.

## What is NOT in this change

- No `silentRefresh`, no `RotateCookies`, no `models()` probe, no `hasStoredCookies`. These belong to the overcorrection stack on `main` / `phase0-v2/regression-net` and are explicitly out of scope.
- No 401 recovery implementation. The new posture *requires* 401-triggered recovery to be useful, but the implementation is a separate change. Until then, real session death surfaces as `AuthenticationError` from the SDK's `AuthError` translation.
- No relaxation of `hasRequiredCookies` to only require PSID. PSIDTS-absence currently returns `false` from `hasRequiredCookies` but `loadCookiesForApi` returns `null` for PSIDTS — an inconsistency to address in a follow-up.
- No `cookie-rotation.ts` fix. The missing-module error is pre-existing on `2076e52` and causes 4 smoke-test failures and 4 unhandled errors. Unrelated to this change.
- No OpenSpec main-spec sync. The committed main specs in [openspec/specs/auth/spec.md](openspec/specs/auth/spec.md) and [openspec/specs/storage/spec.md](openspec/specs/storage/spec.md) still describe the 7-day freshness requirement. The spec delta lives in [openspec/changes/prevent-auth-complexities/specs/](openspec/changes/prevent-auth-complexities/specs/) (see [proposal.md](./proposal.md) Capabilities section). A future `openspec-sync-specs` pass will fold the delta into the main specs.

## Test strategy

Three test files updated, all directly affected by the behavior change:

- `tests/infrastructure/storage.test.ts` — `hasRequiredCookies` (renamed) returns `true` for expired cookies, `loadCookiesForApi` returns cookie values for expired cookies. New test added: `hasRequiredCookies returns false when required cookies are missing` (covers the PSID-only edge case).
- `tests/services/profile-auth-manager.test.ts` — `ensureAuthenticated` returns cookies for expired sessions, `getActiveProfiles` returns profiles whose required cookies are present (expired or not), `findProfileForConversation` probes all profiles with required cookies (no longer skips expired ones).
- `tests/services/cookie-storage-service.test.ts` — `checkCookieFreshness` describe block removed entirely (function deleted). `makeStaleCookies` helper removed (only used by the deleted block).

Pre-existing test failures (4 smoke tests + 1 ContinueCommand test = 4 unique failures, 4 unhandled errors between tests) are all caused by the missing `cookie-rotation.ts` module. They exist at `2076e52` before this change. Out of scope.
