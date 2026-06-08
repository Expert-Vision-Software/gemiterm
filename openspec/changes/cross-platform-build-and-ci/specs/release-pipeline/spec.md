## ADDED Requirements

### Requirement: CI Test Runs On Pull Requests And Pushes To Main
The system MUST run a test job on every `pull_request` event and every `push` to the `main` branch. The test job MUST run on `ubuntu-latest` and MUST execute `bun install --frozen-lockfile`, `bun test`, `bun run typecheck`, and a path-and-file mediation lint check in that order. A failure in any of these commands MUST cause the test job to exit non-zero and fail the workflow.

#### Scenario: Pull request to main runs the test job
- **WHEN** a contributor opens a pull request targeting `main`
- **THEN** the `test` workflow runs on `ubuntu-latest`, executes `bun install --frozen-lockfile`, `bun test`, `bun run typecheck`, and the path-and-file mediation lint check, and the pull request cannot be merged while the test job is failing

#### Scenario: Push to main runs the test job
- **WHEN** commits are pushed directly to the `main` branch
- **THEN** the `test` workflow runs the same commands on `ubuntu-latest` and reports success or failure based on their exit codes

#### Scenario: Test failure fails CI
- **WHEN** `bun test` exits with a non-zero status (one or more test cases fail)
- **THEN** the test job exits non-zero and the workflow is marked as failed

#### Scenario: Typecheck failure fails CI
- **WHEN** `bun run typecheck` exits with a non-zero status (TypeScript reports one or more errors)
- **THEN** the test job exits non-zero and the workflow is marked as failed

#### Scenario: Path-and-file mediation lint failure fails CI
- **WHEN** the lint check finds a `node:fs`, `node:path`, or `node:os` import in `src/` outside the allowed exemptions (see the `path-and-file-mediation` spec)
- **THEN** the test job exits non-zero and the workflow is marked as failed

### Requirement: Cross-Platform Build On Version Tags
The system MUST run a cross-platform build matrix whenever a tag matching the pattern `v*` is pushed, and MUST also run on `workflow_dispatch` for manual builds. The build matrix MUST include at least three jobs: `build-linux` on `ubuntu-latest`, `build-windows` on `windows-latest`, and `build-wsl` on `ubuntu-latest` producing a Linux x64 binary suitable for WSL. Each job MUST verify the build artifact exists, report its size, and upload it via `actions/upload-artifact@v4`.

#### Scenario: Tag push triggers the build matrix
- **WHEN** a tag matching `v*` (for example `v2.0.0`) is pushed to the repository
- **THEN** the build workflow runs the `build-linux`, `build-windows`, and `build-wsl` jobs in parallel, each verifies its artifact, and each uploads the artifact via `actions/upload-artifact@v4`

#### Scenario: Manual workflow dispatch accepts a custom tag
- **WHEN** a maintainer triggers the build workflow via `workflow_dispatch` and supplies a `tag` input (for example `v2.0.1-rc.1`)
- **THEN** the build jobs use the supplied tag value to name the output binary (for example `gemiterm-v2.0.1-rc.1`) instead of the event ref name

#### Scenario: Missing build artifact fails the job
- **WHEN** a build job completes but the expected binary file (for example `dist/GemiTerm` or `dist/GemiTerm.exe`) does not exist
- **THEN** the build job exits non-zero and the workflow is marked as failed

### Requirement: GitHub Release Published On Version Tags
The system MUST publish a GitHub Release whenever a tag matching the pattern `v*` is pushed. The release job MUST depend on (chain after) both the test and build jobs. The release MUST use `softprops/action-gh-release@v2` with auto-generated release notes, and MUST attach the `GemiTerm` (Linux) binary, the `GemiTerm.exe` (Windows) binary, the `install.sh` script, and the `install.ps1` script as release assets.

