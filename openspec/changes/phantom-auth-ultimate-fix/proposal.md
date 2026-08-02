## Why

After approximately two hours from `gemiterm auth`, every user-facing operation
(`list`, `fetch`, `send`, `new`, `export`, `delete`) silently stops returning
data, despite the profile table showing **ACTIVE: ✓ Yes** and the cookie file
showing expires dates a year in the future. The CLI prints `[INFO] [mediator]
Profile '<name>' is authenticated` and then returns `No conversations found.`
to the user. This pattern has recurred across multiple releases (`7e2c486`,
`99d0b17`, `da215dc`, `2392a8d`) — each layer was individually correct, but
no layer in the auth gate ever asks Google's server whether the session is
still alive. Investigation via five parallel hypothesis subagents (in this
session's plan deliverable) concluded that **the architecture has no
server-side validity probe anywhere in the auth path** — the freshness check
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
  When local cookies pass `hasValidCookies`, the method MUST make a lightweight
  Gemini API call (e.g. `geminiClient.listChats({ limit: 1 })`) before declaring
  the session authenticated. An empty result MUST be treated as a session that
  the server has invalidated, and MUST trigger the same auto-extend path that
  the 1-hour grace window uses today. A process-level cache (TTL, e.g. 5 min)
  MUST memoize the probe result so the additional round-trip is not paid on
  every command invocation.
- **Tighten `AuthService.silentRefresh`** so it is not a no-op when the loaded
  cookies are still locally valid. The monitor MUST distinguish "cookies
  returned by `cookieListFromState` are byte-identical to what was loaded"
  from "cookies have been refreshed by Google". If the values are unchanged,
  the monitor MUST either wait for a real rotation or treat the timeout as a
  failure so `ensureAuthenticated` falls through to the re-auth prompt.
- **Fix `GeminiClientService.persistRefreshedCookies`** to merge cookies by
  `(name, domain)` instead of by `name` only. On profiles whose storage file
  contains duplicate `__Secure-1PSID` / `__Secure-1PSIDTS` entries across
  domains (`.youtube.com` and `.google.com`; the user's case contains both),
  the current merge silently overwrites the YouTube entry's value with the
  Google one when Google rotates its cookie.
- **Treat `GeminiClientService.listChats([])` as a soft authentication failure
  signal** when invoked on a freshly-initialized client. The current contract
  (`openspec/specs/gemini-client/spec.md`) says empty array is silent success;
  the bug fix tightens this to "throw `GemitermError('session stale')` when
  the wrapper's baseline was older than N seconds AND the response is empty,
  so the upstream `promptAndReauth` path in `src/cli/index.ts:91-96` is engaged".
- **Update `openspec/specs/auth/spec.md` and `openspec/specs/gemini-client/spec.md`**
  to codify the new probe and the tightened silent-refresh contract (delta specs).
- **Add a regression test suite** at `tests/services/phantom-auth.test.ts` (see
  the sibling `phatom-auth-repro-with-tests` change) that captures the
  phantom-auth symptom as failing tests at the `ProfileAuthManager` / mock seam.

## Capabilities

### New Capabilities

- `phantom-auth-detection` — server-side session validity probe, process-level
  memoization, signal translation to the existing auto-extend + reauth-prompt
  pipeline. Owns the new `ProfileAuthManager.probeServerSession` method and
  the cache TTL constant.
- `silent-refresh-tightening` — hardens `AuthService.silentRefresh` so the
  no-op failure mode (loaded cookies still valid → poll returns the same
  cookies → write-back is a no-op) is detected and converted into a real
  refresh attempt or a re-auth fallback.

### Modified Capabilities

- `auth` — `ProfileAuthManager.ensureAuthenticated` MUST consult the
  server-side probe before returning "authenticated" for a profile whose
  local cookies pass freshness. `AuthService.silentRefresh` MUST NOT be a
  no-op; its success contract changes from "either cookies loaded or new
  cookies returned" to "new cookies returned (or timeout → fail)".
- `gemini-client` — `GeminiClientService.persistRefreshedCookies` MUST key
  on `(name, domain)` instead of `name`. `GeminiClientService.listChats`
  MAY tighten the empty-array contract for the "fresh init then empty"
  case.
- `storage` — `ProfileManager.hasValidCookies` / `getStatus` semantics are
  unchanged (local check stays local). The new server-side probe lives
  above this layer.

## Impact

- **Code touched**
  - `src/services/profile-auth-manager.ts` — add `probeServerSession`,
    process-level cache, wire into `ensureAuthenticated`.
  - `src/services/auth-service.ts` — `silentRefresh` and `waitForSilentLogin`
    changes (compare loaded vs polled cookies; treat no-rotation as failure).
  - `src/services/cookie-monitor.ts` — add an option / branch for the
    "require cookie value to differ from initial load" mode used by
    `silentRefresh`.
  - `src/services/gemini-client-wrapper.ts` — fix `persistRefreshedCookies`
    merge key to `(name, domain)`; optionally add a "soft stale" throw
    path in `listChats`.
  - `tests/services/phantom-auth.test.ts` — new regression suite (owned by
    the sibling `phatom-auth-repro-with-tests` change).
  - `tests/services/profile-auth-manager.test.ts`,
    `tests/services/auth-service.test.ts`,
    `tests/services/cookie-monitor.test.ts`,
    `tests/services/gemini-client-wrapper.test.ts` — additional scenarios
    for the new contract.
  - `openspec/specs/auth/spec.md`, `openspec/specs/gemini-client/spec.md` —
    delta specs for the new behaviors.
  - `openspec/specs/phantom-auth-detection/spec.md`,
    `openspec/specs/silent-refresh-tightening/spec.md` — new capability specs.
- **APIs / public surface**
  - `ProfileAuthManager.probeServerSession` is a new public method.
  - `CookieMonitor.start` accepts a new optional `requireRotation: boolean`
    that gates the `onCookiesFound` callback on cookies differing from the
    initial state.
  - `GeminiClientService.persistRefreshedCookies` behavior changes (merge
    key); observable only via the on-disk cookie file.
- **Dependencies** — none new.
- **Multi-profile** — the probe runs per-profile (one probe per process per
  profile per TTL window). The fix preserves the existing
  `forProfile(profileName)` flow; only the default-profile path gets
  auto-extend today, and this change brings non-default profiles up to the
  same standard (with the same probe cost — see Open Question A).
- **TTY** — the change reuses the existing `promptAndReauth` path in
  `src/cli/index.ts:91-96`, which already handles non-TTY mode correctly.
- **Conformance** — `gemiterm list` non-interactive output (text and JSON
  forms) is unchanged; the empty-chat output path is tightened only when
  the new probe runs AND returns empty AND the wrapper's baseline is older
  than the new threshold.

## Sibling Change

This is the bug-report draft. The deterministic regression test suite that
captures the symptom is filed separately as `phatom-auth-repro-with-tests`.
That change defines the test contract; this change consumes it.