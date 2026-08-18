## MODIFIED Requirements

### Requirement: CookieSession.captureLogin captures the full browser jar (gate is not payload)
`captureLogin(profile)` MUST open a headed browser (`https://gemini.google.com/app`) after printing a one-shot notification (containing `Opening headed browser` and the app URL, without blocking on input), poll the session's cookie list until BOTH `__Secure-1PSID` and `__Secure-1PSIDTS` are present AND routable to `https://gemini.google.com` (RFC 6265 domain/path/expiry matching — cookies present only at other scopes, e.g. `.youtube.com`, MUST NOT satisfy the gate) within the 5-minute timeout, and then persist the COMPLETE browser storage state captured via `state-save` as the payload - filtered by domain (`.google.com`, `.youtube.com`, `accounts.google.com`) and by nothing else. No cookie-name filtering may exist in the capture path. Before persisting, the filtered payload MUST pass `CookieValidator.validate`; a payload that fails validation (e.g. no gemini-routable `__Secure-1PSIDTS`) MUST NOT be persisted and `captureLogin` MUST reject with a typed unroutable-capture error, leaving any pre-existing jar byte-for-byte unchanged. On gate timeout with required cookies observed but never routable, `captureLogin` MUST reject with the same typed unroutable-capture error; on timeout without the required cookies observed at all it MUST reject with the typed timeout error. The browser session MUST be closed in a `finally` block on every path. On success the method MUST print a confirmation containing the captured cookie count and the expiry derived from `__Secure-1PSIDTS.expires`.

#### Scenario: Gate waits for both required cookies; payload is the full jar
- **WHEN** the cookie list first reports both `__Secure-1PSID` and `__Secure-1PSIDTS` routable to `gemini.google.com` while the browser also holds `SID`, `HSID`, `SSID`, `APISID`, `SAPISID`, `NID`
- **THEN** the persisted jar contains all of those cookies (payload is never filtered to the gate set) and the confirmation reports the full count

#### Scenario: YouTube-scoped cookies never satisfy the gate
- **WHEN** the cookie list reports `__Secure-1PSID`/`__Secure-1PSIDTS` only at a `.youtube.com` scope (a persistent profile's pre-existing sibling session) and no gemini-routable pair appears within the timeout
- **THEN** `captureLogin` rejects with the typed unroutable-capture error, nothing is persisted, and any pre-existing jar is byte-for-byte unchanged

#### Scenario: Unroutable payload is never persisted
- **WHEN** the gate has observed a routable pair but the `state-save` payload fails `CookieValidator.validate` (no gemini-routable `__Secure-1PSIDTS`)
- **THEN** `saveFullJar` is not invoked, `captureLogin` rejects with the typed unroutable-capture error, and any pre-existing jar is byte-for-byte unchanged

#### Scenario: Notification prints and does not block
- **WHEN** `captureLogin` begins
- **THEN** console output contains `Opening headed browser` and `https://gemini.google.com/app`, and the browser launch proceeds without reading stdin

#### Scenario: Browser closed even when the gate times out
- **WHEN** the required cookies never appear within the timeout
- **THEN** the driver's session close is still invoked and the call rejects with the typed timeout error
