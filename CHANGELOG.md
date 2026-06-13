## [2.2.0-beta.1] - 2026-06-13

### Added

- Introduced an interactive conversation browser for `list -i` using Inquirer prompts.
- Added profile and favorites filtering options in the interactive browser.
- Added `--profile` support for conversation filtering in list flows.
- Improved readability for long conversation titles with truncation and ellipsis in browser views.

### Changed

- Refined interactive list UX by removing pagination and simplifying default list behavior.
- Standardized CLI short flags: `-o` for output (`--out`) and reserved `-p` for profile-related usage.
- Updated release publishing behavior so prerelease tags publish to npm `next` instead of overriding `latest`.
- Updated docs and OpenSpec artifacts to reflect the new browser/list behavior and ongoing UX changes.

### Fixed

- Prevented Gemini client startup instability by disabling auto-refresh during client initialization.

---

## [2.1.1] - 2026-06-12

### Added

- Add long argument guard to prevent exceeding Windows command line limit (`24dc109`)
- Add `--prompt-file` option for `continue` and `new` commands to read messages from files (`2570051`)
- Implement spillover mechanism for long positional arguments in `continue` and `new` commands (`2c85abb`)

---

## [2.1.0] - 2026-06-10

### Added

- Integrate Commander.js for CLI argument parsing, replacing hand-rolled argv parser (`d081638`)
- Add `login` alias for the `auth` command (`1d942f2`)
- Add `install-skills` command and related services for skill management (`5da1017`)
- Add `bin`, `engines`, and `files` fields to `package.json` for npx/bunx compatibility (`c03ffc3`)

### Changed

- Update README and INSTALL guide for improved clarity and usage instructions (`36c8163`)
- Reorganize `package.json` devDependencies and ensure proper Bun compatibility (`36c8163`)
- Update GemiTerm Agent Guide (AGENTS.md) for clarity and structure (`51b8366`)
- Update skills repository link to npm package (`dee522b`)

### Fixed

- Remove flaky test (`faa774a`)

---

## [2.0.0] - 2026-06-08

Initial Bun typescript rewrite release. All 11 CLI commands, auth flow, and cross-platform delivery.