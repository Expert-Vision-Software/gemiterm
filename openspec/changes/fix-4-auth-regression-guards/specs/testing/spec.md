# testing Delta

## ADDED Requirements

### Requirement: Auth-regression jar-shape fixtures

The testing infrastructure SHALL provide typed jar builders in `tests/auth-regression/fixtures.ts` — `freshFullJar`, `staleFullJar`, `phantomShapedJar`, `deadJar`, `trimmedFourCookieJar` — derived from the validated findings in `docs/cookie-ablation-findings.md`, for use by the auth-regression suite.

#### Scenario: freshFullJar reflects the validated 41-cookie shape families
- **WHEN** `freshFullJar()` is built
- **THEN** it contains at minimum the `*SID` identity family, `__Secure-1/3PSIDTS`, `SIDCC` family, and identity-service cookies on `.google.com`/`.youtube.com`/`accounts.google.com` domains, with future expiry timestamps

#### Scenario: staleFullJar ages only the PSIDTS clock
- **WHEN** `staleFullJar()` is built with an injected clock
- **THEN** PSIDTS-family cookies carry the aged value while identity-family cookies are identical to `freshFullJar`

#### Scenario: trimmedFourCookieJar reproduces the historical artifact
- **WHEN** `trimmedFourCookieJar()` is built
- **THEN** it contains exactly the `__Secure-1PSID`/`__Secure-1PSIDTS` pair on `.google.com` and `.youtube.com`

### Requirement: Auth-regression suite isolation

The auth-regression suite SHALL boot its own `GEMITERM_CONFIG_DIR` per test file and SHALL NOT import the global mock-cookie fixtures (`createMockCookies` and successors), such that changes to shared test mocks cannot satisfy auth invariants.

#### Scenario: suite is immune to global mock drift
- **WHEN** the global mock cookie fixtures change shape or defaults
- **THEN** no auth-regression test outcome changes, because the suite does not consume them
