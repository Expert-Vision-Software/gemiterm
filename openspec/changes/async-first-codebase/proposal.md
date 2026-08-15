# Proposal: async-first-codebase

## Why

The v2.0.0 rewrite left the file-system layer synchronous: every `io.ts` call, `config.ts` helper, and `CookieStorage`/`ProfileManager` method blocks Bun's event loop. All CLI commands and service methods are already `async`, so the sync IO layer is the remaining blocker to a non-blocking CLI (e.g. cookie monitoring, multi-profile batch export, and interactive prompts all stall behind disk reads) and to future parallelism across profiles.

## What Changes

- Convert every function in `src/infrastructure/io.ts` to async, backed by `node:fs/promises`. Same surface, same `IOError` wrapping, same semantics (always-recursive mkdir, safe returns, parent-dir creation on writes). **BREAKING** at the internal API level: all return `Promise` now; hard cutover, no sync shims.
- Convert the fs-touching `path-utils.ts` functions (`isWSL`, `getProjectRoot`, `getPackageJson`) to async. Pure path-string functions (`resolvePath`, `joinPath`, `getConfigDir`, `getProfilesDir`, `getProfilePath`, `getProfileDir`, `getDefaultProfileMarkerPath`, `getTempFilePath`, `dirnamePath`) stay sync. **BREAKING** for the three converted functions.
- Convert `config.ts` (`getDefaultProfileName`, `setDefaultProfileName`, `listProfiles`, `ensureConfigDir`) to async. **BREAKING**.
- Convert `CookieStorage` and `ProfileManager` methods (`save`, `load`, `delete`, `list`, `create`, `rename`, `setDefault`, `getDefault`, `getStatus`, `getAllStatuses`, `hasValidCookies`, `loadCookiesForApi`) to async. **BREAKING**.
- Update the injected sync dependency types `listProfiles: () => string[]` (in `cli/index.ts` wiring, `command-registry.ts` context, `gemini-queries.ts`, `export-strategy.ts` batch deps) to `() => Promise<string[]>`.
- Update remaining sync IO consumers: `chat-metadata-storage.ts`, `chat-output.ts`, `prompt-file.ts`, `auth-service.ts` (`existsFile`), `export-strategy.ts` (`ensureDir`, `writeTextFile`).
- Playwright/browser automation code (`playwright-cli-driver.ts`, `cookie-monitor.ts`, `auth flow`) is already async; only its `io.ts` call sites get mechanical `await` additions — no logic changes.
- Pure functions (formatters, validators, cli-table, path joins) remain sync by design; "async first" applies to IO-bound code only.
- Tests updated to `await` the converted surfaces; test count baseline updated in this change's `tasks.md`.

## Capabilities

### New Capabilities

_(none — this change converts existing capabilities' interfaces to async)_

### Modified Capabilities

- `path-and-file-mediation`: `io.ts` functions and the fs-touching `path-utils.ts` functions (`isWSL`, `getProjectRoot`, `getPackageJson`) become async; the sync-forbidden rules and the two-module mediation structure are unchanged.
- `storage`: `CookieStorage` and `ProfileManager` method contracts change from sync returns to `Promise` returns; observable behavior (error messages, on-disk layout, freshness rules) is unchanged.
- `configuration`: `getDefaultProfileName`, `setDefaultProfileName`, `listProfiles`, `ensureConfigDir` become async; resolution rules and the exported API surface are otherwise unchanged.

## Impact

- **Code**: `src/infrastructure/{io,path-utils,config,storage}.ts` (conversion cores); `src/cli/index.ts` (wiring + `getPackageJson` call site); `src/cli/utils/{gemini-queries,chat-output,prompt-file,chat-session,profile-resolution}.ts`; `src/cli/command-registry.ts` (context type); `src/services/{auth-service,chat-metadata-storage,export-strategy,profile-lifecycle,profile-auth-manager,playwright-cli-driver}.ts` (await ripple only). Forced ripple from the async `CookieStorage`/`loadCookiesForApi` contracts: `src/services/{cookie-storage-service,gemini-client-wrapper}.ts` — signature-level only (`forProfile`, `loadCookiesForProfile`, `persistRefreshedCookies` become async); the Gemini HTTP/SDK internals are unchanged.
- **Not changed**: prompt layer (`prompts.ts` facade, interactive REPL), Gemini HTTP/SDK client internals, Playwright subprocess protocol, on-disk formats, CLI output bytes, non-interactive `list` output paths (guarded by `tests/integration/commands/list.test.ts`).
- **Tests**: broad `await` ripple across `tests/` mirroring `src/`; baseline 657 pass must hold.
- **Dependencies**: none added or removed (`node:fs/promises` is stdlib).
- **Sensitive areas**: `playwright-cli-driver.ts` touched only mechanically (await `readJsonFile`/`removeDir`); re-run `tests/services/playwright-cli-driver.test.ts` per AGENTS.md.
