# Tasks: silent-refresh-stale-psidts-detection

## 1. Green the red test

- [x] 1.1 In `src/services/profile-auth-manager.ts` `ensureAuthenticated`, after the `models()` probe runs, call the injected `rotateCookies(name)` (L1 `RotateCookies` POST only) unconditionally on the valid-cookies path (before returning `LoadedCookies`). Preserve the existing stale-path behavior (`models()` threw → `silentRefresh` L1+L2; `silentRefresh` returned `false` → `AuthenticationError`).
- [x] 1.2 Ensure a `rotateCookies` failure/throw on the probe-success path does NOT propagate as `AuthenticationError` (best-effort rotation; wrapped in try/catch).
- [x] 1.3 Add `AuthService.rotateCookies(profileName)` (L1 wrapper) and inject `rotateCookies` into `ProfileAuthManagerDeps`; wire in `cli/index.ts`.
- [x] 1.4 Run `bun test tests/services/profile-auth-manager.test.ts -t "stale __Secure-1PSIDTS"` — confirm green.

## 2. Update spec-encoding tests

- [x] 2.1 In `tests/services/profile-auth-manager.test.ts`, update "models() succeeds ... rotates" (`:511`) to assert `rotateCookies` IS called once and `silentRefresh` is NOT (and the authenticated log still fires).
- [x] 2.2 Update the probe-budget test (`:589`) and the separate-instances test (`:614`) — `models()` still called at most once across repeat calls (probe cache), but `rotateCookies` is called each time; `silentRefresh` 0.
- [x] 2.3 In `tests/services/phantom-auth.test.ts`, update "models() succeeds ... rotates" (`:234`) and the probe-budget test (`:262`) analogously.
- [x] 2.4 Add `rotateCookies` mock to `createManager` helper and the inline PAM constructions on the valid path.
- [x] 2.5 Do NOT weaken any of the existing phantom-auth assertions (stale → refresh, refresh-fail → throw, multi-domain, jar-corruption paths).

## 3. Verify

- [x] 3.1 Run `bun run typecheck` — clean.
- [x] 3.2 Run `bun test tests/services/phantom-auth.test.ts` and `tests/services/profile-auth-manager.test.ts` — all green.
- [x] 3.3 Run `bun test` — full suite green (913 pass).
- [x] 3.4 Manual smoke (`bun run dev`): `list` does L1 rotate with NO browser launch; first-call `fetch --profile` no longer throws AuthenticationError.

## 4. CHANGELOG patch (folded into this PR)

- [x] 4.1 In `CHANGELOG.md`, under the existing v2.6.1 `### Fixed`, add the missing Proposal A credit: `mergeCookies` upsert (commit `65b0c38`), `resolveCookie` `.google.com`-preference, and `requireRotation` domain-preferring check.
- [x] 4.2 Add a v2.6.2 entry summarizing the three bugfixes shipped in this release (this + the other two changes), noting the L1-rotateCookies vs L2-silentRefresh split.

## 5. Spec sync

- [x] 5.1 After implementation, sync/archive the `phantom-auth-detection` delta into the main spec.
