## MODIFIED Requirements

### Requirement: AuthService.silentRefresh uses multi-layer recovery ladder

The existing requirement is MODIFIED to require merge-by-name-domain-path upsert in the L2 persistence path.

The `AuthService.silentRefresh(profileName)` method MUST attempt session recovery in a ladder, escalating from the cheapest mechanism to the heaviest:

1. **L1:** Call `rotateCookies(name)`. If it returns `true`, return `true`.
2. **L2 (fallback):** Launch headless browser via `PlaywrightCliDriver.openHeadless`, load cookies via `stateLoad`, start `CookieMonitor` with `requireRotation` set to the snapshot of active cookie values. The snapshot MUST be built using strict `.google.com` domain matching (domain normalized to `.google.com`, not `endsWith("google.com")`) to prevent `somethinggoogle.com` domains from being captured. If the monitor fires with rotated cookies, the method MUST persist them via an upsert merge by `(name, domain, path)` key — loading the existing jar, upserting each polled cookie, and saving the merged list — and return `true`. If the monitor times out or cookies are identical to the baseline, return `false`.
3. The caller (`ProfileAuthManager.autoExtendSession`) receives the boolean result; a `false` from `silentRefresh` propagates to `ensureAuthenticated`, which throws `AuthenticationError` triggering L3 (interactive reauth prompt).

The method MUST NOT produce console output (silent operation). The method MUST still close the browser session in a `finally` block when L2 is reached.

#### Scenario: L1 RotateCookies succeeds, no browser launched

- **WHEN** `silentRefresh("default")` is called
- **AND** `rotateCookies("default")` returns `true`
- **THEN** `silentRefresh` returns `true`
- **AND** no browser is launched (no `openHeadless` call)

#### Scenario: L1 fails, L2 headless browser succeeds with cookie merge

- **WHEN** `silentRefresh("default")` is called
- **AND** `rotateCookies("default")` returns `false`
- **AND** the headless browser flow detects rotated cookies within 30s
- **AND** the existing jar has 4 multi-domain cookies
- **AND** the polled set has only 3 (`.google.com` PSIDTS absent)
- **THEN** `silentRefresh` returns `true`
- **AND** the persisted jar maintains 4 cookies (existing `.google.com` PSIDTS preserved via merge)
- **AND** the browser session is closed

#### Scenario: Both L1 and L2 fail

- **WHEN** `silentRefresh("default")` is called
- **AND** `rotateCookies("default")` returns `false`
- **AND** the headless browser times out without rotation
- **THEN** `silentRefresh` returns `false`

#### Scenario: L2 snapshot uses strict .google.com domain matching

- **WHEN** `silentRefresh("default")` is called and L1 fails
- **AND** the profile's stored cookies include `__Secure-1PSID` with domain `somethinggoogle.com` (which does NOT normalize to `.google.com`)
- **THEN** the L2 snapshot MUST NOT include the `somethinggoogle.com` cookie
- **AND** the cookie value MUST fall back to the non-domain-filtered lookup (or be excluded from the baseline if no valid `.google.com` match exists)
