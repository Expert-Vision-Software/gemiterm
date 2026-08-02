## Context

Today `ensureAuthenticated()` throws `AuthenticationError` when cookies are near expiry (within 1-hour grace window) or fully expired. Users must manually run `gemiterm auth --renew` or `gemiterm login`. The `auth-cookie-freshness-fix` change established the 1-hour freshness threshold in `checkCookieFreshness`, providing the detection signal needed for proactive action.

The two-tier approach (silent auto-extend, then prompt-to-reauth) mirrors how desktop applications handle refresh-token flows: try silently first, ask only when necessary. The headless constraint for auto-extend ensures the user isn't interrupted by a browser window popping up unexpectedly.

## Goals / Non-Goals

**Goals:**
- Auto-extend sessions silently (headless) when cookies are within the 1-hour grace window
- Prompt for manual reauth (headed) only when auto-extend fails or session is fully expired
- Respect `--non-interactive` / no-TTY mode — skip the prompt and fail like today
- Work with `--profile/-p` flag when explicitly targeting a profile
- Use existing prompt facade for the reauth confirm

**Non-Goals:**
- Modifying the 1-hour freshness threshold (owned by `auth-cookie-freshness-fix`)
- Changing the `auth` command's interactive flow
- Auto-extend on every API call (only at session-load time in `ensureAuthenticated`)
- Background daemon or cron-based renewal
- Handling multiple concurrent CLI invocations racing to refresh

## Decisions

### 1. Auto-extend lives in `ProfileAuthManager.ensureAuthenticated()`

**Decision:** Wire `autoExtendSession()` into `ensureAuthenticated()` before the `throw new AuthenticationError` line. The storage layer (`checkCookieFreshness`) reports freshness; the service layer decides to act on it.

**Alternatives considered:**
- *Wire in `getGeminiClient()` factory in `cli/index.ts`* — rejected because that factory only knows about `loadCookiesForApi`, which already checks freshness and throws. We'd need to re-check freshness before `loadCookiesForApi` or catch its error, which is more fragile.
- *Wire in `ProfileManager.hasValidCookies()`* — rejected because `hasValidCookies` is a storage-layer boolean; the storage layer shouldn't trigger side effects (browser launch).
- *Wire in every command handler* — rejected because of code duplication.

**Implementation:** `ensureAuthenticated` calls `this.profileManager.hasValidCookies(name)`. When that returns `false`, before throwing, it calls `this.autoExtendSession(name)`. If auto-extend returns `true`, it calls `this.cookieStorageService.loadCookiesForProfile(name)` (fresh cookies now on disk) and returns. If `false`, it throws `AuthenticationError`.

### 2. Reauth prompt lives in `getGeminiClient()` factory in `cli/index.ts`

**Decision:** Intercept `AuthenticationError` in the `getGeminiClient()` closure in `setupMediator` (`src/cli/index.ts:56-75`). On error, present the confirm prompt, and on approval run the full headed auth flow, re-load cookies, and retry client creation.

**Alternatives considered:**
- *Wire in the mediator* — rejected because the mediator dispatches to handlers that call `getGeminiClient()` internally; the mediator doesn't own the error-throwing code path.
- *Wire in `ProfileAuthManager.ensureAuthenticated()`* — rejected because `ensureAuthenticated` is synchronous; the reauth flow is async (browser launch + monitor wait). Also, `ProfileAuthManager` doesn't have an `AuthService` dependency to launch the browser.
- *Wire in the CLI error handler (`main()` catch block)* — rejected because we need to retry the failed operation, and the catch block doesn't have access to the command handler to re-invoke it.

**Implementation:** Wrap `loadCookiesForApi` + client construction in a try/catch. On `AuthenticationError`, import `confirm` from prompts facade, show the prompt, and on `true` run the auth flow. The factory must be made `async` and return a `Promise<GeminiClientService>`.

### 3. `AuthService.silentRefresh` uses headless browser with `openHeadless`

**Decision:** Add `PlaywrightCliDriver.openHeadless(url, profile, session)` that builds args identical to `openHeaded` but omits `--headed`. `silentRefresh` launches headless, loads existing cookies via `stateLoad`, navigates to Gemini, and uses `CookieMonitor` with a 30-second timeout. Returns success/failure without throwing on timeout.

**Alternatives considered:**
- *Reuse `openHeaded` with `--headed`* — rejected; would pop up a browser window, violating the "no unexpected browser" constraint.
- *Use `--headless` flag on the existing `open` call* — the `playwright-cli` `open` command uses `--headed` for visible and defaults to headless when `--headed` is absent. So "open without --headed" is the headless path.
- *Use `--persistent` vs ephemeral session* — headless silent refresh omits `--persistent` to avoid localStorage collisions with the user's normal browser profile. The existing cookies are loaded via `stateLoad` into the ephemeral session.

**30-second timeout rationale:** The `CookieMonitor` is given 30s (vs 5 min for manual auth). If Google requires the user to re-enter credentials (password, MFA), the sign-out link probe won't appear within 30s, so the monitor times out and `silentRefresh` returns `false` — which triggers the fallthrough to prompt-to-reauth.

### 4. `checkCookieFreshness` is exported from `storage.ts`

**Decision:** Rename the module-private `checkCookieFreshness` function to a public export. `ProfileAuthManager` imports it to decide whether to attempt auto-extend.

**Rationale:** The 1-hour threshold logic must be consistent across `hasValidCookies`, `loadCookiesForApi`, and the new `autoExtendSession`. Exporting the function avoids duplicating the threshold constant and logic.

**Alternative:** *Create a separate `isNearExpiry` function* — rejected because that's what `checkCookieFreshness` already does (returns `false` when within the grace window).

### 5. Retry mechanism after reauth

**Decision:** When the reauth prompt succeeds (user logged in, cookies saved), the factory calls `profileManager.loadCookiesForApi(profileName)` again to get fresh cookie values and constructs a new `GeminiClientService`. The retry is a single attempt — no loop. If the second attempt also fails, the error propagates.

**Rationale:** A loop with retry limit adds complexity for a rare edge case (user authenticates but cookies aren't saved properly). A single retry handles the common case (session expired → reauth → fresh cookies → success) without risking infinite loops.

## Risks / Trade-offs

- **[Risk] Headless browser may not work for some Google auth states** — some Google sessions may require interactive MFA that headless Chromium can't render. Mitigation: 30s timeout ensures auto-extend fails fast and falls through to the interactive reauth prompt.
- **[Risk] Silent browser launch may confuse users if they check running processes** — the headless Chromium process appears briefly. Mitigation: the CLI prints "Session auto-refreshed" on success, confirming the activity was intentional.
- **[Risk] Reauth prompt won't work in non-TTY/CI environments** — the confirm prompt throws `NonInteractiveError` when stdin is not a TTY. Mitigation: this is by design. In non-interactive mode, the error propagates as `AuthenticationError`, matching today's behavior. CI scripts should use `--non-interactive` or cron-based `auth --renew`.
- **[Trade-off] `getGeminiClient()` becomes async** — all call sites in `setupMediator` need `await`. Mitigation: `setupMediator` is already `async`, and handler factories that return `getGeminiClient()` are already wrapped in async lambdas.

## Open Questions

- None — all design decisions are resolved above.
