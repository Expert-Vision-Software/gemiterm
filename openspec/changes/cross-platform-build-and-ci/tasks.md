## 1. Extend path-utils.ts with the WSL detection, project root, and package.json helpers

- [x] 1.1 Add `isWSL(): boolean` to `src/infrastructure/path-utils.ts`. The function MUST gate on `process.platform === 'linux'` and return `true` if `/proc/version` exists and contains "microsoft" or "WSL" (case-insensitive) OR `WSL_DISTRO_NAME` is set and non-empty. The function MUST return `false` on any other platform.
- [x] 1.2 Add `getProjectRoot(): string` to `src/infrastructure/path-utils.ts`. The function MUST walk up from `import.meta.url` (passed in as a parameter) until it finds a directory containing `package.json`, and return the absolute path. Replaces the `__filename` / `__dirname` dance in `src/cli/index.ts:33-35`.
- [x] 1.3 Add `getPackageJson(): { name: string; version: string; [key: string]: unknown }` to `src/infrastructure/path-utils.ts`. The function MUST call `getProjectRoot()` + `readTextFile(<root>/package.json)` + `JSON.parse` and return the parsed object. On any error, the function MUST return `{ name: "gemiterm", version: "unknown" }` (the fallback keeps `--version` working in a broken environment).

## 2. Create src/infrastructure/io.ts

- [x] 2.1 Create `src/infrastructure/io.ts` with the following exports. Each function MUST be a thin wrapper around the equivalent `node:fs` call with consistent semantics (always-recursive `mkdir`, safe returns, clear error messages).
  - `ensureDir(path: string): void` — wraps `mkdirSync(path, { recursive: true })`. Throws on EACCES / EPERM with the absolute path in the error message.
  - `existsFile(path: string): boolean` — wraps `existsSync`.
  - `readTextFile(path: string): string` — wraps `readFileSync(path, 'utf-8')`. Throws a typed `IOError` with the absolute path on ENOENT / EACCES.
  - `safeReadTextFile(path: string): string` — wraps `readFileSync` in a try/catch; returns `""` on any error (ENOENT, EACCES, EISDIR). Includes a code comment that the `""` return conflates "file does not exist" with "file exists but is empty" and is appropriate for callers that only need a string for `.includes()` / `.trim()` checks.
  - `writeTextFile(path: string, content: string): void` — resolves the path, ensures the parent directory exists (recursively), and writes `content` as UTF-8. Throws a typed `IOError` on EACCES / ENOSPC.
  - `readJsonFile<T>(path: string): T` — wraps `readTextFile` + `JSON.parse`. Throws a typed `IOError` with a `cause` field on parse failure.
  - `writeJsonFile(path: string, data: unknown): void` — wraps `writeTextFile` with `JSON.stringify(data, null, 2)`.
  - `removeDir(path: string): void` — wraps `rmSync(path, { recursive: true, force: true })`. No-op if the path does not exist.
  - `renameDir(src: string, dest: string): void` — wraps `renameSync`. Throws on ENOENT (source missing) or EEXIST (dest present) with a clear message.
  - `isDirectory(path: string): boolean` — wraps `statSync(path).isDirectory()` in a try/catch; returns `false` if the path does not exist.
  - `listSubdirectories(path: string): string[]` — wraps `readdirSync` + filter to directories only. Returns `[]` if the path does not exist.
- [x] 2.2 Define and export a class `IOError extends Error` with a `cause` field for the original error (when applicable). All other functions throw `IOError` instead of raw `Error`.
- [x] 2.3 Add a JSDoc comment at the top of `io.ts` stating the rule: "This is the canonical home for file-system access in `src/`. No other source file in `src/` may import from `node:fs` or `node:path` directly. The only allowed exception is `src/services/install-browser-service.ts`, which may use `node:path` for the WSL mount parser."

## 3. Refactor install-browser-service.ts to use the shared platform module and io.ts

