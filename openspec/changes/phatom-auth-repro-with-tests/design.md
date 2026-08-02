## Context

The phantom-authentication symptom — `gemiterm list -i` logging "is
authenticated" while every API call returns `[]` — has recurred across many
releases, with each fix solving a different sub-problem. The four-layer
investigation from the planning session (see the plan deliverable
`plan-phantom-authentication-...`) established that the architecture has no
server-side validity probe anywhere in the auth gate:

1. **`checkCookieFreshness`** (`src/infrastructure/storage.ts:41-49`) compares
   `cookie.expires` against `Date.now() + 1h`. Local-only.
2. **`ProfileAuthManager.ensureAuthenticated`**
   (`src/services/profile-auth-manager.ts:54-71`) trusts the local check.
3. **`AuthService.silentRefresh`** (`src/services/auth-service.ts:193-230`) is
   gated behind the local check AND is a no-op when the loaded cookies are
   still valid (poll loop returns the just-loaded cookies on first tick).
4. **`GeminiClientService.persistRefreshedCookies`**
   (`src/services/gemini-client-wrapper.ts:131-141`) merges by `name` only,
   silently overwriting `.youtube.com` cookies with `.google.com` values
   whenever Google rotates.

This change is the regression-test half. It writes the tests that capture
the symptom at the `ProfileAuthManager` / mock SDK seam, so that future
regressions cannot silently slip through CI. The fix itself lives in the
sibling `phantom-auth-ultimate-fix` change.

The seam conventions used here mirror those in
`tests/services/profile-auth-manager.test.ts` — `bun:test`'s `mock`,
`mkdirSync` / `rmSync` for temp config dirs, hand-rolled
`IGeminiClientService` stub, and the existing `CookieStorage` /
`ProfileManager` / `CookieStorageService` constructors.

## Goals / Non-Goals

**Goals:**

- Capture the phantom-auth symptom as four failing tests at the
  `ProfileAuthManager` seam.
- Tests are deterministic, run in <50 ms total, require no Playwright,
  no real browser, no network.
- Tests cover both halves of the bug: (a) the missing server-side probe,
  (b) the merge-by-name corruption.
- Tests pass after the sibling `phantom-auth-ultimate-fix` change lands;
  fail against current code at HEAD.
- Bump `docs/testing-baseline.xml` to reflect the new test file.

**Non-Goals:**

