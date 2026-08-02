## 1. Test fixture

- [x] 1.1 Define `makeActiveCookies()` fixture producing locally-valid `__Secure-1PSID` + `__Secure-1PSIDTS` cookies with `expires = now + 365 days`, `domain = ".google.com"` (mirrors the existing fixture in `tests/services/profile-auth-manager.test.ts:24-48`)
- [x] 1.2 Define `makeRefreshedCookies()` fixture producing the same shape with `expires = now + 2 * 365 days` (for the success-path assertion that the refreshed cookie values, not the original, are returned)
- [x] 1.3 Define `gimme(geminiListChats)` helper that returns an `IGeminiClientService` stub where `listChats(opts)` delegates to the supplied function — every other method returns a no-op default
- [x] 1.4 Wire `beforeEach` / `afterEach` to create and tear down a `tmpdir()`-based test config directory and set `process.env.GEMITERM_CONFIG_DIR` (mirrors `tests/services/profile-auth-manager.test.ts:100-108`)

## 2. Regression tests

- [x] 2.1 Test: "locally-valid cookies + server returns [] triggers silent refresh, not silent success"
  - Set up storage with `makeActiveCookies()`; create `ProfileManager`, write cookies.
  - Mock `geminiClient.listChats` to return `[]`.
  - Mock `silentRefresh` to write `makeRefreshedCookies()` and return `true`.
  - Call `ensureAuthenticated("default")`.
  - Assert: returned `LoadedCookies.secure_1psid === "refreshed-psid"` (NOT `"active-psid"`).
  - Assert: `silentRefresh` was called exactly once with `"default"`.
- [x] 2.2 Test: "listChats([]) followed by a failed silent refresh surfaces AuthenticationError"
  - Same storage as 2.1.
  - Mock `geminiClient.listChats` to return `[]`.
  - Mock `silentRefresh` to return `false` (no save, no rotation).
  - Call `ensureAuthenticated("default")`.
  - Assert: throws `AuthenticationError` whose message matches `/No valid session|re-authenticate/i`.
  - Assert: `silentRefresh` was called exactly once with `"default"`.
- [x] 2.3 Test: "listChats(non-empty) means session is valid; no silent refresh spent"
  - Same storage as 2.1.
  - Mock `geminiClient.listChats` to return `[{ id: "c1", title: "t", isPinned: false, timestamp: Date.now() }]`.
  - Mock `silentRefresh` (would return `true` if called — but must NOT be called).
  - Call `ensureAuthenticated("default")`.
  - Assert: returned cookies match the active cookies.
  - Assert: `silentRefresh.toHaveBeenCalledTimes(0)`.
- [x] 2.4 Test: "Probe budget — repeat ensureAuthenticated within TTL reuses the cached result"
  - Same storage as 2.3 (probe returns non-empty).
  - Track `listChats` invocations via a `mock` spy.
  - Call `ensureAuthenticated("default")` three times.
  - Assert: `listChats.mock.calls.length === 1` (asserted as exactly 1 to fail on current pre-fix code; per Open Question A the final assertion may relax to `<= 1` once the fix's cache TTL is chosen).

## 3. Merge-by-(name, domain) test

- [x] 3.1 Add fixture `makeMultiDomainCookies()` producing four cookies:
  - `__Secure-1PSID` (`.youtube.com`, value `yt-psid`)
  - `__Secure-1PSID` (`.google.com`, value `g-psid`)
  - `__Secure-1PSIDTS` (`.youtube.com`, value `yt-psidts`)
  - `__Secure-1PSIDTS` (`.google.com`, value `g-psidts`)
- [x] 3.2 Test: "persistRefreshedCookies overwrites only the matching (name, domain) entry"
  - Set up storage with `makeMultiDomainCookies()`.
  - Construct `GeminiClientService` via mock SDK deps with the standard pattern.
  - In the mock SDK's `init()`, mutate `client.cookies["__Secure-1PSID"]` to `NEW-g-psid` (a Google-domain-only value).
  - Call `listChats()` to trigger `persistRefreshedCookies`.
  - Assert: the on-disk `.google.com` `__Secure-1PSID` value is `NEW-g-psid`.
  - Assert: the on-disk `.youtube.com` `__Secure-1PSID` value is unchanged (`yt-psid`).

## 4. Baseline + CI gate

- [x] 4.1 Run `bun test tests/services/phantom-auth.test.ts` and confirm the five scenarios fail against current HEAD (red).
- [x] 4.2 Run `bun test` and confirm baseline: 868 pass, 5 fail (expected — these are regression tests for a not-yet-fixed bug), 2 skip, 875 total across 54 files.
- [x] 4.3 Update `docs/testing-baseline.xml`:
  - `<LastUpdated>` → today's date.
  - `<Passed>` → `868`.
  - `<Failed>` → `5`.
  - `<TestFiles>` → `54`.
  - `<Total>` → `875`.
- [x] 4.4 Confirm `bun run typecheck` is clean (the test file must not introduce type errors).
- [x] 4.5 Confirm `bun run dev list --format json` still works against the dev-env (`.gemiterm/`) profiles — the regression suite does NOT touch production code.

## 5. Coordination with the fix change

- [x] 5.1 Add a note to `openspec/changes/phantom-auth-ultimate-fix/proposal.md` (via amendment in the next session) referencing the `phantom-auth-detection` capability spec defined in this change's `specs/phantom-auth-detection/spec.md`.
- [ ] 5.2 When `phantom-auth-ultimate-fix` lands, re-run `bun test tests/services/phantom-auth.test.ts` to confirm the five scenarios pass (green).
- [ ] 5.3 Open Question A (probe budget / cache TTL) and Open Question B (empty-list vs. legitimate empty profile) are resolved by the fix change's design; adjust test #4's exact assertion if the chosen TTL differs from the spec's default 5 minutes.

## 6. Documentation

- [x] 6.1 Update `AGENTS.md` "Test Baselining" section if any new test-pattern conventions are introduced (e.g., the `gimme()` helper used in `phantom-auth.test.ts`).
- [x] 6.2 Add a one-line entry to `CHANGELOG.md` under a new "Unreleased" section: "Add phantom-authentication regression suite (`tests/services/phantom-auth.test.ts`) that locks the post-2h silent-empty-list symptom at the `ProfileAuthManager` seam."