- [x] 3.1 In `src/services/install-browser-service.ts`:
  - Delete the private `isWsl()` method (lines 143-149) and the `readFileSafe` helper (lines 173-179).
  - Add imports: `import { isWSL } from "../infrastructure/path-utils.ts";` and `import { existsFile, safeReadTextFile } from "../infrastructure/io.ts";`.
  - Replace every call to `this.isWsl()` with `isWSL()`.
  - Replace every call to `this.readFileSafe(path)` with `safeReadTextFile(path)`.
  - Replace every call to `existsSync(path)` with `existsFile(path)`.
  - Unify `getEdgePaths()` and `getChromePaths()` (lines 84-100) behind a single local helper `getWindowsKnownDirs()` that returns `{ programFiles, localAppData }`. The two methods collapse to ~5 lines each.
- [x] 3.2 Verify the behavior is preserved. The dispatch logic in `findSystemBrowser` (lines 57-65) and `findLinuxBrowser` (lines 102-122) MUST continue to behave identically. The 5 unit tests in `tests/services/install-browser-service.test.ts` are the regression gate; the 432/432 baseline MUST be preserved.
- [x] 3.3 Do NOT touch `src/services/playwright-cli-driver.ts`, `src/services/cookie-monitor.ts`, or `src/services/auth-service.ts` in this task — they are sensitive and out of scope.

## 4. Refactor storage.ts and config.ts to use io.ts

- [x] 4.1 In `src/infrastructure/storage.ts`:
  - Drop the `node:fs` import (lines 1-8).
  - Add `import { ensureDir, existsFile, readJsonFile, writeTextFile, removeDir, renameDir } from "./io.ts";`.
  - `CookieStorage.save()` (lines 52-58) → use `writeTextFile(filePath, JSON.stringify(state, null, 2))`.
  - `CookieStorage.load()` (lines 60-70) → use `readJsonFile<StorageState>(filePath)`.
  - `CookieStorage.delete()` (lines 72-77) → use `removeDir(dir)`.
  - `ProfileManager.create()` (lines 91-101) → use `existsFile` + `ensureDir`.
  - `ProfileManager.delete()` (lines 103-116) → use `removeDir` + `existsFile` + `removeFile` (or `rmSync` on the marker).
  - `ProfileManager.rename()` (lines 118-131) → use `existsFile` + `renameDir`.
  - `ProfileManager.setDefault()` (lines 133-138) → use `existsFile`.
  - `ProfileManager.getStatus()` (lines 148-184) → use `existsFile`.
- [x] 4.2 In `src/infrastructure/config.ts`:
  - Drop the `node:fs` and `node:path` imports (lines 1-2).
  - Add `import { ensureDir, existsFile, readTextFile, writeTextFile, isDirectory, listSubdirectories } from "./io.ts";`.
  - Drop the alias re-exports from `path-utils.ts` (lines 3-9). Use the `path-utils.ts` exports directly.
  - `getDefaultProfileName()` (lines 23-29) → use `existsFile` + `readTextFile`. Fall back to `"default"` if the marker does not exist.
  - `setDefaultProfileName(name)` (lines 31-36) → use `writeTextFile` + `ensureDir(dirname(marker))`.
  - `listProfiles()` (lines 38-47) → use `listSubdirectories` + filter on `DEFAULT_PROFILE_MARKER`.
  - `ensureConfigDir()` (lines 49-54) → use `ensureDir`.
  - The file should shrink from 64 lines to ~40.
- [x] 4.3 Run `bun test tests/infrastructure/storage.test.ts` and confirm all 21 tests still pass. The 432/432 baseline MUST be maintained across the full `bun test` run.

## 5. Refactor the 4 export commands to use writeTextFile

