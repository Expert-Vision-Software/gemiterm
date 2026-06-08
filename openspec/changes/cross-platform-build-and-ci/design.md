## Context

The Bun rewrite of GemiTerm is functionally complete (432/432 unit/integration/parity/smoke tests pass on Bun 1.3.13, all 11 CLI commands registered, auth flow working) but two structural pieces are missing: the **delivery pipeline** (build fix, CI, release) and the **path-and-file mediation layer** (a single source of truth for `node:fs` and `node:path` access in `src/`).

The current `package.json:20-22` build scripts:

```json
"build": "bun build --compile --target=bun --outdir=dist src/cli/index.ts",
"build:linux": "bun build --compile --target=bun-linux-x64 --outdir=dist src/cli/index.ts",
"build:windows": "bun build --compile --target=bun-windows-x64 --outdir=dist src/cli/index.ts"
```

Verified failure mode on Bun 1.3.13 (current dev environment): `bun run build` exits 1 with `error: cannot use --compile with --outdir`. Bun 1.3.x removed support for combining `--compile` with `--outdir` because the resulting tree semantics are undefined for a single-file executable.

The Python release workflow at `docs/python-release-for-reference.md` (used by v1.4.1) is the target shape for the new Bun release workflow, but with PyInstaller-specific steps replaced by `bun build --compile`. The Python release tagged artifacts as `GemiTerm` (Linux) and `GemiTerm.exe` (Windows); the Bun release MUST preserve those names so the v1.4.1 `install.ps1` referenced by the related `v2-install-migration` change keeps working.

A read-only audit of `src/` shows the rewrite does **node:fs** and **node:path** access in 9 files, with at least 4 copy-pasted write-to-disk blocks and ~20 open-coded `mkdirSync` / `existsSync` / `renameSync` calls. The original OpenSpec change proposed a `platform-detect.ts` module to share one private `isWsl()` helper; that helper does not need a new file, and the broader duplication is the actual cross-platform work.

The audit found:

