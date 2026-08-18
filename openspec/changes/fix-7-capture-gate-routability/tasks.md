## 1. Regression harness (red first)

- [x] 1.1 Extend `tests/auth-regression/invariant-capture-integrity.test.ts`: fake driver whose `cookieList` returns PSID/PSIDTS only at `.youtube.com` for the whole window → `captureLogin` MUST reject typed, MUST NOT call `saveFullJar`, existing jar byte-preserved. Watch it fail (today the gate passes and the jar persists).
- [x] 1.2 Backstop case: gate observes a routable pair, then `cookieListFromState` returns an unroutable payload → MUST reject typed, no persist. Watch it fail.

## 2. Implementation

- [x] 2.1 Add `LoginUnroutableError` to `src/core/errors.ts` (message names the gemini-routability condition and the observed scopes).
- [x] 2.2 `waitForGate` (`src/auth/cookie-session.ts`): gate on `isRoutableTo(cookie, GEMINI_APP_URL)` for both `PSID` and `PSIDTS`; track whether names were ever observed without routability to select `LoginUnroutableError` vs `LoginTimeoutError` at the deadline.
- [x] 2.3 `captureLogin`: after `filterToGeminiDomains`, run `this.deps.validator.validate(payload)`; on throw, skip `saveFullJar` and reject with `LoginUnroutableError`.
- [x] 2.4 `AuthCommand` top-level: render `LoginUnroutableError` as a friendly info message + non-zero exit (mirror the `LoginCancelledError` seam from `cancel-auth-on-browser-close`).

## 3. Gates + docs

- [x] 3.1 Update gate-loop unit tests (routable-pass, youtube-only-fail, name-absent timeout) and the `AuthCommand` propagation test.
- [x] 3.2 Run `bun test --isolate`, `bun run typecheck`, `bun run lint:mediation`, `bun run check:auth-gate` (change touches auth-sensitive paths + `tests/auth-regression/`).
- [x] 3.3 Append the `docs/auth-cookie-lifecycle.md` changelog entry (routable capture gate + validate backstop; note the accepted risk: a hypothetically youtube-only account becomes unrenewable-by-design).
