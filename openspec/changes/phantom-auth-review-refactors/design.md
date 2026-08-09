## Context

The `phantom-auth-ultimate-fix` change (commits `ee347fa`–`99af2dc`)
introduced five interconnected auth modules (`profile-auth-manager.ts`,
`auth-service.ts`, `cookie-monitor.ts`, `cookie-rotation.ts`,
`gemini-client-wrapper.ts`) plus updates to `cookie-storage-service.ts`,
`io.ts`, and `path-utils.ts`. The two-axis code review (Standards + Spec)
flagged one hard violation and four baseline smells across these files.
All five are duplicated-knowledge problems: the same cookie-name strings,
the same baseline-comparison shape, the same test-helper factory, and
single-call-site helpers that violate the repo's own mediation rule.

The current state (verified at commit `2bb66d2`):

| Smell | Files | Occurrences |
|---|---|---|
| `"__Secure-1PSID"` / `"__Secure-1PSIDTS"` literals | 6 src files | 14+ |
| `REQUIRED_COOKIE_NAMES` / `REQUIRED_COOKIES` set | 2 files | 2 (duplicated) |
| `{ activePsid; activePsidts }` type | 2 files | 2 (duplicated) |
| PSID/PSIDTS `.google.com` find + compare | 3 call sites | 3 |
| `gimme(listChatsFn)` test factory | 2 test files | 2 (duplicated) |
| `writeProfileHasChats` / `readProfileHasChats` / `getProfileHasChatsPath` | 1 call site each | violates AGENTS.md |

## Goals / Non-Goals

**Goals:**
- Single source of truth for cookie-name identifiers and the
  `CookieBaseline` type.
- A shared `cookiesRotatedFrom` helper so the three comparison sites
  can't drift.
- A shared `gimme` test factory so the canonical stub pattern lives in
  one place.
- Bring `writeProfileHasChats` / `readProfileHasChats` /
  `getProfileHasChatsPath` into compliance with the AGENTS.md "2 call
  sites" rule by routing test assertions through them.
- Zero test-count change, zero behavior change. The 901-test suite stays
  green at every commit.