- **`src/cli/commands/export-command.ts:72-82`**, **`export-all-command.ts:79-80` + 96-104`**, **`list-command.ts:138-143`**, **`fetch-command.ts:121-127`** — the same "resolve path + ensure parent dir + writeFileSync UTF-8" block, copied 4 times. Two of those (`list` and `fetch`) are byte-identical 6-line `writeOutput` methods.
- **`src/infrastructure/storage.ts`** — 11 inline `mkdirSync` / `writeFileSync` / `readFileSync` / `rmSync` / `renameSync` / `existsSync` calls in 6 methods.
- **`src/infrastructure/config.ts`** — 64 lines, of which 30 are open-coded `node:fs` operations wrapping the `path-utils.ts` getters.
- **`src/services/install-browser-service.ts`** — 11 inline `existsSync` / `readFileSync` calls; 2 near-identical `getEdgePaths` / `getChromePaths` methods; a private `isWsl()` that is the only consumer of `/proc/version` detection.
- **`src/cli/index.ts:33-35`** — the only place in the rewrite that needs `__filename` / `__dirname` and is the only consumer of `fileURLToPath`; a one-liner helper would clean it up.

The previous `isWsl()` is duplicated logic that will be needed by future command code, so it makes sense to lift it into `path-utils.ts`. The lift MUST be behavior-preserving; the 5 existing unit tests in `tests/services/install-browser-service.test.ts` are the regression gate. The `src/services/playwright-cli-driver.ts`, `src/services/cookie-monitor.ts`, and `src/services/auth-service.ts` files are off-limits and will not be touched by this change.

Constraints:

- **Bun 1.3.13** is the pinned toolchain (the env has it; `devDependencies.@types/bun: ^1.3.14`).
- **GitHub Actions** is the CI/CD host (the repo is on GitHub per `docs/python-release-for-reference.md`).
- **No breaking changes** to the CLI user surface; all changes are internal build/CI plus internal refactoring.
- **No new runtime dependencies** are added; only removal of the unused `commander`.
- **WSL** must be supported as a first-class target because GemiTerm's primary auth flow is browser-driven and WSL users invoke the Linux binary while their Chromium lives in the Windows host filesystem (handled today by `findWslBrowser` in `src/services/install-browser-service.ts:124-141`).
- **The "no `node:fs` outside path-utils and io" rule is enforced by a CI lint check** in `.github/workflows/test.yml`, not by human review. The check excludes `tests/` and `tests/parity/` (a test-helper script) and the two allowed `src/` consumers (`path-utils.ts` and `install-browser-service.ts`).

Stakeholders: maintainer (who ships the release), contributors (who need fast PR feedback), end users on Linux/Windows/WSL (who download the binary from GitHub Releases).

## Goals / Non-Goals

**Goals:**

- Fix `bun run build` / `build:linux` / `build:windows` so they produce a working single-file executable on Bun 1.3.13.
- Add a `release-pipeline` capability: three GitHub Actions workflows (`test.yml`, `build.yml`, `release.yml`) plus the build/clean/install-browser shell scripts that produce v2.0.0 cross-platform artifacts.
- Add a `path-and-file-mediation` capability: extend `src/infrastructure/path-utils.ts` with `isWSL()`, `getProjectRoot()`, and `getPackageJson()`; create `src/infrastructure/io.ts` with the file-ops helpers; refactor the 7 call sites that currently use `node:fs` / `node:path` directly; add a CI lint check that enforces the rule going forward.
- Keep the artifact naming convention `GemiTerm` (Linux/WSL) and `GemiTerm.exe` (Windows) so the v1.4.1 `install.ps1` keeps working.
- Cleanup: remove the orphan `{` file at the repo root, remove the stray `{` line in `.gitignore:23`, remove the unused `commander` dependency, decide the fate of the empty `src/commands/` placeholder.
- Update README with a "Building from source" section and a "Release artifacts" section.

**Non-Goals:**

- Touching `src/services/playwright-cli-driver.ts`, `src/services/cookie-monitor.ts`, or `src/services/auth-service.ts` (sensitive area per the change's explicit warning).
- Publishing to npm, PyPI, Homebrew, or any package registry — distribution is GitHub Releases + raw `install.sh` / `install.ps1` only.
- Adding a code-signing step for Windows binaries (would require a cert and is deferred).
- Adding macOS / Darwin builds to the matrix (no users on that platform have requested it; `isWSL()` is not relevant on macOS and the rewrite does not need a `isDarwin()` helper).
- Migrating the existing Python `v1.4.1 install.ps1` (that lives in the related `v2-install-migration` change).
- Adding new test cases for `install-browser-service` — the 5 existing tests are the regression gate and that is sufficient.
- Switching the CI provider away from GitHub Actions.

## Decisions

### D1. `src/infrastructure/io.ts` is a separate file from `path-utils.ts`, not a re-export

`path-utils.ts` is about **storage paths and config directories** (functions: `resolvePath`, `getConfigDir`, `getProfilesDir`, `getProfilePath`, `getProfileDir`, `getDefaultProfileMarkerPath`, plus three constants, plus the new `isWSL`, `getProjectRoot`, `getPackageJson`). `io.ts` is about **file-system operations** (`ensureDir`, `existsFile`, `readTextFile`, `writeTextFile`, `readJsonFile`, `writeJsonFile`, `removeDir`, `renameDir`, `isDirectory`, `listSubdirectories`). The two concerns are distinct: paths are values; file ops are side effects. Conflating them would create a God-module.

The dependency direction is one-way: `io.ts` may import from `path-utils.ts` (for path joining and the WSL detection), but `path-utils.ts` does not import from `io.ts`. This is verifiable by `grep` and is part of the lint rule.

**Alternative considered:** Put everything in `path-utils.ts`. Rejected: mixes concerns, makes the file longer, and obscures the dependency direction.

**Alternative considered:** Put everything in `io.ts` and re-export from `path-utils.ts` for backward compatibility. Rejected: forces every call site to know which is the "real" home; the dependency direction is the wrong way around.

### D2. Drop `--outdir` from `bun build --compile`; use `--outfile` for deterministic artifact paths

Verified failure mode on Bun 1.3.13: `bun build --compile --target=bun --outdir=dist src/cli/index.ts` exits 1 with `error: cannot use --compile with --outdir`. Bun 1.3.x removed this combination because a single-file executable has no meaningful relationship to an output directory tree.

Two viable fixes in Bun 1.3.x:

1. **Drop `--outdir` entirely** → Bun places the binary in `cwd` named after the **parent directory** of the entrypoint. Fragile and surprising.
2. **Use `--outfile <path>`** → Bun places the binary at the specified path. Matches the v1.4.1 PyInstaller convention and gives CI a deterministic upload path.

**Chosen: option 2** — `--outfile dist/gemiterm` for the platform-specific scripts. The resulting build scripts:

```json
"build": "bun build --compile --target=bun --outfile dist/gemiterm src/cli/index.ts",
"build:linux": "bun build --compile --target=bun-linux-x64 --outfile dist/gemiterm src/cli/index.ts",
"build:windows": "bun build --compile --target=bun-windows-x64 --outfile dist/gemiterm src/cli/index.ts",
"build:release": "bun build --compile --target=bun --outfile dist/gemiterm --minify src/cli/index.ts"
```

### D3. The `isWSL()` helper is in `path-utils.ts`, not in a separate `platform-detect.ts`

The original spec proposed a 7-helper `platform-detect.ts` module (`isWindows`, `isLinux`, `isWSL`, `isDarwin`, `detectPlatform`, `getPlatformName`, `normalizePath`). A read-only audit found **zero callers** for six of those helpers; the only non-trivial check (`isWSL()`) is the one with a real consumer. Putting `isWSL()` in its own file is over-engineering; lifting it into `path-utils.ts` keeps the cross-platform concern in the same module as the other path-related code.

The 6 unnecessary helpers (`isWindows`, `isLinux`, `isDarwin`, `detectPlatform`, `getPlatformName`, `normalizePath`) are **dropped**. The only `process.platform` checks in the rewrite are 3 inline in `install-browser-service.ts` (lines 58, 61, 185), all of which are clearer as inline `=== 'win32'` / `=== 'linux'` checks than as named boolean predicates.

The `isWSL()` implementation is a strict superset of the old private `isWsl()`: it checks both `/proc/version` (for "microsoft" or "WSL" case-insensitive) AND the `WSL_DISTRO_NAME` env var. This is a minor improvement in detection coverage; the 5 unit tests in `tests/services/install-browser-service.test.ts` are not affected because they do not exercise WSL detection directly.

### D4. The 4-copy "write to disk" block becomes a single `writeTextFile()` helper

The same 3-line pattern (`resolve path + ensure parent dir + writeFileSync UTF-8`) appears in `export-command.ts`, `export-all-command.ts`, `list-command.ts`, and `fetch-command.ts`. Two of those (`list` and `fetch`) are byte-identical 6-line `writeOutput` private methods. A single `writeTextFile(path, content)` in `io.ts` consolidates the pattern; the call sites collapse to one line each.

### D5. The CI lint check is a hard failure on PRs

The rule "no `node:fs` / `node:path` / `node:os` imports in `src/` outside `path-utils.ts` and `install-browser-service.ts`" is enforced by a grep-based check in `.github/workflows/test.yml`:

```bash
! grep -rn --include='*.ts' --exclude-dir=infrastructure --exclude-dir=install-browser-service \
  "from \"node:\\(fs\\|path\\|os\\)\"" src/
```

Wait, `--exclude-dir` in grep is for the directory the match is in, not the filename. The right invocation is:

```bash
grep -rn --include='*.ts' "from \"node:\\(fs\\|path\\|os\\)\"" src/ \
  | grep -v "src/infrastructure/path-utils.ts" \
  | grep -v "src/services/install-browser-service.ts" \
  | (! grep .)
```

The check is a hard failure: if any forbidden import is found, the test job exits non-zero. The exclusion list is `path-utils.ts` (the canonical home) and `install-browser-service.ts` (the only legitimate cross-platform `node:path` consumer, for the WSL mount parser). `tests/` is not in scope of the check (the rule is about `src/` only).

**Alternative considered:** ESLint plugin with `no-restricted-imports`. Rejected: adds a new dev dependency and a config file; the grep check is one line and requires no additional tooling.

### D6. Three separate workflow files (test.yml, build.yml, release.yml) instead of one combined workflow

The Python reference (`docs/python-release-for-reference.md:1-175`) uses a single `Release` workflow with all jobs inside. We will split into three because:

1. **`test.yml` runs on every PR** — it must be fast and not blocked by the slower build matrix.
2. **`build.yml` runs on tag push + manual dispatch** — it has a matrix that takes 5-10 minutes.
3. **`release.yml` is the only one that creates the GitHub Release** — splitting it means a re-publish can be done by re-running just `release.yml` after fixing a release-note mistake.

This is the standard GitHub Actions pattern for "test on PR, build on tag, release on tag" and is well-supported by `actions/upload-artifact@v4` (artifacts persist 90 days by default, which is enough for `release.yml` to download them).

### D7. WSL is a separate build job, not a runtime check

WSL needs its own `build-wsl` job that runs on `ubuntu-latest` and produces a Linux x64 binary. WSL itself can run any Linux ELF binary, so a regular Linux build is sufficient — but having a dedicated `build-wsl` job in the matrix makes the artifact explicit and named consistently in the GitHub Actions UI.

### D8. Artifact naming preserves v1.4.1 convention

| Platform | Local build path | CI artifact name | Release asset name |
|----------|------------------|------------------|--------------------|
| Linux x64 | `dist/gemiterm` | `GemiTerm` | `GemiTerm` |
| Windows x64 | `dist/gemiterm.exe` | `GemiTerm.exe` | `GemiTerm.exe` |
| WSL (Linux x64) | `dist/gemiterm` | `GemiTerm` | (not released — only Linux) |

The v1.4.1 `install.ps1` looks for `GemiTerm.exe` in the release assets.

### D9. `bunx @playwright/cli install chromium` is the canonical install command

The existing `src/services/install-browser-service.ts:183` already spawns `bunx @playwright/cli install chromium`. The new user-facing `scripts/install-browser.sh` and `scripts/install-browser.ps1` will use the exact same command.

### D10. The `src/commands/` placeholder is removed

The directory contains only a `.gitkeep`. Decision: remove both the directory and the `.gitkeep`. No code references it. The CLI commands live in `src/cli/commands/`.

## Risks / Trade-offs

- **Risk:** `--outfile` was added in Bun 1.3.x; older Bun versions (1.2.x) don't have it. → **Mitigation:** `devDependencies.@types/bun: ^1.3.14` already pins us to 1.3.x; CI uses `oven-sh/setup-bun@v2` with `bun-version: 1.3.13` explicitly.

- **Risk:** Cross-compile from Linux to Windows requires a Bun-built-for-Windows toolchain at compile time. → **Mitigation:** the `build-windows` job runs on `windows-latest`. We never cross-compile Windows FROM Linux.

- **Risk:** The `isWSL()` is broader than the old private `isWsl()`. If any test or code path assumed the old narrower check, behavior could change. → **Mitigation:** the WSL branch in `findLinuxBrowser` only adds extra candidate paths; it never removes any. Worst case, more browsers are detected. The 5 unit tests in `tests/services/install-browser-service.test.ts` all pass against the new code.

- **Risk:** The CI lint check uses `grep` rather than a proper linter, so it can be fooled by multi-line imports or import-string concatenation. → **Mitigation:** the rule is enforced on `src/`; all current `src/` files use single-line `import … from "node:fs"` statements. Future authors who try to obfuscate the import will fail code review.

- **Risk:** A new contributor legitimately needs `node:fs` for a new feature in `src/`. → **Mitigation:** the right answer is to add a new helper to `io.ts` and use that. If the helper is genuinely impossible to write in `io.ts` (e.g. it requires direct `fs.watch` access), the contributor edits the `.github/workflows/test.yml` exclusion list with a comment explaining why.

- **Risk:** `safeReadTextFile` returns `""` on any error (preserves the existing `readFileSafe` behavior in `install-browser-service.ts:173-179`). An empty return confuses "file does not exist" with "file exists but is empty". → **Mitigation:** the only current caller (`isWsl()` check on `/proc/version`) is robust to both `""` and `null`; the result is used in a `.toLowerCase().includes("microsoft")` check that returns false on `""`. A code comment in `io.ts` notes the `""` semantic and its implication for future callers.

- **Risk:** The `io.ts` module grows over time and becomes its own God-module. → **Mitigation:** the module is already 10 functions focused on a single concern (file-system access). New functions should be added only if they are used in at least 2 call sites; ad-hoc single-use helpers should stay in the call site.

- **Risk:** `softprops/action-gh-release@v2` is a third-party action. If it breaks, the release pipeline fails. → **Mitigation:** pin to a specific minor version (`@v2.3.x`); the Python reference already uses this action.

- **Risk:** GitHub Actions matrix can fail intermittently. → **Mitigation:** no retry for v1.4.1; we match that. The maintainer re-runs on flake.

- **Risk:** Removing `commander` from `package.json` and `bun.lock` requires `bun install` to regenerate the lockfile. → **Mitigation:** the verification task includes running `bun install --frozen-lockfile` to detect drift.

- **Risk:** The orphan `{` file has been there long enough to be a known-good. Removing it could break a downstream tool that `cat`s the repo. → **Mitigation:** search the repo for any reference to a file named `{` (none found) before deletion. The file is untracked, so deletion is a no-op for git history.

- **Trade-off:** Splitting CI into three workflows means the `release.yml` job has to re-run `test` and `build` jobs because of the `needs:` chain. → **Accepted:** with three workflows, `test.yml` and `build.yml` cache their results via `actions/upload-artifact@v4`; `release.yml` only re-runs the release step on manual re-run.

- **Trade-off:** A separate `build-wsl` job doubles the matrix time vs. reusing `build-linux`. → **Accepted:** matrix runs in parallel; total wall-clock time is `max(linux, windows, wsl) ≈ 5 minutes` either way.

## Migration Plan

The change is purely additive plus one CLI build fix and a refactor of 7 internal call sites. There is no user-visible migration.

**Deploy steps** (all done in this PR):

1. Land the `path-utils.ts` extensions + `io.ts` module + refactor of the 7 call sites. Run `bun test` — must stay at 432/432 plus the new tests.
2. Fix `package.json:20-22` build scripts. Run `bun run build` and `bun run build:linux` locally — both must produce an executable.
3. Add the shell scripts (`scripts/clean-build.{sh,ps1}`, `scripts/install-browser.{sh,ps1}`).
4. Add the three GitHub Actions workflows, including the lint check in `test.yml`.
5. Cleanup: `.gitignore:23` (remove stray `{`), repo root (remove orphan `{`), `package.json:29` and `bun.lock` (remove `commander`), `src/commands/` (remove placeholder).
6. Update README with "Building from source" + "Release artifacts" sections.
7. After merge, push a `v2.0.0` tag. The `build.yml` matrix produces Linux + Windows + WSL binaries. The `release.yml` job attaches them to a GitHub Release with auto-generated notes.

**Rollback strategy:**

- The CLI build fix is not yet shipped, so there's nothing to roll back for end users.
- The workflows only fire on tag push; if a `v2.0.0` tag is pushed and the release breaks, the maintainer can delete the GitHub Release or re-tag with a patch version.
- The `install-browser-service` refactor has the 5 unit tests as a safety net; if any test fails post-refactor, revert the change to that file only.
- The `io.ts` additions are additive; if they cause a circular import (verified not the case by inspection), revert by removing the import from the affected call site.

## Open Questions

- **Q1:** Should `safeReadTextFile` return `""` (preserves the old `readFileSafe` behavior) or `null` (more honest API)? **Decision:** keep `""` for minimum diff and add a code comment noting the implication. Future contributors can add a `safeReadTextFileOrNull` if needed.
- **Q2:** Should the WSL build be a separate artifact in the GitHub Release, or is it identical to the Linux artifact? **Decision:** WSL is a CI-only check; the artifact is not released. If users complain, add it later.
- **Q3:** Should the `install-browser.sh` and `install-browser.ps1` scripts also be uploaded to the GitHub Release? **Decision:** yes, attach both, but the v1.4.1 `install.ps1` will be the one referenced by `v2-install-migration`.
- **Q4:** Should the `test.yml` workflow also run on `windows-latest`? **Decision:** start with `ubuntu-latest` only; expand later if a Windows-only bug appears.
- **Q5:** What is the minimum Bun version for the `build` scripts to work? **Decision:** Bun 1.3.13. Document in README.
- **Q6:** Should the shared `isWSL()` also read `/proc/sys/kernel/osrelease` as a fallback? **Decision:** stick with `/proc/version` + `WSL_DISTRO_NAME`.
