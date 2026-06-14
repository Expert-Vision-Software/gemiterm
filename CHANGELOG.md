## [2.2.0-beta.2] - 2026-06-14

### Added

- Page the chat-list browser with a top-aligned window: `←` / `→` snap the cursor to the first row of the new page, and each page is a clean slice of `pageSize` items (no overlap with the previous page).
- `↑` / `↓` step within the visible window and scroll by one row when the cursor reaches the bottom or top edge.
- Add a `Delete conversation` option to the browser's single-item action menu (with a `No confirmation` description). Selecting it dispatches to `gemiterm delete <id> --force` immediately, with no confirmation prompt.
- Prompt for an output path when `Export to Markdown` or `Export to JSON` is selected from the browser action menu. The default is `gemini-chat-<id>-<YYYY-MM-DD>.<ext>`; an empty or whitespace-only input falls back to the default. The resolved path is forwarded to `ExportCommand` as `--out <path>`.
- After a successful in-browser delete, the deleted chat is removed from the in-memory chat list before the browser re-enters (so the deleted row is gone from the next page).

### Changed

- Replace `@inquirer/core`'s `usePagination` with a custom top-aligned `windowStart` slice in `src/cli/utils/prompts.ts`. The page indicator (`Page: X/Y`) now matches the visible window exactly; the cursor and window both reset to the top on `s` / `p` / `f` filter changes.
- Update `openspec/specs/chat-list-browser/spec.md` to document the top-aligned paged-window model, the `Delete conversation` action, the export path prompt, and the post-delete in-memory list refresh. Add new requirements: "Export action prompts for an output path" and "Delete action bypasses confirmation".

### Fixed

- `←` / `→` no longer leave the cursor in the middle of the new page (was a `usePagination` centering artifact — a 20-item list with `pageSize: 5` previously rendered `[c18, c19, c00, c01]` on the last page).
- `s` / `p` / `f` now reset both the cursor index and the `windowStart` so the visible window shifts to the new first page (previously the window could be scrolled past the start of the re-sorted / re-filtered list).

---

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