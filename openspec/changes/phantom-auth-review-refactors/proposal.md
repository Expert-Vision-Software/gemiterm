## Why

The `phantom-auth-ultimate-fix` code review (two-axis Standards + Spec)
surfaced one hard standards violation and four baseline code smells. None
are blockers — the fix shipped and all 901 tests pass — but they create
maintenance risk: duplicated comparison logic that must move in lockstep,
typo-prone cookie-name string literals scattered across five files, a
test helper re-declared verbatim in two files, and single-call-site
helpers that violate the repo's own `AGENTS.md` mediation rule ("add new
helpers only when at least 2 call sites need them"). This change pays
down that debt before the next feature lands on top of the new auth
code.

## What Changes

- **Extract cookie-name constants.** `"__Secure-1PSID"` and
  `"__Secure-1PSIDTS"` currently appear as bare string literals in
  `auth-service.ts`, `cookie-monitor.ts`, `cookie-rotation.ts`,
  `cookie-storage-service.ts`, `gemini-client-wrapper.ts`, and
  `profile-auth-manager.ts`. Replace with named constants exported from
  a new `src/core/cookie-constants.ts`. The existing
  `REQUIRED_COOKIE_NAMES` / `REQUIRED_COOKIES` sets in
  `cookie-storage-service.ts` and `cookie-monitor.ts` are deduped onto
  the same source.

- **Extract the `{ activePsid; activePsidts }` baseline type.**
  Currently declared as `RequireRotation` in `cookie-monitor.ts` and
  re-declared as an inline anonymous type in `auth-service.ts`. Lift to
  `CookieBaseline` in `src/core/cookie-constants.ts`; both sites import
  it.

- **Extract the PSID/PSIDTS comparison helper.** The "find `.google.com`
  cookie by name, compare value against baseline" shape is written three
  times: `auth-service.ts` (snapshot extraction + post-monitor diff),
  `cookie-monitor.ts` (`requireRotation` poll gate). Extract a
  `cookiesRotatedFrom(baseline: CookieBaseline, polled: Cookie[]):
  boolean` helper into `src/core/cookie-constants.ts`.

- **Lift the `gimme` test helper.** `tests/services/phantom-auth.test.ts`
  defines a canonical `gimme(listChatsFn)` stub factory;
  `tests/services/profile-auth-manager.test.ts` re-declares a
  line-for-line copy. Move to `tests/services/_helpers.ts` and import
  from both.

- **Fix the io.ts / path-utils.ts single-call-site violation.**
  `writeProfileHasChats`, `readProfileHasChats`, and
  `getProfileHasChatsPath` each have exactly one consumer in `src/`.
  `AGENTS.md` mandates "at least 2 call sites" for new helpers. Add the
  second call site by routing the existing `existsSync` /
  `writeFileSync` calls in `tests/services/profile-auth-manager.test.ts`
  (which currently reach into `node:fs` directly to check the marker)
  through `readProfileHasChats` / `writeProfileHasChats` instead.

## Capabilities

### New Capabilities

(none — this is a pure internal refactoring with no observable behavior
change.)

### Modified Capabilities

- `auth`: adds a requirement that cookie-name identifiers (`__Secure-1PSID`, `__Secure-1PSIDTS`), the `CookieBaseline` type, and the `cookiesRotatedFrom` helper MUST be sourced from a single shared module (`src/core/cookie-constants.ts`). No bare cookie-name string literals may appear in `src/services/` or `src/infrastructure/`.

## Impact

- **Code touched**
  - `src/core/cookie-constants.ts` — **new file**: `SECURE_1PSID`,
    `SECURE_1PSIDTS`, `REQUIRED_COOKIE_NAMES`, `CookieBaseline`,
    `cookiesRotatedFrom`.
  - `src/services/auth-service.ts` — replace inline literals + anonymous
    type + duplicated comparison with imports from `cookie-constants.ts`.
  - `src/services/cookie-monitor.ts` — replace `REQUIRED_COOKIES` set +
    `RequireRotation` type + inline comparison with imports.
  - `src/services/cookie-rotation.ts` — replace inline literals.
  - `src/services/cookie-storage-service.ts` — replace
    `REQUIRED_COOKIE_NAMES` set with import.
  - `src/services/gemini-client-wrapper.ts` — replace inline literals.
  - `src/services/profile-auth-manager.ts` — replace inline literals.
  - `tests/services/_helpers.ts` — **new file**: shared `gimme` factory.
  - `tests/services/phantom-auth.test.ts` — import `gimme` from helper.
  - `tests/services/profile-auth-manager.test.ts` — import `gimme` from
    helper; replace `existsSync` / `writeFileSync` marker checks with
    `readProfileHasChats` / `writeProfileHasChats`.
- **APIs / public surface** — none. All changes are internal module
  reorganization; no exported function signatures change.
- **Dependencies** — none new.
- **Multi-profile** — unaffected; the refactoring is profile-agnostic.
- **TTY** — unaffected.
- **Conformance** — `gemiterm list` non-interactive output is unchanged.
  The full test suite (901 tests) must remain green at every commit.