- [x] 5.1 `src/cli/commands/export-command.ts:72-82` — replace the 3-line `resolve + dirname + mkdirSync + writeFileSync` block with a single `writeTextFile(outputPath, content)` call. Drop the `node:fs` and `node:path` imports.
- [x] 5.2 `src/cli/commands/export-all-command.ts:79-80` — replace `mkdirSync(outputDir, { recursive: true })` with `ensureDir(outputDir)`. Drop the `node:fs` and `node:path` imports.
- [x] 5.3 `src/cli/commands/export-all-command.ts:96-104` — replace the `writeFileSync(filePath, content, "utf-8")` with `writeTextFile(filePath, content)`.
- [x] 5.4 `src/cli/commands/export-all-command.ts:177-178` (the `index.md` write) — replace with `writeTextFile(indexPath, lines.join("\n"))`. The `join(outputDir, "index.md")` and `join(outputDir, "index.md")` (line 192, the `console.log`) call remain — these are path operations, which `io.ts` does not own; if the file becomes path-only, keep `node:path` import here.
- [x] 5.5 `src/cli/commands/list-command.ts:138-143` — replace the `writeOutput` method body with a single `writeTextFile(path, content)` call. Drop the `node:fs` and `node:path` imports.
- [x] 5.6 `src/cli/commands/fetch-command.ts:121-127` — same as 5.5. Once both 5.5 and 5.6 are converted, they are 2-line methods. Keep the duplication; do not extract a shared helper.
- [x] 5.7 Run the integration tests in `tests/integration/commands/{export,list,fetch}.test.ts` and `tests/cli/export-all-command.test.ts`; confirm they all still pass.

## 6. Refactor cli/index.ts to use getPackageJson()

- [x] 6.1 `src/cli/index.ts:3-5` — drop the `node:url`, `node:path`, and `node:fs` imports.
- [x] 6.2 `src/cli/index.ts:33-35` — replace with a single `const pkg = getPackageJson();` call. Add `import { getPackageJson } from "../infrastructure/path-utils.ts";`.
- [x] 6.3 Verify the version printed by `--version` is still `2.0.0` (the value in `package.json`). The smoke test in `tests/smoke/smoke.test.ts` is the regression gate.

## 7. Add tests for the new helpers

- [x] 7.1 Extend `tests/unit/path-utils.test.ts` with the following test groups:
  - `isWSL` — at minimum 4 tests: returns false on non-linux, returns true when `WSL_DISTRO_NAME` is set, returns true when `/proc/version` contains "microsoft" (mock the file), returns false on native Linux.
  - `getProjectRoot` — 2 tests: returns the absolute path of the repo root from `import.meta.url`; returns the same path when called twice (idempotent).
  - `getPackageJson` — 3 tests: returns the parsed `package.json` with `name === "gemiterm"` and `version === "2.0.0"`; returns the fallback when the `package.json` is missing; returns the fallback when the `package.json` is unparseable.
- [x] 7.2 Create `tests/infrastructure/io.test.ts` with the following test groups (at least 15 tests total):
  - `ensureDir` — creates a directory recursively; creates parent directories that do not exist; throws on EACCES.
  - `existsFile` — returns true for existing files; returns false for missing files; returns false for directories.
  - `readTextFile` — reads an existing file; throws `IOError` on ENOENT.
  - `safeReadTextFile` — returns the file content; returns `""` on ENOENT; returns `""` on EACCES.
  - `writeTextFile` — writes a new file; writes to a nested directory that does not exist; throws `IOError` on EACCES.
  - `readJsonFile` / `writeJsonFile` — round-trip a JSON object; throws on parse failure.
  - `removeDir` — removes a directory recursively; no-op on missing path.
  - `renameDir` — renames a directory; throws when source is missing; throws when destination exists.
  - `isDirectory` — returns true for a directory; returns false for a file; returns false for a missing path.
  - `listSubdirectories` — returns only directories; returns `[]` for missing path; excludes the configured marker file.
