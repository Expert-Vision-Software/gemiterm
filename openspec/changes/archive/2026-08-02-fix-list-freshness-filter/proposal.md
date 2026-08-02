## Why

`gemiterm list -i` (and `list --all-profiles`) silently returns "No conversations found." when the default profile's cookies fall inside the 1-hour freshness grace window added by `auth-cookie-freshness-fix`. The cause is a semantic conflation in `ListChatsQueryHandler.handle()`: it uses `ProfileManager.hasValidCookies()` to gate the per-profile query, but `hasValidCookies()` combines *structural validity* AND *freshness*, while the listing filter only needs the former.

This is a regression introduced by `api-resilience-error-handling` (commit `05da155`) layered on top of the 1-hour threshold from `auth-cookie-freshness-fix`. The intent of the filter was to skip profiles that have **never** logged in (to avoid hangs), not to skip profiles whose cookies are structurally valid but near expiry. The auto-lifecycle flow in `ProfileAuthManager.ensureAuthenticated` already handles near-expiry cookies via `silentRefresh` for the default profile, before any client is built.

## What Changes

- **New `ProfileManager.hasStoredCookies(name)`** — checks only structural validity (cookie file exists and contains both `__Secure-1PSID` and `__Secure-1PSIDTS`). Returns `false` for missing profiles, missing files, or malformed cookies. Does NOT consult the freshness check.
- **`ProfileManager.hasValidCookies(name)` semantics unchanged** — still combines structural validity AND freshness. Used by callers that genuinely need to know "can this profile authenticate right now" (e.g. `ProfileAuthManager.ensureAuthenticated` which auto-extends, `ProfileService.getAuthStatus` for status reporting).
- **`ProfileManagerForQuery` interface exposes `hasStoredCookies`** (replaces `hasValidCookies`). `ListChatsQueryHandler.handle()` calls `hasStoredCookies` in the `allProfiles` branch.
- **Refactor `ProfileManager`** — extract private `hasValidStoredCookies(name)` (load + structural validate) and `hasFreshCookies(name)` (load + freshness check). Both public methods compose these primitives to remove duplicated try/load/validate/catch boilerplate.

## Capabilities

### Modified Capabilities

- `multi-profile-conversations` — `list --all-profiles` / `list -i` SHALL skip profiles that have no stored authentication cookies, but SHALL NOT exclude profiles whose stored cookies are within the 1-hour freshness grace window. The freshness gate stays on `hasValidCookies` for callers that load cookies for API use; the listing filter no longer consults it.

## Impact

- **Source files**:
  - `src/infrastructure/storage.ts` — new `hasStoredCookies(name)`; refactor `hasValidCookies`; add private `hasValidStoredCookies` / `hasFreshCookies` helpers
  - `src/core/query-handlers.ts` — `ProfileManagerForQuery` swaps `hasValidCookies` → `hasStoredCookies`; `ListChatsQueryHandler.handle()` uses `hasStoredCookies` in the `allProfiles` branch
- **Test files**:
  - `tests/infrastructure/storage.test.ts` — 4 new tests for `hasStoredCookies` (fresh cookies, near-expiry cookies, missing required cookie name, missing profile)
  - `tests/core/query-handlers.test.ts` — mock interface swap (5 sites); new test `"allProfiles includes profiles with near-expiry cookies (no freshness gate for listing)"`
- **Spec files**: `openspec/specs/multi-profile-conversations/spec.md` — modified requirement (delta in this change folder).
- **Sensitive area**: No files in `src/services/{auth-service,cookie-monitor,playwright-cli-driver,cookie-storage-service}.ts` are touched. Prompt-layer facade (`src/cli/utils/prompts.ts`) untouched. Path mediation (only `path-utils.ts` / `io.ts` may import `node:fs`) untouched.
- **No public CLI surface change** — `gemiterm list`, `gemiterm list -i`, `gemiterm list --all-profiles` byte-compatible for the common case where the user has logged in. The only observable difference is that near-expiry profiles no longer get excluded from listing.
