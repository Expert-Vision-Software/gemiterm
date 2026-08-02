## MODIFIED Requirements

### Requirement: Freshness and Validity
A profile's cookies are considered valid and fresh when ALL of the following are true: (a) the cookie set includes both `__Secure-1PSID` and `__Secure-1PSIDTS`, (b) the `__Secure-1PSIDTS` cookie has an `expires` value greater than 0, and (c) the resulting expiry timestamp (cookie `expires` in milliseconds) is later than `now + 1 hour` (the freshness threshold). The system MUST use these rules consistently in `hasValidCookies`, `getStatus`, and `loadCookiesForApi`.

The `checkCookieFreshness(cookies)` function MUST be exported as a public function from `src/infrastructure/storage.ts`. Any module that needs to determine whether cookies are within the 1-hour grace window MUST import `checkCookieFreshness` rather than duplicating the threshold logic.

#### Scenario: Freshness window uses 1-hour threshold
- **WHEN** a profile's `__Secure-1PSIDTS` cookie expires more than 1 hour from now
- **THEN** `hasValidCookies` and `getStatus` both report the profile as active
- **AND** `checkCookieFreshness(cookies)` returns `true`

#### Scenario: Cookies inside the 1-hour window are not fresh
- **WHEN** a profile's `__Secure-1PSIDTS` cookie expires within 1 hour from now (or has already passed)
- **THEN** `hasValidCookies` returns `false` and `getStatus` reports `isActive: false`
- **AND** `checkCookieFreshness(cookies)` returns `false`

#### Scenario: checkCookieFreshness is publicly importable
- **WHEN** another module (e.g., `ProfileAuthManager`) imports `checkCookieFreshness` from `src/infrastructure/storage.ts`
- **THEN** the import resolves and the function is callable with a `Cookie[]` argument, returning a `boolean`