- [x] 7.3 The 19 existing `path-utils.test.ts` tests MUST continue to pass. The 5 existing `install-browser-service.test.ts` tests MUST continue to pass. The 21 `storage.test.ts` tests MUST continue to pass. The 432/432 baseline MUST be maintained across the full `bun test` run (plus the new tests).

## 8. Fix package.json build scripts

- [x] 8.1 In `package.json:20-22`, change the three `build*` scripts to drop `--outdir` and use `--outfile dist/gemiterm` instead. Add a new `build:release` script that uses `--outfile dist/gemiterm --minify`. The four final scripts MUST be: `build`, `build:linux`, `build:windows`, `build:release`.
- [x] 8.2 Run `bun run build` on the current host. Verify a single-file binary is produced at `dist/gemiterm` (Linux/macOS) or `dist/gemiterm.exe` (Windows). Run the binary with `--version` and confirm it exits 0 and prints `2.0.0`.
- [x] 8.3 Run `bun run build:linux` and `bun run build:windows` and confirm the cross-compile produces a Linux binary (`dist/gemiterm`, no extension) and a Windows binary (`dist/gemiterm.exe`, with extension) respectively.
- [x] 8.4 Run `bun run build:release` and confirm a minified binary is produced.

## 9. Add clean-build shell scripts

- [x] 9.1 Create `scripts/clean-build.sh` (POSIX) that removes `dist/` and any other transient build artifacts. The script MUST `set -e` to fail on error and MUST exit 0 when the cleanup succeeds (including when `dist/` does not exist).
- [x] 9.2 Create `scripts/clean-build.ps1` (PowerShell Core) that performs the same cleanup. The script MUST use `$ErrorActionPreference = 'Stop'` and exit 0 on success.
- [x] 9.3 Run `bash scripts/clean-build.sh` and `pwsh scripts/clean-build.ps1` locally and confirm both exit 0 and remove `dist/`.

## 10. Add install-browser shell scripts

- [x] 10.1 Create `scripts/install-browser.sh` (POSIX) that runs `bunx @playwright/cli install chromium`, reports the command being run, captures stdout/stderr, and exits 0 on success. If Chromium is already installed, the script MUST exit 0.
- [x] 10.2 Create `scripts/install-browser.ps1` (PowerShell Core) that performs the same operation.
- [x] 10.3 Run both scripts locally and confirm they exit 0.

## 11. Add .github/workflows/test.yml

- [x] 11.1 Create `.github/workflows/test.yml` with `on:` triggers for `pull_request` (any branch) and `push` (branches: `[main]`). Add a single `test` job that runs on `ubuntu-latest` with steps: `actions/checkout@v4`, `oven-sh/setup-bun@v2` with `bun-version: 1.3.13`, `bun install --frozen-lockfile`, `bun test`, `bun run typecheck`, and a final `Enforce path-utils mediation` step that runs:

  ```bash
  ! grep -rn --include='*.ts' "from \"node:\\(fs\\|path\\|os\\)\"" src/ \
    | grep -v "src/infrastructure/path-utils.ts" \
    | grep -v "src/services/install-browser-service.ts" \
    | grep -q .
  ```

  This MUST exit 0 (success) when no forbidden imports are present. The check excludes `path-utils.ts` (the canonical home) and `install-browser-service.ts` (the only legitimate cross-platform `node:path` consumer, for the WSL mount parser).
- [x] 11.2 Add a `concurrency:` block at the workflow top that cancels in-progress runs on the same ref.
- [x] 11.3 Confirm the workflow file is valid YAML.

## 12. Add .github/workflows/build.yml