- Implementation of the fix itself.
- Multi-profile regression tests (single profile matches the user's repro).
- Live-network regression tests (would require a real Google session).
- E2E / smoke tests against the compiled CLI binary.
- Refactoring of existing `tests/services/profile-auth-manager.test.ts`
  fixtures.

## Decisions

### D1. Seam: `ProfileAuthManager` + `IGeminiClientService` mock

The `ProfileAuthManager.ensureAuthenticated` method is the natural seam:
- It receives `geminiClient: IGeminiClientService` as an injected dependency
  (`src/services/profile-auth-manager.ts:18`).
- The interface is small (`listChats`, `sendMessage`, `startNewChat`,
  `deleteChat`, `profileHasConversation`, `forProfile`) and is fully
  implementable with hand-rolled mocks.
- After the fix lands, the mock simulates the server-side probe by
  returning `[]` for "session invalid" or a non-empty array for "session
  valid". The `ProfileAuthManager` is expected to either call
  `autoExtendSession` (which calls `silentRefresh`) or return
  `LoadedCookies` / throw `AuthenticationError` based on the probe result.

**Alternatives considered:**

- *Test at the `ListChatsQueryHandler` level.* Rejected because the
  handler returns whatever the client returns; the test would have to
  assert on `Mediator`-level plumbing, not the auth contract. The
  auth contract lives in `ProfileAuthManager`.
- *Test at the `GeminiClientService` level.* Rejected because
  `GeminiClientService` is the layer below the fix. The fix adds a
  probe inside `ProfileAuthManager`, not inside `GeminiClientService`.
  Testing at `GeminiClientService` would couple the test to a specific
  implementation choice (probe vs. no probe) rather than the user-facing
  contract.

### D2. Probe simulation: `geminiClient.listChats({ limit: 1 })` returns `[]` vs. non-empty

The probe is simulated by the mock's `listChats` returning:
- `[]` for "server rejected the session"
- A single-element array `[{ id: "c1", ... }]` for "server accepted the
  session"

The test asserts that:
- When `listChats([])` is returned, `ensureAuthenticated` calls
  `silentRefresh` (and propagates its success/failure).
- When `listChats([{ id: "c1", ... }])` is returned, `ensureAuthenticated`
  does NOT call `silentRefresh`.
- Across multiple `ensureAuthenticated` calls in the same process, the
  probe is memoized and called at most once (this assumes the fix
  implements a process-level cache; see Open Question A for the
  budget-vs-cache trade-off).

### D3. Silent refresh stub: `silentRefresh: (name: string) => Promise<boolean>`

The `ProfileAuthManager` accepts a `SilentRefreshFn` as an injected
dependency (`src/services/profile-auth-manager.ts:11-19`). The test
mocks this with a `mock(async () => true)` or `mock(async () => false)`
spied via `bun:test`'s `mock`. The test asserts:

- `silentRefresh` is called when the probe returns `[]`.
- `silentRefresh` is NOT called when the probe returns non-empty.
- `ensureAuthenticated` throws `AuthenticationError` when the probe
  returns `[]` AND `silentRefresh` returns `false`.

### D4. Cookie fixture: locally-valid cookies with `expires = farFuture`

The fixture is the same as in `tests/services/profile-auth-manager.test.ts`:
two cookies (`__Secure-1PSID` and `__Secure-1PSIDTS`) with `expires` set
to `now + 365 days`. This passes both `validateCookies` and
`checkCookieFreshness`, so `hasValidCookies` returns `true` and the
freshness gate does not trigger auto-extend on its own.

### D5. Test count: 4 tests in one `describe` block

Four tests cover the four facets of the bug:
1. Probe `[]` + silent refresh `true` → success path (refresh triggered).
2. Probe `[]` + silent refresh `false` → AuthenticationError.
3. Probe non-empty → no refresh.
4. Probe budget (cache hit on repeat calls).

Adding a fifth test (e.g., "probe error thrown → silent refresh") would
overlap with #2; the explicit-failure case is the user-visible behavior.
Skipped.

### D6. File location: `tests/services/phantom-auth.test.ts`

Mirrors the existing convention: `tests/services/<name>.test.ts` for
unit tests of services. `tests/integration/` is reserved for
end-to-end command-level tests; this regression suite is at the service
seam, not the command seam, so `tests/services/` is correct.

### D7. Baseline XML bump

`docs/testing-baseline.xml` line 14 shows `<Passed>868</Passed>` and
`<Total>870</Total>`. Adding 4 tests → 872 pass / 0 fail / 2 skip.
The `<LastUpdated>` timestamp also gets bumped. The change captures the
exact baseline counts in the implementation pass.

## Risks / Trade-offs

- **[Risk] Tests depend on the fix adding a process-level cache for the
  probe.** If the fix instead runs the probe on every `ensureAuthenticated`
  call, test #4 fails. **Mitigation:** the design documents the cache
  requirement; if the fix skips the cache, test #4 is adjusted to expect
  ≥ 1 probe per call (still red-capable). The spec scenario "Probe budget"
  is the contract; the test is a witness, not a design choice.
- **[Risk] Tests assume `IGeminiClientService.listChats({ limit: 1 })` as the
  probe.** If the fix uses a different probe (e.g., `getProfileStatuses`
  or a custom OPTIONS pre-flight), test #1 / #3 still pass (they only
  assert behavior, not the call shape), but a strict mock would need to
  handle the alternative. **Mitigation:** the mock's `listChats` is
  generic — it accepts any options argument and returns the canned
  response. If the fix uses a non-`listChats` probe, the mock needs a
  new method, but the test logic is unchanged.
- **[Risk] Cookie fixture uses `domain: ".google.com"` only.** The
  `(name, domain)` merge test uses a multi-domain fixture that does NOT
  exist in the current test infrastructure. **Mitigation:** the test
  file defines its own multi-domain fixture inline; no shared fixture
  change needed.
- **[No-op risk] Test passes on current code by accident.** Mitigation:
  the test asserts `silentRefresh.toHaveBeenCalledTimes(1)` and
  `secure_1psid !== "active-psid"` — both are direct user-visible
  behaviors that the current code does NOT exhibit.

## Migration Plan

This is an additive change — no migration steps.

- **Backward compatibility:** every existing test continues to pass; the
  four new tests are net new.
- **Rollout:** ships with the sibling `phantom-auth-ultimate-fix`
  change in the same release, so CI flips from "phantom-auth tests
  failing on current code" to "phantom-auth tests passing on fixed
  code" in one PR.
- **Rollback:** revert the commit. Test count returns to 868 pass / 2
  skip / 0 fail.

## Open Questions

- **A. Probe budget.** The spec says "at most once per process per profile
  per TTL window". Test #4 asserts the at-most-once contract for a
  default 5-minute TTL. If the fix chooses a different TTL (e.g., 24h or
  per-command), test #4's exact assertion (`mock.calls.length <= 1`)
  may need to relax to `mock.calls.length <= N` where `N` is the
  per-process ceiling. The test will be aligned with the fix's chosen
  budget during implementation.
- **B. Empty-list vs. legitimate empty profile.** A profile that
  legitimately has zero chats also produces `listChats([])`. The fix
  needs to distinguish "this profile has zero chats" from "this session
  is rejected". Test #1 simulates the rejection case (mock returns `[]`
  and `silentRefresh` is expected to be called); the fix is responsible
  for choosing a probe that's safe to call on a legitimately-empty
  profile. Likely candidates: a non-`listChats` probe, or a comparison
  against a cached chat-count baseline. Tracked in the
  `phantom-auth-ultimate-fix` change.