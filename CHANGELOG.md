## [2.4.0] - 2026-07-29

### Added

- "Continue conversation" action in the `gemiterm list -i` interactive browser action menu, letting you resume a chat directly from the list without copy-pasting the ID.
- `ChatMetadataStorage` service for persisting chat `rid`/`rcid`/`ctx` metadata per profile, used by `continue` to restore session context.
- "Last Used" column in the profile table (`gemiterm auth --list`, `gemiterm status`) showing when each profile's `storage_state.json` was last written — i.e. the last `auth` capture or refreshed-cookie persist. Makes the session-keep-alive from the cookie-persistence fix observable: the timestamp advances each time a command refreshes the profile's cookies.

### Changed

- Switch from `gemini-reverse` to `gemini-web-sdk@^2.2.0` as the underlying Gemini client library. The new package includes the `rid`/`rcid` exposure fix that enables proper conversation continuation via `gemiterm continue`.
- `ProfileAuthManager.findProfileForConversation` now probes only valid (active) profiles rather than all configured profiles, matching the "configured & valid" intent and avoiding wasted network calls on profiles with expired sessions.
- Upgrade `gemini-reverse` from `~1.0.12` to `2.1.0` (exact pin, following the policy established in issue #5 — upstream broke the public API in a 1.x minor and ships no tests or changelog; exact pin + surface contract tests make every future upgrade a deliberate act).
- `gemiterm models` output now shows `model_name` identifiers (e.g. `gemini-3-pro`) rather than `display_name` tier labels (e.g. `Basic Pro`) when `model_name` is present, reflecting the static Gemini 3 catalog in 2.1.0 vs the prior account-probed registry.

### Fixed

- `gemiterm continue <cid>` now warms conversation metadata on `fetchChat`, so subsequent `sendMessage` calls correctly resume the conversation instead of starting a new one. Previously, metadata was only persisted after `sendMessage` response, missing the warming step needed when `continue` is used standalone.
- `gemiterm fetch <cid>` and `gemiterm export <cid>` now resolve the profile that owns a conversation instead of always querying the default profile. Previously, any conversation belonging to a non-default profile was fetched with the default profile's cookies, so Gemini returned an empty history and the CLI printed "No messages found." despite the conversation having messages. Both commands now auto-discover the owning profile across all valid profiles (mirroring `continue`/`delete`), and accept a new `-p, --profile <name>` flag to specify the profile explicitly.
- `gemiterm export-all --all-profiles` now fetches each conversation with its own profile. The listing step already enumerated chats across profiles, but the per-conversation fetch loop discarded the profile and queried the default profile, so non-default conversations exported as empty files (silently counted as OK). Each chat is now fetched with its already-known `profile`.
- `gemiterm continue` and `gemiterm delete` now accept a `-p, --profile <name>` flag, making their existing error messages (which referenced `--profile`) truthful. An explicit profile short-circuits auto-discovery.
- `gemiterm continue <cid>` now restores chat context across sessions. When resuming a conversation, gemiterm now looks up the stored `rid`/`rcid` metadata and passes it to `session.metadata` before sending, so Gemini retains the full conversation thread instead of starting a new one.
- `gemiterm continue <cid>` in interactive mode now prints the last model response before the prompt, so users can recall what was said before typing their continuation.
- Auth and browser launch now fail with a clear install message (`"Playwright CLI not found..."`) when neither `playwright-cli` nor `bunx @playwright/cli` is available, instead of silently producing no browser or an opaque error.
- Persist refreshed Gemini session cookies (`__Secure-1PSID` / `__Secure-1PSIDTS`) back to the active profile's storage after successful API operations. The `gemini-reverse` 2.1.0 upgrade removed the library's explicit cookie-rotation path, leaving passive `set-cookie` merging (in `client.init()`) as the only refresh mechanism — but gemiterm never wrote those refreshed values back, so the on-disk `__Secure-1PSIDTS` went stale across runs and sessions expired within days of auth. `GeminiClientService` now detects changed cookie values after `init`/`listChats`/`fetchChat`/`sendMessage`/`startNewChat`/`deleteChat`/`listModels`, merges them into the profile's stored cookie list (preserving each entry's domain/path/httpOnly/secure/sameSite, refreshing `expires`), and saves via a new `CookieStorageService.saveCookiesForProfile` seam. Persistence is failure-isolated (logs at debug, never breaks the operation) and skipped for the CLI's non-profile factory client and when values are unchanged.

### Internal

- Rewrite `GeminiClientService` internals onto the 2.1.0 API: `GeminiClient` → `Gemini`, `listChats()` → `chats()`, `readChat()` returns plain turn arrays, `startChat({ cid })` → `newChat()` + `session.cid = cid`, `sendMessage` → `generateContent`, `listModels()` → `models()`.
- Remove `TimeoutError` translation; timeouts now surface as axios `ECONNABORTED` or `APIError`/`GeminiError` with timeout/stalled messages, all mapped to `"Request to Gemini timed out"`.
- `pinned` field rename (`is_pinned` → `pinned`) in chat row shape now explicitly mapped to `isPinned`.
- Add surface contract smoke test (`tests/smoke/gemini-reverse-contract.test.ts`) that verifies the `gemini-reverse` export surface; serves as a regression gate for future upstream renames.
- `bun test` now runs with `--isolate` to prevent `mock.module` cross-file pollution in Bun's test runner.

