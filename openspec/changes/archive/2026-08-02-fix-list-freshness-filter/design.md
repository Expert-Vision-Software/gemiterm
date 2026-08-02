## Context

`ListChatsQueryHandler.handle()` filters profiles in the `allProfiles` branch using `profileManager.hasValidCookies(name)`. This check returns `false` for profiles whose `__Secure-1PSIDTS` cookie expires within the 1-hour grace window. Combined with the auto-`allProfiles` toggle in `ListCommand.parseArgs` (lines 318-320) when `-i` is used without `-p`, every near-expiry user sees "No conversations found." for the default profile.

The `hasValidCookies()` method was originally used by `ProfileAuthManager.ensureAuthenticated()` (before the auto-lifecycle change), where the semantic "valid for API use right now" is correct. When `api-resilience-error-handling` reused `hasValidCookies` for the listing filter, it imported the freshness semantic into a context where freshness is irrelevant: the listing layer's job is to enumerate candidates; the freshness decision belongs to the layer that actually loads cookies for the API call.

The auto-lifecycle flow (`ProfileAuthManager.ensureAuthenticated`) already handles near-expiry cookies for the **default profile** via `silentRefresh`, transparently extending the session before any client is built. The remaining case (non-default profiles queried via `client.forProfile(name).listChats()`) does NOT auto-extend — `cookieStorageService.loadCookiesForProfile(name)` only checks for `__Secure-1PSID` presence, not freshness. So this fix restores the default-profile flow without changing the non-default-profile flow. Non-default profiles with near-expiry cookies that fail at the API layer are caught by `Promise.allSettled` in the handler and surfaced as warnings, not as an empty list.

## Goals / Non-Goals

**Goals:**
- Restore "show chats" behavior on `gemiterm list -i` for users whose default profile's cookies are inside the 1-hour grace window
- Preserve the original intent of the filter: skip profiles with **no stored cookies**, to avoid hangs from never-logged-in profiles
- Keep `hasValidCookies()` semantics unchanged for its existing callers (`ProfileAuthManager`, `ProfileService.getAuthStatus`, etc.) — the freshness gate is correct there
- Refactor the small amount of duplicated try/load/validate/catch boilerplate between `hasValidCookies` and the new `hasStoredCookies`

**Non-Goals:**
- Adding auto-extend for non-default profiles (that's a larger change; `cookieStorageService.loadCookiesForProfile` does not consult freshness)
- Renaming `hasValidCookies` (pre-existing name; the spec says "valid" means "valid for use" which includes freshness for the existing callers — renaming would churn 6+ call sites and risk regressions)
- Changing the 1-hour freshness threshold (owned by `auth-cookie-freshness-fix`)

## Decisions

### 1. New `hasStoredCookies` on `ProfileManager` (not a static helper)

**Decision:** Add `hasStoredCookies(name): boolean` as a public method on `ProfileManager`. Returns `true` iff the cookie file exists for the profile and contains both required cookie names. Does NOT consult `checkCookieFreshness`.

**Alternative considered:** *Make `hasValidCookies` accept an option flag* like `hasValidCookies(name, { checkFreshness: false })`. Rejected — option flags turn predicates into state machines, and `hasValidCookies` already has a clear semantic. A separate method is clearer at call sites.

**Alternative considered:** *Delete the listing filter entirely*. Rejected — the original `api-resilience-error-handling` change added the filter for a reason (avoid hangs from never-logged-in profiles). Removing it would regress that intent.

### 2. Refactor to private `hasValidStoredCookies` + `hasFreshCookies`

**Decision:** Extract two private helpers — `hasValidStoredCookies(name)` (load + structural validate) and `hasFreshCookies(name)` (load + freshness check). `hasValidCookies` becomes `hasValidStoredCookies(name) && hasFreshCookies(name)`. `hasStoredCookies` becomes `hasValidStoredCookies(name)`.

**Rationale:** Both public methods need the same load-or-return-false boilerplate. The structural-check helper has two callers; the freshness helper has one. Loading twice for `hasValidCookies` (once in each helper) is acceptable because (a) it's the same call shape, (b) the disk cost is negligible (one small JSON read), (c) the alternative — caching the loaded cookies across helpers — would require restructuring the method signatures.

### 3. `ProfileManagerForQuery` interface swap, not extension

**Decision:** Replace `hasValidCookies(name)` with `hasStoredCookies(name)` on the `ProfileManagerForQuery` interface in `src/core/query-handlers.ts`. Concrete `ProfileManager` satisfies both.

**Rationale:** The interface is the minimal contract the query handler needs. It shouldn't be a kitchen sink of methods. Keeping it small (only `hasStoredCookies` and `list`) documents the handler's actual needs. Callers that want `hasValidCookies` use `ProfileManager` directly.

### 4. Spec accuracy for the new 1-hour grace scenario

**Decision:** The new scenario asserts that the **default profile** in the 1-hour grace window IS queried (not skipped by the filter). It notes that any needed silent refresh happens in `ProfileAuthManager.ensureAuthenticated` for the default profile only. It does NOT promise auto-extend for non-default profiles.

**Rationale:** Per the `api-resilience-error-handling` design, `client.forProfile(name)` does not auto-extend. Spec scenarios should match what the code does, not aspirational behavior.

## Risks / Trade-offs

- **[Trade-off] Non-default profiles with near-expiry cookies may fail at the API layer** — if a non-default profile's `__Secure-1PSIDTS` is inside the 1-hour grace window, the listing will attempt the API call (because `hasStoredCookies` is true), the call may fail with an auth error from Gemini, and `Promise.allSettled` catches the error and logs a warning. Mitigation: this matches existing behavior for non-default profiles that genuinely have stale sessions; the user sees a warning per failed profile, not "No conversations found." Across all profiles.
- **[Trade-off] Slight method-call duplication** — `hasValidCookies` calls `hasValidStoredCookies` AND `hasFreshCookies`, each of which loads cookies from disk. Two reads of the same small JSON file. Negligible cost; alternative (parameterize to pass cookies in) would obscure the public API.
- **[No-op risk] If the 1-hour freshness check is later changed** — this fix is robust to that. The listing filter no longer consults freshness at all, so changes to `COOKIE_EXPIRY_THRESHOLD_MS` only affect callers that explicitly need freshness (e.g. `ProfileAuthManager.ensureAuthenticated`).

## Open Questions

- None.
