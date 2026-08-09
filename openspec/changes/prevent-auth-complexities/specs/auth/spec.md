# auth spec delta — `prevent-auth-complexities`

**Status:** Post-change (v2.4.3)
**Date:** 2026-08-09

## Modified Requirements

### Requirement: Session validation trusts the on-disk cookies (PSID-only, no freshness gate)

The `ProfileAuthManager.ensureAuthenticated(profileName?)` method MUST consider a session valid when the active profile's `storage_state.json` contains a `__Secure-1PSID` cookie, regardless of the cookie's local `expires` timestamp and regardless of the presence of `__Secure-1PSIDTS`. The method MUST NOT consult a local freshness threshold (the previous 7-day `__Secure-1PSIDTS.expires` gate is removed). The `ProfileManager.hasRequiredCookies(profileName)` method MUST return `true` exactly when `__Secure-1PSID` is present in the cookie list; the absence of `__Secure-1PSIDTS` MUST NOT cause it to return `false`. The `ProfileManager.loadCookiesForApi(profileName)` method MUST return `{ secure1psid, secure1psidts: null }` for profiles that have PSID but not PSIDTS.

#### Scenario: Dormant session with expired PSIDTS is still authenticated

- **WHEN** `ensureAuthenticated("default")` is called and the profile's cookie list contains `__Secure-1PSID` (with a future expiry) and `__Secure-1PSIDTS` (with an `expires` timestamp in the past)
- **THEN** the method resolves with the loaded cookies, does not throw, and does not prompt the user to re-authenticate

#### Scenario: Profile with PSID only (no PSIDTS) is still authenticated

- **WHEN** `ensureAuthenticated("default")` is called and the profile's cookie list contains only `__Secure-1PSID` (no `__Secure-1PSIDTS`)
- **THEN** the method resolves with `{ secure_1psid: <value>, secure_1psidts: null }` and does not throw

#### Scenario: Profile with neither required cookie is rejected

- **WHEN** `ensureAuthenticated("default")` is called and the profile's cookie list contains neither `__Secure-1PSID` nor `__Secure-1PSIDTS`
- **THEN** the method rejects with an `AuthenticationError` whose message mentions the profile name and the substring `gemiterm auth`

### Requirement: 401 responses surface an actionable, profile-specific `AuthenticationError`

When the Gemini API returns a 401 (translated to the SDK's `AuthError`), the `GeminiClientService.translateError` method MUST return an `AuthenticationError` whose message names the active profile and points to the correct re-auth command. The message MUST contain the profile name, the substring `401`, and the substring `gemiterm auth <profile>` (e.g. `gemiterm auth work`). The default `AuthenticationError` constructor message (used by the command layer when no specific cause is known) is unchanged from the pre-change form.

#### Scenario: AuthError translation names the profile and the auth command

- **WHEN** the SDK throws an `AuthError` during a `listChats` / `sendMessage` / `fetchChat` / `deleteChat` / `startNewChat` / `listModels` call, and the `GeminiClientService` was constructed with `profileName="work"`
- **THEN** the `AuthenticationError` message contains the substrings `work`, `401`, and `gemiterm auth work`

#### Scenario: AuthError translation uses a default profile name when none is set

- **WHEN** the SDK throws an `AuthError` and the `GeminiClientService` was constructed without a `profileName` (the non-profile factory client)
- **THEN** the `AuthenticationError` message contains the substrings `default`, `401`, and `gemiterm auth default`

## What is NOT modified

- The login flow (`AuthService.authenticate`, `CookieMonitor.start`, the `gemiterm auth` command surface) is unchanged. The full-jar capture behavior from the upstream cherry-pick (`6bc51f6`) is preserved — `CookieMonitor.checkCookies` and `CookieMonitor.poll` continue to pass the full browser jar to the cookie storage.
- The `AuthError` translation's error class is unchanged (`AuthenticationError`). Only the message text is updated.
- The default `AuthenticationError` constructor (used when the cause is not an `AuthError`) is unchanged.
- Automatic silent-recovery on 401 is **not** in scope. The new translation surfaces the actionable message; the user re-authenticates by running `gemiterm auth <profile>`.
