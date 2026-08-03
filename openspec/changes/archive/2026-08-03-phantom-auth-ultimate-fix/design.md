## Context

The phantom-authentication symptom -- `gemiterm list -i` logging "is
authenticated" while every API call returns `[]` -- has recurred across many
releases, with each fix solving a different sub-problem. The sibling change
`phatom-auth-repro-with-tests` established 5 failing regression tests at the
`ProfileAuthManager` / mock seam that lock down the symptom: (a) server-side
probe not consulted, (b) `silentRefresh` is a no-op, (c) `persistRefreshedCookies`
merges by name only. This change implements the fix that turns those tests green.

The four-layer investigation (`investigation.md`) confirmed:
1. `checkCookieFreshness` (`src/infrastructure/storage.ts:41-49`) -- local-only.
2. `ProfileAuthManager.ensureAuthenticated` -- trusts the local check, never
   probes Google's server.
3. `AuthService.silentRefresh` -- gated behind the local check AND is a no-op
   when the loaded cookies are still valid.
4. `GeminiClientService.persistRefreshedCookies` -- merges by `name` only.

The silent refresh redesign was informed by `teng-lin/notebooklm-py`'s
proven 7-layer auth recovery ladder, which uses `accounts.google.com/RotateCookies`
(a lightweight HTTP POST) as its primary cookie rotation mechanism before falling
back to headless browser and interactive re-auth.

## Goals / Non-Goals

**Goals:**

- Add a server-side validity probe to `ProfileAuthManager.ensureAuthenticated`.
- Replace the single-mechanism headless browser silent refresh with a multi-layer
  ladder (L1: RotateCookies POST, L2: headless browser, L3: reauth prompt).
- Fix `persistRefreshedCookies` to not overwrite cross-domain duplicates.
- Flip the 5 failing regression tests in `tests/services/phantom-auth.test.ts`
  from red to green.
- Bump `docs/testing-baseline.xml`.

**Non-Goals:**

- Modifying `gemini-web-sdk` -- the SDK is an API client, cookie lifecycle
  belongs in gemiterm.
- Multi-profile regression tests.
- Live-network regression tests.
- Refactoring `autoExtendSession` semantics.

## Decisions

### D1. Probe: `listChats({ limit: 1 })` + persisted has-chats flag

The probe uses `geminiClient.listChats({ limit: 1 })`. A per-profile
`profile-has-chats` marker file (empty, sibling to `storage_state.json`)
is written whenever any `listChats` call returns non-empty.

Logic:
- Non-empty -> session valid, write has-chats flag, return.
- Empty + has-chats flag exists -> stale session, trigger silent refresh ladder.
- Empty + has-chats flag absent -> genuinely empty profile, trust local freshness.

The flag is persisted at `$PROFILE_DIR/profile-has-chats` via
`getProfileHasChatsPath(profileName)` in `src/infrastructure/path-utils.ts`.

### D2. Probe cadence: 2.5-minute process-level cache, env-var overridable

Default TTL of 150_000 ms (2.5 min). Overridable via `GEMITERM_PROBE_TTL_MS`.
The cache is a `Map<profileName, { ts: number; result: ProbeResult }>` on the
`ProfileAuthManager` instance (process-local).

### D3. Silent refresh ladder (informed by notebooklm-py)

**L1 -- RotateCookies POST (primary, new).**

`accounts.google.com/RotateCookies` is a Google identity service endpoint that
mints fresh `__Secure-1PSIDTS` cookies in one HTTP round-trip. Verified against
`HanaokaYuzu/Gemini-API` and `teng-lin/notebooklm-py` -- it works for Gemini
sessions because `__Secure-1PSIDTS` is a shared Google identity cookie scoped
to `.google.com`.

Implementation (`src/services/cookie-rotation.ts`):
- Load the full cookie jar from `CookieStorageService.loadAllCookiesForProfile`.
- Serialize to a `Cookie` header.
- POST `[000,"-0000000000000000000"]` as JSON body to
  `https://accounts.google.com/RotateCookies` with headers
  `Content-Type: application/json` and `Origin: https://accounts.google.com`.
- Parse `Set-Cookie` headers from the response to extract new
  `__Secure-1PSIDTS`, `__Secure-3PSIDTS`, and `SIDCC` values.
- Merge updated values into the stored cookies and save via
  `CookieStorageService.saveCookiesForProfile`.
- Return `true` if `__Secure-1PSIDTS` changed; `false` otherwise.

