# Design: async-first-codebase

## Context

The v2.0.0 Bun rewrite is async at the edges (all 11 CLI commands, all service public APIs, the Playwright subprocess driver) but synchronous at the IO core. Blocking calls concentrate in four modules:

- `src/infrastructure/io.ts` — every function wraps a `node:fs` `*Sync` call.
- `src/infrastructure/path-utils.ts` — `isWSL`, `getProjectRoot`, `getPackageJson` read the disk synchronously; the rest are pure string joins.
- `src/infrastructure/config.ts` — `getDefaultProfileName`, `setDefaultProfileName`, `listProfiles`, `ensureConfigDir` are sync IO.
- `src/infrastructure/storage.ts` — `CookieStorage` and `ProfileManager` are entirely sync.

The sync surface is injected outward through `listProfiles: () => string[]` dependency types (`cli/index.ts`, `command-registry.ts`, `gemini-queries.ts`, `export-strategy.ts`). User-confirmed scope: **IO-bound code only** (pure formatters/validators/path joins stay sync) and **hard cutover** (no sync/async dual API).

Constraints: path-and-file mediation (only `io.ts` and `path-utils.ts` may import `node:fs`; enforced by `scripts/lint-path-mediation.sh` in CI), byte-stable non-interactive CLI output, and the sensitive Playwright auth area.

## Goals / Non-Goals

**Goals:**

- No blocking filesystem calls anywhere on the runtime hot path; every IO-bound function in `src/` returns a `Promise`.
- Single hard cutover: after this change, the sync variants no longer exist.
- Zero observable behavior change: identical error messages (`IOError` text, `No storage state found`, `already exists`, `does not exist`), identical on-disk formats, identical CLI output bytes.
- Full `bun test` suite green at the 657-test baseline (count updated if tests are added/merged, not lost).

**Non-Goals:**

- Making pure functions async (formatters, validators, cli-table, path string builders).
- Parallelizing profile operations (e.g. `Promise.all` across profiles in batch export) — the dependency types gained in this change make it possible later, but introducing concurrency now would change timing-sensitive behavior.
- Any change to the Playwright subprocess protocol, prompt layer, Gemini HTTP client, or on-disk layouts.
- A transitional dual API or codemod tooling.

## Decisions

### D1: `io.ts` wraps `node:fs/promises`, preserving exact semantics

Each function becomes `async` and awaits the promise counterpart (`readFile` for `readFileSync`, etc.). `writeTextFile` keeps its resolve-parent-then-mkdir-then-write order; error wrapping stays `wrap(op, path, cause) -> IOError` so message text is unchanged.

Alternatives considered: Bun-native `Bun.file()`/`Bun.write()` (rejected — divergent error shapes and edge-case semantics from `node:fs` would make the "identical error messages" goal unverifiable; `node:fs/promises` is a mechanical 1:1 mapping).

### D2: `path-utils.ts` splits into sync pure functions and three async fs functions

`isWSL`, `getProjectRoot`, `getPackageJson` become `async`. The build-time `__GEMITERM_VERSION__` constant-folding path in `getPackageJson` is preserved: the fast path still avoids disk IO, and an `async` function returning a precomputed constant is free. All other exports stay sync. This keeps the "async only where IO-bound" rule crisp and minimizes await-ripple.

### D3: `config.ts` and `storage.ts` convert in place, signatures gain `Promise`

`CookieStorage`/`ProfileManager` methods and the four `config.ts` helpers become `async` with unchanged bodies apart from `await`s. Internal sync helpers that are pure computations (`validateCookies`, `getCookieExpiryTimestamp`, `checkCookieFreshness`) stay sync. The injected dependency type becomes `listProfiles: () => Promise<string[]>` everywhere it appears; call sites `await` it. This is a mechanical, reviewable ripple rather than a redesign.

### D4: Hard cutover, bottom-up conversion order

Convert `io.ts` first, then `path-utils.ts` async trio, then `config.ts`, then `storage.ts`, then the consumer ripple outward (services → cli/utils → command wiring). `tsc --noEmit` (`bun run typecheck`) is the completion oracle: missing `await`s surface as `Promise`-in-`boolean`/`string` type errors, so typecheck drives the migration the same way tests verify it.

Alternative considered: dual API with sync shims delegating to async (rejected by user decision; also would keep blocking calls alive indefinitely, defeating the purpose).

### D5: Playwright area is await-only, surgical

`playwright-cli-driver.ts` (`readJsonFile`, `removeDir`), `auth-service.ts` (`existsFile`, `ensureConfigDir`), and `cookie-monitor.ts` are touched only to add `await` at existing `io.ts` call sites. No protocol, polling, or parsing logic changes. Per AGENTS.md, `tests/services/playwright-cli-driver.test.ts` must pass before commit.

### D6: `safeReadTextFile` and boolean probes keep their swallowing semantics

`safeReadTextFile`, `isDirectory`, `getFileMtime` catch-all behavior returns resolved defaults (`""`, `false`, `null`) — the async versions keep identical catch-and-return contracts rather than rejecting.

## Risks / Trade-offs

- [Missed `await` produces `Promise<...>` leaking into logic (e.g. `if (await-less existsFile(...))` always truthy)] → `bun run typecheck` after each module; strict return types make these compile errors, and `bun test` catches behavioral slips.
- [Behavior drift in error paths (message text, throw-vs-return)] → spec scenarios for `storage`/`configuration` pin exact error substrings; integration tests for non-interactive `list` byte-equivalence guard output.
- [Large diff touches sensitive auth area] → Playwright-area edits limited to mechanical `await` insertion; run `tests/services/playwright-cli-driver.test.ts` and full `bun test` before commit; conventional-commits per module boundary.
- [`getPackageJson` async ripples into `cli/index.ts` startup] → startup already lives inside an async context (`main`/await chain); verified during implementation, no top-level-await introduced.
- [Test churn obscures real failures] → tests updated in the same bottom-up order; baseline count checked after each phase (`657 pass, 0 fail`).

## Migration Plan

Single-PR, single-cutover on top of HEAD. Order: `io.ts` → `path-utils.ts` → `config.ts` → `storage.ts` → services → cli utils/wiring → tests. Rollback is `git revert` of the single commit series; no on-disk state is migrated, so rollback is trivial. `scripts/lint-path-mediation.sh` exemption lists are untouched (no new `node:fs` importers).

## Open Questions

_(none — scope and cutover style confirmed with the user; all remaining decisions are mechanical)_
