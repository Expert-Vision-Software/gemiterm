## Why

After approximately two hours from `gemiterm auth`, every user-facing operation
(`list`, `fetch`, `send`, `new`, `export`, `delete`) silently stops returning
data, despite the profile table showing **ACTIVE: Yes** and the cookie file
showing expires dates a year in the future. The CLI prints `[INFO] [mediator]
Profile '<name>' is authenticated` and then returns `No conversations found.`
to the user. This pattern has recurred across multiple releases (`7e2c486`,
`99d0b17`, `da215dc`, `2392a8d`) -- each layer was individually correct, but
no layer in the auth gate ever asks Google's server whether the session is
still alive. Investigation via five parallel hypothesis subagents (in this
session's plan deliverable) concluded that **the architecture has no
server-side validity probe anywhere in the auth path** -- the freshness check
(`checkCookieFreshness` in `src/infrastructure/storage.ts:41-49`) is purely
local, comparing `cookie.expires` against `Date.now() + 1h`, and
`ProfileAuthManager.ensureAuthenticated`
(`src/services/profile-auth-manager.ts:54-71`) trusts it without verification.
`AuthService.silentRefresh` (`src/services/auth-service.ts:193-230`) is
gated behind the local check and additionally is a no-op when the loaded
cookies are still valid (the poll loop returns the just-loaded cookies on
first tick without waiting for Google's actual rotation). The fix needs to
add a server-side probe and harden the silent-refresh path so a stale
session is detected and recovered (or surfaced) instead of being silently
returned as "authenticated" while every API call returns empty.

## What Changes

- **Add a server-side session validity probe** to `ProfileAuthManager.ensureAuthenticated`.
  When local cookies pass `hasValidCookies`, the method MUST consult
  `geminiClient.listChats({ limit: 1 })` before declaring the session
  authenticated. An empty result combined with a persistent "has-chats" flag
  per profile MUST be treated as server-side session invalidation and MUST
  trigger the silent-refresh ladder. A process-level cache (TTL 2.5 min,
  overridable via `GEMITERM_PROBE_TTL_MS` env var) MUST memoize the probe
  result. A genuine empty profile (fresh auth, no chats yet) MUST NOT be
  confused with a stale session via a persisted per-profile `profile-has-chats`
  marker file stored alongside the profile's `storage_state.json`.

- **Implement a multi-layer silent refresh ladder** replacing the current
  single-mechanism headless browser approach. Pattern adopted from
  `teng-lin/notebooklm-py`'s proven 7-layer auth recovery system:

  - **L1 -- RotateCookies POST** (new, primary): HTTP POST to
    `https://accounts.google.com/RotateCookies` with the stored cookie jar.
    This endpoint mints fresh `__Secure-1PSIDTS` (the short-lived session
    token) in one lightweight HTTP round-trip. No browser, no Playwright,
    no polling. This mechanism was verified against `HanaokaYuzu/Gemini-API`
    and `notebooklm-py`, confirming it works for Gemini sessions.
    Rate-limited by disk-mtime and in-process throttle to prevent
    Google-imposed limits.
  - **L2 -- Headless browser refresh** (existing, hardened): Falls back to
    Playwright headless session when L1 fails (account-level invalidation
    where RotateCookies returns 401/403, or the endpoint is unavailable).
  - **L3 -- Reauth prompt** (existing): When both L1 and L2 fail, falls
    through to the existing interactive re-authentication flow.

- **Tighten `AuthService.silentRefresh`** so it is not a no-op when the loaded
  cookies are still locally valid. The method MUST attempt L1 (RotateCookies)
  first; if the returned `__Secure-1PSIDTS` differs from the stored value,
  the rotation succeeded. If identical or the request fails, escalate to L2
  (headless browser). Both layers MUST be attempted before returning `false`.
  The `CookieMonitor.start` method MUST accept an optional `requireRotation`
  option that gates the `onCookiesFound` callback on cookie values differing
  from the initial `stateLoad` baseline (defense-in-depth for L2).

- **Fix `GeminiClientService.persistRefreshedCookies`** to merge cookies by
  `(name, baselineValue)` instead of by `name` only. The SDK jar carries only
  a `Record<string, string>` (no domain info), so the match key uses the
  stored cookie's value compared against `this.baselineSecure1psid` /
  `this.baselineSecure1psidts` from construction time. On profiles whose
  storage file contains duplicate `__Secure-1PSID` / `__Secure-1PSIDTS` entries
  across domains (`.youtube.com` and `.google.com`), this prevents silently
  overwriting the non-matching domain entry.

- **Update `openspec/specs/auth/spec.md` and `openspec/specs/gemini-client/spec.md`**
  to codify the new probe, the silent-refresh ladder, and the tightened
  merge contract (delta specs).

- **No belt-and-suspenders throw from `listChats([])`** -- the probe in
  `ensureAuthenticated` already catches staleness before commands reach
  `GeminiClientService`. Adding a duplicate check in the hot path is dead code.

## Boundary Decision: SDK vs. gemiterm

The `gemini-web-sdk` (`src/utils/auth.js`) is intentionally a thin API client:
it accepts a `secure_1psid` on construction, runs a one-time `init()` (GET
`gemini.google.com/app` for CSRF tokens), and makes API calls. It has no
cookie persistence, rotation, refresh, or multi-profile support. This boundary
is correct and unchanged.

The `accounts.google.com/RotateCookies` endpoint operates at the **cookie
lifecycle** level (it POSTs a full cookie jar to Google's identity service
and receives fresh session tokens). This belongs in gemiterm's
`src/services/`, not in the SDK. The RotateCookies implementation will be a
new function in `src/services/cookie-rotation.ts` that uses the existing
`CookieStorageService` to read/write the full cookie jar and `axios` (or
Bun's `fetch`) for the HTTP call.

## Capabilities

### New Capabilities

- `phantom-auth-detection` -- server-side session validity probe, process-level
  memoization, per-profile has-chats flag persistence, signal translation to
  the existing auto-extend + reauth-prompt pipeline. Owns the new
  `ProfileAuthManager.probeServerSession` method, the cache TTL constant,
  and the `has-chats` marker file management.
- `silent-refresh-tightening` -- hardens `AuthService.silentRefresh` with a
  multi-layer recovery ladder (L1: RotateCookies POST, L2: headless browser,
  L3: reauth prompt). Also hardens `CookieMonitor.start` with `requireRotation`
  option for defense-in-depth in L2.

### Modified Capabilities

- `auth` -- `ProfileAuthManager.ensureAuthenticated` MUST consult the
  server-side probe before returning "authenticated" for a profile whose
  local cookies pass freshness. `AuthService.silentRefresh` MUST NOT be a
  no-op; its success contract changes to "RotateCookies succeeded with new
  PSIDTS, or headless browser completed with rotated cookies."
  `CookieMonitor.start` accepts an optional `requireRotation` parameter.
- `gemini-client` -- `GeminiClientService.persistRefreshedCookies` MUST key
  on `(name, baselineValue)` instead of `name` so duplicate cookie names
  across domains are not silently overwritten.

## Impact

- **Code touched**
  - `src/services/profile-auth-manager.ts` -- add `probeServerSession`,
    process-level cache (2.5 min TTL, `GEMITERM_PROBE_TTL_MS` override),
    per-profile has-chats marker persistence, wire into `ensureAuthenticated`.
  - `src/services/cookie-rotation.ts` -- **new file**: `rotateCookies(profileName)`
    implementing the `accounts.google.com/RotateCookies` POST with
    rate-limiting (disk-mtime guard + in-process throttle) and response parsing.
  - `src/services/auth-service.ts` -- `silentRefresh` ladder: try L1
    (RotateCookies) first; if fails, fall through to L2 (headless browser).
    Cookie value comparison on L2 results.
  - `src/services/cookie-monitor.ts` -- add `requireRotation` option to
    `start()` that compares polled cookies against `stateLoad` baseline.
  - `src/services/gemini-client-wrapper.ts` -- fix `persistRefreshedCookies`
    merge key to `(name, baselineValue)`.
  - `src/infrastructure/path-utils.ts` -- add `getProfileHasChatsPath` helper.
  - `openspec/specs/auth/spec.md`, `openspec/specs/gemini-client/spec.md`,
    `openspec/specs/phantom-auth-detection/spec.md`,
    `openspec/specs/silent-refresh-tightening/spec.md` -- delta specs.
  - `README.md` -- document `GEMITERM_PROBE_TTL_MS` env var.
- **APIs / public surface**
  - `ProfileAuthManager.probeServerSession` is a new public method.
  - `rotateCookies(profileName)` is a new exported function from
    `src/services/cookie-rotation.ts`.
  - `CookieMonitor.start` accepts a new optional `requireRotation` parameter.
  - `GeminiClientService.persistRefreshedCookies` behavior changes (merge
    key); observable only via the on-disk cookie file.
- **Dependencies** -- `axios` is already a transitive dependency through
  `gemini-web-sdk`. No new dependencies.
- **Multi-profile** -- the probe and rotation run per-profile. The per-profile
  has-chats marker is stored at `$PROFILE_DIR/profile-has-chats`.
- **TTY** -- the change reuses the existing `promptAndReauth` path in
  `src/cli/index.ts:91-96`, which already handles non-TTY mode correctly.
- **Conformance** -- `gemiterm list` non-interactive output (text and JSON
  forms) is unchanged. The only behavioral change is that a stale session
  now triggers auto-recovery instead of silent empty output.

## Sibling Change

This is the implementation half of the bug fix. The deterministic regression
test suite is filed separately as `phatom-auth-repro-with-tests`. That change
defines the test contract (5 failing tests at the `ProfileAuthManager` /
mock seam); this change implements the fix that turns them green. The
`phantom-auth-detection` capability spec is shared between both changes.