**Non-Goals:**
- No new features, no API changes, no spec-level requirement changes.
- No restructuring of the `ProfileAuthManager` / `AuthService` class
  boundaries (that's a larger refactoring).
- No changes to the `CookieMonitor` polling loop semantics.
- No extraction of the `profile-has-chats` marker logic into its own
  service (the helpers stay in `io.ts` / `path-utils.ts`).

## Decisions

### D1. Home for shared cookie constants: `src/core/cookie-constants.ts`

**Choice:** New file `src/core/cookie-constants.ts`.

**Rationale:** The constants are domain-level identifiers (cookie names
recognized by Google's auth system), not infrastructure concerns. They
belong in `src/core/` alongside `types.ts` (which defines the `Cookie`
type) and `errors.ts`. Putting them in any of the five service files
would create a cyclic-import risk (all five services need them; none
should depend on another just for a constant). The
`path-and-file-mediation` CI rule is not triggered because
`cookie-constants.ts` imports nothing from `node:fs` / `node:path` /
`node:os`.

**Alternatives considered:**
- `src/core/types.ts` — rejected: `types.ts` is type-only; adding
  runtime constants muddies its purpose.
- `src/services/cookie-names.ts` — rejected: creates a
  services-layer dependency for `profile-auth-manager.ts` (which is
  itself a service, so no cycle, but `core/` is the more natural home
  for domain identifiers).

### D2. The `CookieBaseline` type and `cookiesRotatedFrom` helper

**Choice:** Export `CookieBaseline` (the `{ activePsid: string;
activePsidts: string | null }` shape) and `cookiesRotatedFrom(baseline,
polled): boolean` from `cookie-constants.ts`.

The helper encapsulates the "find `.google.com` PSID/PSIDTS in `polled`,
compare against `baseline`" logic currently written inline in
`auth-service.ts` (post-monitor diff) and `cookie-monitor.ts`
(`requireRotation` poll gate).

**Rationale:** The two sites have slightly different semantics —
`auth-service.ts` needs to know *whether* rotation happened (boolean);
`cookie-monitor.ts` needs to know *whether to fire* (boolean). Both are
the same boolean. A single helper that returns `true` when either PSID
or PSIDTS differs from the baseline covers both.

The snapshot-extraction code in `auth-service.ts` (which *builds* the
baseline from a `Cookie[]`) is a separate concern and stays inline —
it's a one-off construction, not a duplicated shape.

**Alternatives considered:**
- Move the `RequireRotation` interface from `cookie-monitor.ts` to
  `cookie-constants.ts` and rename — rejected: `CookieBaseline` is a
  better name (it describes what the data *is*, not how it's *used*),
  and `cookie-monitor.ts` can re-export it as `RequireRotation =
  CookieBaseline` for backward compatibility if needed. But since this
  is an internal refactoring with no external consumers, a clean rename
  is fine.

### D3. The `gimme` test helper: `tests/services/_helpers.ts`

**Choice:** New file `tests/services/_helpers.ts` exporting `gimme` and
the `GimmeClient` interface.

**Rationale:** The `tests/` tree mirrors `src/` but has no shared-utils
convention today. The leading underscore in `_helpers.ts` signals
"private to tests, not a test file itself" and prevents `bun test` from
picking it up as a test file (bun matches `*.test.ts`). Both
`phantom-auth.test.ts` and `profile-auth-manager.test.ts` import from
it.

**Alternatives considered:**
- `tests/setup.ts` — rejected: `setup.ts` already exists and handles
  `beforeEach`/`afterEach` config-dir setup; mixing helpers there
  conflates two concerns.
- `tests/helpers/gimme.ts` — rejected: a directory for one file is
  overkill; if more helpers accumulate later, the directory can be
  created then.

### D4. Single-call-site fix: route test assertions through the helpers

**Choice:** In `tests/services/profile-auth-manager.test.ts`, replace
the two `existsSync(markerPath)` / `writeFileSync(markerPath, "")` calls
with `readProfileHasChats(name)` / `writeProfileHasChats(name)` from
`src/infrastructure/io.ts`.

**Rationale:** This adds the second call site that `AGENTS.md` requires
without changing any production code. The tests currently reach into
`node:fs` directly (which is allowed in `tests/` — the CI mediation
check only scans `src/`), but routing through the mediated helper is
more idiomatic and exercises the helper's round-trip. The import
already exists in `src/services/profile-auth-manager.ts`; the test now
imports it too.

## Risks / Trade-offs

- **[Risk] Import-cycle introduction.** `src/core/cookie-constants.ts`
  is imported by all five service files. If it imports from any of them
  back, a cycle forms. **Mitigation:** `cookie-constants.ts` imports
  only from `src/core/types.ts` (for the `Cookie` type). No service
  imports flow back.
- **[Risk] Helper semantics drift between the two comparison sites.**
  The `auth-service.ts` post-monitor diff and the `cookie-monitor.ts`
  poll gate currently have subtly different logic (the monitor gate
  checks "both match → suppress"; the service diff checks "either
  differs → accept"). **Mitigation:** `cookiesRotatedFrom` returns
  `true` when either PSID or PSIDTS differs — this satisfies both
  sites: the monitor uses `!cookiesRotatedFrom(...)` to suppress, the
  service uses `cookiesRotatedFrom(...)` to accept. Documented in the
  helper's JSDoc.
- **[Risk] Test-count regression.** The refactoring must not change any
  test count. **Mitigation:** Every commit runs `bun test` and confirms
  990 pass / 1 skip / 991 total.

## Migration Plan

- **Backward compatibility:** No public API changes. All refactoring is
  internal module reorganization.
- **Rollout:** Single PR, commits per concern (constants, helper, test
  lift, io.ts call-site fix).
- **Rollback:** Revert the commit(s). No data migration, no config
  changes.
