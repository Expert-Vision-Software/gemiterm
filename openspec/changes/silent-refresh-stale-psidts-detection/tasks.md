# Tasks: silent-refresh-stale-psidts-detection

## 1. Green the red test

- [ ] 1.1 In `src/services/profile-auth-manager.ts` `ensureAuthenticated`, after the `models()` probe runs, call `silentRefresh(name)` unconditionally on the valid-cookies path (before returning `LoadedCookies`). Preserve the existing stale-path throw behavior (`models()` threw AND `silentRefresh` returned `false` → `AuthenticationError`).
- [ ] 1.2 Ensure a `silentRefresh` failure/throw on the probe-success path does NOT propagate as `AuthenticationError` (best-effort rotation).
- [ ] 1.3 Run `bun test tests/services/profile-auth-manager.test.ts -t "stale __Secure-1PSIDTS"` — confirm green.

## 2. Update spec-encoding tests

- [ ] 2.1 In `tests/services/profile-auth-manager.test.ts`, update "models() succeeds logs is authenticated; no silent refresh spent" (`:511`) to assert `silentRefresh` IS now called once (and the authenticated log still fires).
- [ ] 2.2 Update the probe-budget test (`:589`) — `models()` still called at most once across repeat calls (probe cache), but `silentRefresh` is called each time (the mock has no 600 s guard; assert it is called, not zero times).
- [ ] 2.3 In `tests/services/phantom-auth.test.ts`, update "models() succeeds means session is valid; no silent refresh spent" (`:234`) and the probe-budget test (`:262`) analogously.
- [ ] 2.4 Do NOT weaken any of the existing 438 lines of phantom-auth assertions (stale → refresh, refresh-fail → throw, multi-domain, jar-corruption paths).

## 3. Verify

- [ ] 3.1 Run `bun run typecheck` — clean.
- [ ] 3.2 Run `bun test tests/services/phantom-auth.test.ts` and `tests/services/profile-auth-manager.test.ts` — all green.
- [ ] 3.3 Run `bun test` — full suite green, baseline intact.

## 4. CHANGELOG patch (folded into this PR)

- [ ] 4.1 In `CHANGELOG.md`, under the existing v2.6.1 `### Fixed` (or `### Internal`), add the missing Proposal A credit: `mergeCookies` upsert (commit `65b0c38`), `resolveCookie` `.google.com`-preference, and `requireRotation` domain-preferring check.
- [ ] 4.2 Add a v2.6.2 entry summarizing the three bugfixes shipped in this release (this + the other two changes).

## 5. Spec sync

- [ ] 5.1 After implementation, sync/archive the `phantom-auth-detection` delta into the main spec.
