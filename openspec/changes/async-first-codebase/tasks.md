# Tasks: async-first-codebase

Baseline: `bun test` -> 657 pass, 0 fail. Run `bun run typecheck` after each group; run `bun run lint:mediation` (bash form) after groups touching `src/infrastructure/`. Conventional commits per group; never push.

## 1. io.ts conversion (the core)

- [x] 1.1 Convert all `src/infrastructure/io.ts` functions to `async` backed by `node:fs/promises` (`ensureDir`, `existsFile`, `readTextFile`, `safeReadTextFile`, `writeTextFile`, `readJsonFile`, `writeJsonFile`, `removeDir`, `removeFile`, `renameDir`, `isDirectory`, `listSubdirectories`, `getFileMtime`); preserve `IOError` wrapping, message text, and safe-return semantics exactly
- [x] 1.2 Run `bun run typecheck` and list every compile error caused by the io.ts cutover (this is the consumer worklist for groups 3-6)

## 2. path-utils.ts async trio

- [x] 2.1 Convert `isWSL`, `getProjectRoot`, `getPackageJson` in `src/infrastructure/path-utils.ts` to `async`; preserve the `__GEMITERM_VERSION__` build-time fast path (no disk IO when constants are injected); keep all pure path functions sync
- [x] 2.2 Update `cli/index.ts` `getPackageJson` call site to `await`; confirm no top-level await is introduced

## 3. config.ts and storage.ts

- [x] 3.1 Convert `getDefaultProfileName`, `setDefaultProfileName`, `listProfiles`, `ensureConfigDir` in `src/infrastructure/config.ts` to `async` (rule: IO-bound only; keep `getConfigDir`-style re-exports sync)
- [x] 3.2 Convert `CookieStorage` methods (`save`, `load`, `delete`, `list`) in `src/infrastructure/storage.ts` to `async`; keep pure helpers (`validateCookies`, `getCookieExpiryTimestamp`, `checkCookieFreshness`) sync
- [x] 3.3 Convert `ProfileManager` methods (`create`, `delete`, `rename`, `setDefault`, `getDefault`, `list`, `getStatus`, `getAllStatuses`, `hasValidCookies`, `loadCookiesForApi`) to `async`; error messages unchanged (`already exists`, `does not exist`, `expired`, `No storage state found`)

## 4. Services ripple (await-only, no logic changes)

- [x] 4.1 `src/services/playwright-cli-driver.ts` — await `readJsonFile`/`removeDir` call sites only (sensitive area: no protocol/parsing changes; re-read `tests/services/playwright-cli-driver.test.ts` expectations before committing)
- [x] 4.2 `src/services/auth-service.ts` — await `existsFile`, `ensureConfigDir`, `getDefaultProfileName` call sites
- [x] 4.3 `src/services/profile-lifecycle.ts` and `src/services/profile-auth-manager.ts` — await all `listProfiles`/`getDefaultProfileName`/`ensureConfigDir` call sites
- [x] 4.4 `src/services/chat-metadata-storage.ts` — convert its sync `io.ts` consumers to `async`
- [x] 4.5 `src/services/export-strategy.ts` — await `ensureDir`/`writeTextFile`; change batch dep type `listProfiles: () => Promise<string[]>` and await its call site
- [x] 4.6 `src/services/cookie-storage-service.ts` and `src/services/gemini-client-wrapper.ts` — await any sync `CookieStorage`/`ProfileManager`/`config.ts` calls surfaced by typecheck

## 5. CLI ripple

- [x] 5.1 `src/cli/utils/gemini-queries.ts` — change dep type `listProfiles: () => Promise<string[]>`, await call site
- [x] 5.2 `src/cli/utils/chat-output.ts` and `src/cli/utils/prompt-file.ts` — await `io.ts` calls
- [x] 5.3 `src/cli/command-registry.ts` + `src/cli/index.ts` — update `CliCommandContext.listProfiles` type to `() => Promise<string[]>`; await wiring call sites (`listProfiles()`, `getDefaultProfileName()`, `CookieStorage`/`ProfileManager` usage)
- [x] 5.4 `src/cli/commands/list-command.ts` — await `context.listProfiles().length` check (line ~105); confirm non-interactive `list` output stays byte-identical (gate: `tests/integration/commands/list.test.ts`)

## 6. Tests

- [x] 6.1 Update `tests/infrastructure/` (io, storage) and `tests/unit/config.test.ts` to `await` converted surfaces; assertions unchanged
- [x] 6.2 Update remaining test files surfaced by `bun run typecheck` / failing `bun test` runs (services, cli utils, commands, integration) — await-ripple only, no assertion changes
- [x] 6.3 Full `bun test` green with 0 failures; recorded: 864 total (862 pass, 2 skip, 0 fail) — the 657 figure in AGENTS.md was stale; no tests lost

## 7. Verification gates

- [x] 7.1 `bun run typecheck` clean
- [x] 7.2 `bun run lint:mediation` (bash form) passes — no new `node:fs` importers, exemption lists untouched
- [x] 7.3 `bun test` full suite green (baseline from 6.3)
- [x] 7.4 `bun run dev -- --version` prints `2.0.0` (smoke gate: `tests/smoke/smoke.test.ts`)
- [x] 7.5 Sensitive-area re-check: `bun test tests/services/playwright-cli-driver.test.ts` passes; confirm `src/cli/utils/prompts.ts` facade untouched