- [x] 12.1 Create `.github/workflows/build.yml` with `on:` triggers for `push` (tags: `['v*']`) and `workflow_dispatch`. Add a `concurrency:` block that cancels in-progress tag builds.
- [x] 12.2 Add a `build` job with `strategy.matrix.os: [ubuntu-latest, windows-latest]` and `strategy.matrix.target: [bun-linux-x64, bun-windows-x64]` plus an extra `build-wsl` job on `ubuntu-latest` producing a Linux x64 binary. Each job MUST checkout, setup Bun 1.3.13, run `bun install --frozen-lockfile`, run the platform-specific build script, verify the binary exists, report its size, and upload via `actions/upload-artifact@v4` with stable names (`GemiTerm` for Linux/WSL, `GemiTerm.exe` for Windows).
- [x] 12.3 Add a size verification step that fails the job if the binary is less than 20 MB.
- [x] 12.4 Confirm the workflow file is valid YAML.

## 13. Add .github/workflows/release.yml

- [x] 13.1 Create `.github/workflows/release.yml` with `on:` triggers for `push` (tags: `['v*']`) only. Add a `release` job that depends on `test.yml/test` and `build.yml/build` via the `needs:` keyword using the cross-workflow `<workflow>/<job>` pattern.
- [x] 13.2 Add a `permissions:` block with `contents: write` on the release job. Add steps: `actions/checkout@v4`, `actions/download-artifact@v4` (to fetch `GemiTerm`, `GemiTerm.exe`, `install.sh`, `install.ps1`), a "Determine tag" step, and `softprops/action-gh-release@v2` with `generate_release_notes: true`.
- [x] 13.3 Confirm the workflow file is valid YAML.

## 14. Repo hygiene cleanup

- [x] 14.1 Remove the orphan file literally named `{` at the repo root.
- [x] 14.2 Edit `.gitignore:23` and remove the bare `{` line. Leave a blank line for readability.
- [x] 14.3 In `package.json`, remove the `"commander": "^15.0.0"` entry. Run `bun install` to regenerate `bun.lock` and confirm `commander` is no longer listed.
- [x] 14.4 Remove the `src/commands/` directory and its `.gitkeep` file.
- [x] 14.5 Run `git status` and confirm only the intended files are staged.

## 15. README updates

- [x] 15.1 Add a "Building from source" section to `README.md` after the "Development" section. Document the `bun run build`, `bun run build:linux`, `bun run build:windows`, and `bun run build:release` scripts and the resulting output paths. State the minimum Bun version as 1.3.13.
- [x] 15.2 Add a "Release artifacts" section to `README.md` after "Building from source". Document that the v2.0.0 release ships `GemiTerm` (Linux x64), `GemiTerm.exe` (Windows x64), `install.sh`, and `install.ps1` as GitHub Release assets.
- [x] 15.3 Update the "Development" section to mention `bun run typecheck` and the `scripts/install-browser.{sh,ps1}` wrappers.

## 16. Verification

- [x] 16.1 Run `bun install --frozen-lockfile` to confirm the lockfile is in sync with `package.json` after the `commander` removal.
- [x] 16.2 Run `bun test` and confirm the full suite passes (the original 432 tests + the new tests in tasks 7.1 and 7.2; the new baseline should be at least 462 tests).
- [x] 16.3 Run `bun run typecheck` and confirm zero TypeScript errors. The new `io.ts` exports, the refactored call sites, and the new helpers in `path-utils.ts` MUST NOT introduce any new type errors.
- [x] 16.4 Run `bun run build`, `bun run build:linux`, `bun run build:windows`, and `bun run build:release` and confirm all four produce working executables.
- [x] 16.5 Run `bash scripts/clean-build.sh`, `pwsh scripts/clean-build.ps1`, `bash scripts/install-browser.sh`, and `pwsh scripts/install-browser.ps1` and confirm all four exit 0.
- [ ] 16.6 Open a draft pull request to confirm the `test.yml` workflow runs against the change, including the lint check. The PR MUST NOT be merged until `test.yml` is green.
- [ ] 16.7 Push a `v2.0.0-rc.1` tag to confirm `build.yml` and `release.yml` work end-to-end. Delete the tag and the draft release after verification.
