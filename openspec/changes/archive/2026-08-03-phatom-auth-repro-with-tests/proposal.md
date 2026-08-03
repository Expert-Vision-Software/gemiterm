## Why

The "auth profiles refuse to stay logged in after ~2 hours" symptom has
recurred across many releases (`7e2c486`, `99d0b17`, `da215dc`, `2392a8d`),
and each commit-layer fix solved a different sub-problem without locking
the actual symptom down at a test seam. This change defines the
regression suite that captures the symptom as failing tests at the
`ProfileAuthManager` seam — tests that will go **red** on the current
code and **green** only after the sibling `phantom-auth-ultimate-fix`
change implements the server-side validity probe, the silent-refresh
hardening, and the `(name, domain)` merge fix. Once these tests are
checked in, the next regression of the same symptom family cannot
silently slip through CI.

## What Changes

- **Add `tests/services/phantom-auth.test.ts`** with four tests that lock
  down the phantom-auth symptom at the `ProfileAuthManager` / mock SDK
  seam:
  - "locally-valid cookies + server returns `[]` ≠ success; silently
    returning cookies is a regression"
  - "`listChats([])` followed by a failed silent refresh surfaces
    `AuthenticationError`, not silent success"
  - "`listChats(non-empty)` means session is valid; we DO NOT spend a
    silent refresh"
  - "first-time `ensureAuthenticated` (no probe yet) skips the server
    probe and relies on local freshness"
- **Define the `phantom-auth-detection` capability spec** at
  `specs/phantom-auth-detection/spec.md`. The spec codifies the
  server-side validity contract that the sibling
  `phantom-auth-ultimate-fix` change must satisfy: when local cookies
  pass freshness, the system MUST consult a server-side probe before
  declaring the session authenticated; an empty probe result MUST
  trigger silent refresh; silent refresh MUST be a no-op detector.
- **Bump `docs/testing-baseline.xml`** to reflect the new test file
  (currently 868 pass / 2 skip / 0 fail).
- **No production code is modified** by this change. The tests are
  red-capable against the current implementation; the sibling
  `phantom-auth-ultimate-fix` change is what flips them green.

## Capabilities

### New Capabilities

- `phantom-auth-detection` — the server-side session validity contract.
  This spec owns the four regression scenarios enumerated in the test
  file. The spec is referenced by both this change (which writes the
  tests) and the sibling `phantom-auth-ultimate-fix` change (which
  implements the contract).

### Modified Capabilities

- (none — no existing requirement changes)

## Impact

- **Code touched**
  - `tests/services/phantom-auth.test.ts` — **new** file (~150 lines).
    Mirrors the seam conventions of `tests/services/profile-auth-manager.test.ts`:
    uses `mock.module` patterns from `bun:test`, exercises the
    `ProfileAuthManager` with a hand-rolled `IGeminiClientService` mock,
    no Playwright, no real browser, no network.
  - `openspec/changes/phatom-auth-repro-with-tests/specs/phantom-auth-detection/spec.md`
    — **new** capability spec.
  - `docs/testing-baseline.xml` — bump test count and `<LastUpdated>`
    timestamp.
- **APIs / public surface** — none. The test file does not export
  anything; it only adds `describe`/`test` blocks.
- **Dependencies** — none new. Reuses `bun:test`, the existing
  `CookieStorage` / `ProfileManager` / `CookieStorageService` /
  `ProfileAuthManager` seams, and the `IGeminiClientService` interface
  from `src/core/command-handlers.ts`.
- **Multi-profile** — the regression suite covers single-profile
  behaviour (the user's repro is a single default profile). A
  multi-profile variant is non-goal here and is tracked separately.
- **TTY** — N/A. The tests do not exercise any prompt.
- **Conformance** — no command output changes. The test count goes up
  by 4 and the baseline XML gets the corresponding bump.

## Sibling Change

This change is the regression-test half of the bug fix. The other half
is the sibling `phantom-auth-ultimate-fix` change (currently filed as
a draft with only `proposal.md`). The two changes share the
`phantom-auth-detection` capability spec: this change writes the tests
that exercise the spec, the sibling change writes the implementation
that satisfies the spec.

## Non-Goals

- Implementation of the fix itself (lives in
  `phantom-auth-ultimate-fix`).
- Multi-profile regression tests (single profile matches the user's
  repro; multi-profile is a follow-up).
- Live-network regression tests (would require a real Google session;
  the mock seam is sufficient to capture the bug pattern).
- E2E / smoke tests against the compiled CLI binary (the unit tests
  at the `ProfileAuthManager` seam are deterministic and fast).
- Refactoring of the existing `tests/services/profile-auth-manager.test.ts`
  fixtures. New fixtures live in the new test file.