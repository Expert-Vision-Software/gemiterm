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