---

## [2.3.2] - 2026-07-23

### Fixed

- Pin `gemini-reverse` to `~1.0.12` to prevent `^1.0.12` from resolving to the breaking `1.1.x` line, which renamed `GeminiClient` → `Gemini` and caused `SyntaxError: Export named 'GeminiClient' not found` on fresh installs. ([#5](https://github.com/Expert-Vision-Software/gemiterm/issues/5))

---

## [2.3.0] - 2026-07-13

### Added

- Add session renew (`--renew` / `-e`) flag to auth command for refreshing/extending session cookies without recreating a profile. Launches a headed browser with existing cookies pre-loaded, then runs the cookie monitor to detect active session or wait for manual login.
- `AuthService.renew()` orchestrates the state-load → reload → cookie-monitor → save flow; `AuthService.confirmRenewSuccess()` prints renewal summary with cookie count, expiry, and `__Secure-1PSID` check.

### Changed

- Consolidated profile command into auth command. The standalone `profile` command is removed; all profile management is now done via auth flags: `gemiterm auth <profileName>` (authenticate to existing profile), `gemiterm auth --list` (list profiles), `gemiterm auth --add <name>` (create and authenticate), `gemiterm auth --delete <name>` (delete profile), `gemiterm auth --rename <old> <new>` (rename profile), `gemiterm auth --default <name>` (set default profile).
- Use actual session cookie expiry from __Secure-1PSIDTS instead of a fixed 7-day window.

### Fixed

- Backspace not working in text prompts on Windows/Bun — replaced `@inquirer/prompts` input with a custom `textInputPrompt` that explicitly handles backspace via `node:readline` line correction when `rl.line` diverges from the buffer.
- Text prompt rewrite using raw `process.stdin` instead of readline for proper TTY interactive mode on Windows/Bun. Parses bytes manually (backspace slices buffer, printable chars append, Ctrl+C cancels, Enter submits); bypasses `@inquirer/core createPrompt` entirely.

## [2.2.0] - 2026-06-14

### Added

- Page the chat-list browser with a top-aligned window: `←` / `→` snap the cursor to the first row of the new page, and each page is a clean slice of `pageSize` items (no overlap with the previous page).
- `↑` / `↓` step within the visible window and scroll by one row when the cursor reaches the bottom or top edge.
- Add a `Delete conversation` option to the browser's single-item action menu (with a `No confirmation` description). Selecting it dispatches to `gemiterm delete <id> --force` immediately, with no confirmation prompt.
- Prompt for an output path when `Export to Markdown` or `Export to JSON` is selected from the browser action menu. The default is `gemini-chat-<id>-<YYYY-MM-DD>.<ext>`; an empty or whitespace-only input falls back to the default. The resolved path is forwarded to `ExportCommand` as `--out <path>`.
- After a successful in-browser delete, the deleted chat is removed from the in-memory chat list before the browser re-enters (so the deleted row is gone from the next page).
- Introduced an interactive conversation browser for `list -i` using Inquirer prompts.
- Added profile and favorites filtering options in the interactive browser.
- Added `--profile` support for conversation filtering in list flows.
- Improved readability for long conversation titles with truncation and ellipsis in browser views.

### Changed

- Replace `@inquirer/core`'s `usePagination` with a custom top-aligned `windowStart` slice in `src/cli/utils/prompts.ts`. The page indicator (`Page: X/Y`) now matches the visible window exactly; the cursor and window both reset to the top on `s` / `p` / `f` filter changes.
- Update `openspec/specs/chat-list-browser/spec.md` to document the top-aligned paged-window model, the `Delete conversation` action, the export path prompt, and the post-delete in-memory list refresh. Add new requirements: "Export action prompts for an output path" and "Delete action bypasses confirmation".
- Refined interactive list UX by removing pagination and simplifying default list behavior.
- Standardized CLI short flags: `-o` for output (`--out`) and reserved `-p` for profile-related usage.
- Updated release publishing behavior so prerelease tags publish to npm `next` instead of overriding `latest`.
- Updated docs and OpenSpec artifacts to reflect the new browser/list behavior and ongoing UX changes.

### Fixed

- `←` / `→` no longer leave the cursor in the middle of the new page (was a `usePagination` centering artifact — a 20-item list with `pageSize: 5` previously rendered `[c18, c19, c00, c01]` on the last page).
- `s` / `p` / `f` now reset both the cursor index and the `windowStart` so the visible window shifts to the new first page (previously the window could be scrolled past the start of the re-sorted / re-filtered list).
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