#### Scenario: Tag push creates a GitHub release with all artifacts
- **WHEN** a tag matching `v*` (for example `v2.0.0`) is pushed
- **THEN** the test and build jobs run first, and on success the release job creates a GitHub Release named after the tag, with auto-generated release notes, attaching `GemiTerm`, `GemiTerm.exe`, `install.sh`, and `install.ps1` as release assets

#### Scenario: Failed build skips the release
- **WHEN** any of the upstream build jobs (test, build-linux, build-windows, or build-wsl) fails
- **THEN** the release job is skipped and no GitHub Release is created

### Requirement: Build Scripts Produce A Working Executable On Bun 1.3.x
The system MUST provide `bun run build`, `bun run build:linux`, `bun run build:windows`, and `bun run build:release` scripts in `package.json`. Each script MUST produce a single-file executable on Bun 1.3.x when invoked from the repository root. The output binary MUST be executable and MUST report its version when invoked with `--version`.

#### Scenario: `bun run build` produces a working executable
- **WHEN** a developer runs `bun run build` on Bun 1.3.x
- **THEN** a single-file binary is produced (at `dist/gemiterm` on Linux/macOS or `dist/gemiterm.exe` on Windows) and invoking that binary with `--version` exits 0 and prints the version string

#### Scenario: `bun run build:linux` produces an x64 Linux binary
- **WHEN** a developer runs `bun run build:linux` on Bun 1.3.x
- **THEN** a Linux x64 single-file binary is produced at `dist/gemiterm` and the binary is executable on a Linux x64 system

#### Scenario: `bun run build:windows` produces an x64 Windows binary
- **WHEN** a developer runs `bun run build:windows` on Bun 1.3.x
- **THEN** a Windows x64 single-file binary is produced at `dist/gemiterm.exe` and the binary is executable on a Windows x64 system

#### Scenario: `bun run build:release` produces a non-debug binary
- **WHEN** a developer runs `bun run build:release` on Bun 1.3.x
- **THEN** a minified, single-file binary is produced (without debug symbols or source maps) suitable for distribution

### Requirement: Clean Build Scripts Available For Both Platforms
The system MUST provide `scripts/clean-build.sh` (POSIX shell) and `scripts/clean-build.ps1` (PowerShell) that remove the `dist/` directory and any other transient build artifacts. Each script MUST exit 0 on success and non-zero on error.

#### Scenario: POSIX clean-build removes dist and exits 0
- **WHEN** a developer runs `bash scripts/clean-build.sh` on a POSIX system
- **THEN** the `dist/` directory is removed (or stays removed if already absent) and the script exits 0

#### Scenario: PowerShell clean-build removes dist and exits 0
- **WHEN** a developer runs `pwsh scripts/clean-build.ps1` on a system with PowerShell Core installed
- **THEN** the `dist/` directory is removed (or stays removed if already absent) and the script exits 0

### Requirement: User-Facing Browser Install Scripts
The system MUST provide `scripts/install-browser.sh` (POSIX shell) and `scripts/install-browser.ps1` (PowerShell) that run `bunx @playwright/cli install chromium` and verify the installation succeeded. Each script MUST exit 0 on success and non-zero on error. If Chromium is already installed, the script MUST exit 0 without re-downloading.

#### Scenario: POSIX install-browser runs the install command
- **WHEN** a developer runs `bash scripts/install-browser.sh` on a POSIX system with Bun installed
- **THEN** the script invokes `bunx @playwright/cli install chromium`, reports success to stdout, and exits 0

#### Scenario: PowerShell install-browser runs the install command
- **WHEN** a developer runs `pwsh scripts/install-browser.ps1` on a system with Bun and PowerShell Core installed
- **THEN** the script invokes `bunx @playwright/cli install chromium`, reports success to stdout, and exits 0

#### Scenario: Browser already installed is a no-op
- **WHEN** a developer runs either install-browser script and Chromium is already installed
- **THEN** the script exits 0 without re-downloading Chromium and without printing an error