Rate-limiting (three-guard, modeled on notebooklm-py):
1. **Disk-mtime guard:** skip if `storage_state.json` was rewritten within
   the last 600 seconds (the RotateCookies recommended interval).
2. **In-process throttle:** deduplicate concurrent calls via a
   `Map<profileName, Promise<boolean>>` in-flight tracker.
3. **No cross-process flock** needed -- gemiterm is single-process CLI.

Benefits over headless browser:
- Deterministic: either returns fresh cookies or fails (no timing-dependent polling).
- Fast: ~100-500ms vs. 2-30s for browser launch + poll.
- No Playwright dependency for the common refresh path.
- Solves the "no-op rotation" problem at the protocol level.

**L2 -- Headless browser refresh (fallback, hardened).**

Used when L1 fails (RotateCookies returns non-200, or PSIDTS unchanged).
Implements defense-in-depth hardening:
- `silentRefresh` snapshots active cookie values before calling `waitForSilentLogin`.
- `waitForSilentLogin` passes `requireRotation` to `CookieMonitor.start`.
- Both checks (caller comparison + monitor `requireRotation`) gate on actual
  value change, not just cookie presence.
- Returns `true` only when values actually differ; `false` otherwise.

**L3 -- Reauth prompt (existing, unchanged).**

When both L1 and L2 fail, `ensureAuthenticated` throws `AuthenticationError`,
which routes through the existing `promptAndReauth` flow in
`src/cli/index.ts:91-96`.

### D4. `persistRefreshedCookies` merge by `(name, baselineValue)`

The SDK jar (`this.client.cookies`) carries only `Record<string, string>` --
one value per cookie name, no domain info. Match by both `name` AND
`value === this.baselineSecure1psid`:

```typescript
if (c.name === "__Secure-1PSID" && changed1psid && c.value === this.baselineSecure1psid) {
  return { ...c, value: live1psid };
}
```

This ensures only the Google-domain entry (matching the baseline from
construction) is overwritten.

### D5. No belt-and-suspenders throw from `listChats([])`

The probe in `ensureAuthenticated` catches staleness before any command
reaches `GeminiClientService.listChats`. Dropped.

## Boundary: gemini-web-sdk vs. gemiterm

| Concern | Location | Rationale |
|---|---|---|
| API calls (`chats()`, `newChat()`, etc.) | `gemini-web-sdk` | SDK's core purpose |
| CSRF token extraction (`init()`) | `gemini-web-sdk` | Required for API calls |
| Cookie acquisition (browser login) | gemiterm `auth-service.ts` | SDK has no browser integration |
| Cookie persistence (disk) | gemiterm `cookie-storage-service.ts` | SDK has no filesystem surface |
| Cookie rotation (`RotateCookies`) | gemiterm `cookie-rotation.ts` | SDK has no cookie lifecycle |
| Session refresh (headless browser) | gemiterm `auth-service.ts` | SDK has no browser integration |
| Multi-profile management | gemiterm `ProfileManager` | SDK is single-session |

The `gemini-web-sdk` constructor accepts `secure_1psid` and proxy -- that's the
correct and complete auth interface. Everything else is cookie lifecycle, which
lives in gemiterm.

## Risks / Trade-offs

- **[Risk] RotateCookies is an undocumented Google endpoint.** Mitigation:
  verified in production by `notebooklm-py` and `HanaokaYuzu/Gemini-API`.
  If Google changes it, L2 (headless browser) is the automatic fallback.
  A `GEMITERM_SKIP_ROTATE_COOKIES=1` env var is provided as an escape hatch.
- **[Risk] Has-chats flag false positive after chat deletion.** If user
  deletes all chats, the flag persists. Next probe returns `[]` + flag=true
  -> triggers L1 rotation. Rotation succeeds (session IS valid), so recovery
  is lightweight (one HTTP round-trip) and works. Only if L1 also fails
  would the user see a false `AuthenticationError`. Acceptable edge case.
- **[Risk] RotateCookies rate-limiting.** Google recommends a 600s interval
  between rotations. The disk-mtime guard and in-process throttle enforce
  this. Gemiterm's single-process CLI model means concurrent rotation
  requests are rare.

## Migration Plan

- **Backward compatibility:** `ensureAuthenticated` gains a new code path but
  return type and error contract are unchanged.
- **Rollout:** ships with the sibling `phatom-auth-repro-with-tests` change.
- **Rollback:** revert the commit. Set `GEMITERM_SKIP_ROTATE_COOKIES=1` to
  disable L1 and rely solely on L2 (headless browser) if needed.
