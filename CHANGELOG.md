## [2.7.0] - 2026-08-08

### Added

- **`gemiterm status --verbose` (`-v`).** Prints per-profile cookie counts and the next `__Secure-1PSIDTS` expiry countdown, followed by the absolute path to each profile storage directory — useful for diagnosing cookie expiry without opening the `%APPDATA%\gemiterm` directory by hand. New `formatDuration(ms)` helper in `infrastructure/formatters.ts` renders compact age strings ("4d 6h" / "2h 30m" / "expired").
- **`status` PROBE column.** `bun run dev status` now validates every profile against Google's API on every invocation — `models()` and `listChats({ limit: 1 })` run in parallel. Three-state column: `✓ live (N≥1)`, `⚠ phantom (models N)`, or `✗ dead: <error>`. Catches the phantom-auth state that was hiding behind local freshness checks. Always-on, no flag needed.
- **Targeted L2 recovery for phantom-auth sessions.** When phantom-auth is detected (models works, listChats empty), `ensureAuthenticated` triggers a headless browser refresh that updates only PSIDTS-related cookies (`__Secure-1PSIDTS`, `__Secure-3PSIDTS`, `SIDCC`) instead of replacing the full jar. Preserves the original login's PSID + companion cookies while picking up a fresh PSIDTS from the browser session. Falls through to full headed re-auth when targeted L2 cannot recover.
- **Phase 0 v2 regression net.** 10 tests (0a–0j) across 8 files lock every known auth bug contract at the cheapest seam: cookie-monitor full-jar capture (0a), auth round-trip (0b), time-passing clock injection (0c), continue-chat metadata (0d), profile routing (0e), recovery ladder (0f), L2 cookie corruption (0g), context roundtrip (0i), status PROBE (0j). Designed to go RED on the exact commit that introduced each historical regression. Documented at `docs/phase-0/phase-0-v2-design.md`.

### Fixed

- **`list` returned 0 chats: cookie monitor trimmed the browser jar to only `__Secure-1PSID`/`__Secure-1PSIDTS`.** `CookieMonitor.poll` and `CookieMonitor.checkCookies` filtered the driver's cookie list to `REQUIRED_COOKIES` before invoking the capture callback, so every persistence path (`authenticate`/`renew` via `waitForLogin`, and `silentRefresh` L2 via `waitForSilentLogin`) wrote only PSID/PSIDTS (×2 domains = 4 cookies) to disk. `models()` and `readChat(<id>)` are PSID-only RPCs and kept working, so the probe reported "valid" indefinitely, but `listChats` enumeration requires the companion cookies (`SID`/`HSID`/`SSID`/…) and returned empty. The login gate (both required cookies present before firing) is preserved; the callback now receives the FULL browser jar, so the complete auth cookie set is captured and persisted. Already-degraded profiles require one `gemiterm login` (or `gemiterm auth -e <name>`) to repopulate — the fix prevents recurrence but does not retroactively backfill existing jars. Root cause and fix documented under `openspec/changes/cookie-jar-integrity`.
- **Profile-scoped data commands broken on first call (`fetch`/`export`/`continue`/`delete`).** The CLI client-service `forProfile` read a module singleton populated only by a prior `getGeminiClient` call, so the first profile-scoped operation in a process threw `AuthenticationError("Not authenticated. Please run 'gemiterm login' first.")`. Both the explicit `--profile` path and the auto-discovery path (`findProfileForConversation` → `forProfile`) were affected. `forProfile` is now async and lazily initializes via `getGeminiClient` (which runs `ensureAuthenticated` + reauth). Internal interface change: `IGeminiClientService` / `IGeminiClientQueryService` `forProfile` returns `Promise<Self>`.
- **`findProfileForConversation` missed non-newest chats.** `GeminiClientService.profileHasConversation` used `listChats({ limit: 1 })`, but `listChats` sorts DESC by timestamp before slicing, so only the newest chat was visible. Any non-newest conversation resolved to "no owning profile". Replaced with an unbounded `listChats()` membership scan.
- **Proactive `__Secure-1PSIDTS` rotation and L2 escalation on server-decline.** (Complements the cookie-monitor capture fix above — necessary but not sufficient on its own: a 4-cookie jar still produced 0 chats until the capture fix landed.) `probeServerSession` only called `models()`, a PSID-only RPC, so a stale `__Secure-1PSIDTS` looked valid and no refresh fired. `ensureAuthenticated` now invokes `rotateCookies` (the L1 `RotateCookies` POST) on every valid-cookie call regardless of probe outcome, proactively keeping `__Secure-1PSIDTS` fresh; the existing 600 s disk-mtime guard throttles actual posts. When L1 actually reaches Google (HTTP 200) but the server declines to issue a fresh `__Secure-1PSIDTS` — the degraded "phantom-auth" state where `models()` (a PSID-only RPC) succeeds yet PSIDTS-requiring RPCs (`listChats`) return empty — `ensureAuthenticated` now escalates to the full `silentRefresh` L2 headless-browser ladder. Because `models()` succeeds indefinitely while only PSIDTS is stale, the prior design's bet on "recovery via the stale-probe path" never fired; the escalation closes that gap. A per-profile 600 s cooldown prevents a persistently-unrecoverable session from launching a browser on every command; throttled/disabled/network-error L1 attempts do not escalate. `rotateCookies` now returns `{rotated, attempted}` (rather than a flat boolean) so the caller can distinguish "server-declined" from "throttled/skipped".
- **`continue` positional-arg parsing misread `--profile`/`--prompt-file` values.** The argv loop now skips the value following `--profile`/`-p` and `--prompt-file`/`-f` when collecting positional `conversation_id` / `message` args, so `gemiterm continue <conv> --profile <name>` no longer risks treating the flag value as the message.
- **`continue` `fetchChat` corrupted `chatMetadata.ctx`.** `GeminiClientService.fetchChat` was overwriting the per-conversation `chatMetadata` record with `{rid, rcid, ctx: null}` on every read; `sendMessage` then treated the empty ctx as authoritative (using `""` instead of the server-issued string). The record is now read-then-merged so an existing ctx is preserved across rid/rcid updates.
- **Profile-resolution error hint referenced the retired `--renew` flag.** The "no authenticated profile" path now suggests `gemiterm login` instead of the obsolete `--renew <name>`.
- **L1 rotation failure hint.** When `rotateCookies` fails on a probe-valid session, `ProfileAuthManager.ensureAuthenticated` now emits a hint pointing to re-auth, with the profile name interpolated correctly.
- **RotateCookies throttle defeated by unrelated jar writes.** The 600 s guard read the jar file's mtime, which `persistRefreshedCookies` refreshed on every API call. Replaced with an in-memory per-process `lastRotatePostAt` Map keyed off actual POST time. One-shot CLI commands always rotate; long-running processes (daemon/REPL) are guarded.
- **Dead sessions (RotateCookies 401/403) never reached the re-auth prompt.** `performRotateCookies` classified all non-200 responses identically. 401/403 now sets `sessionInvalid: true`; `ensureAuthenticated` throws `AuthenticationError` → `getGeminiClient` catches and fires the headed re-auth prompt.
- **L2 browser escalation on L1 decline corrupted cookies.** The full-merge L2 `silentRefresh` replaced the logged-in session's cookie envelope with browser-only cookies from a different session, causing 401 on the next command. L2 escalation on L1 decline is removed entirely — phantom-auth sessions are now recovered via targeted L2 (added above) instead.
- **`continue conversation` started a new chat instead of threading.** `sendMessage` had a cid-only fallback when `chatMetadata.lookup` returned null; the Gemini server requires all three metadata slots (`rid`/`rcid`/`cid`). Added `seedMetadataFromChat()` that reads the existing conversation to backfill `rid`/`rcid` before sending.
- **Targeted L2 blocked by `requireRotation` on phantom sessions.** The targeted L2 opened a headless browser that auto-signed-in with the same cookies (phantom = frontend-valid), so the `CookieMonitor`'s `requireRotation` check blocked the callback — PSID/PSIDTS hadn't changed from the snapshot. 30 s timeout expired → `silentRefresh` returned false → re-auth prompt fired. The `requireRotation` guard is now skipped when `mode === "targeted"`.
- **`list -p <name>` authenticated the default profile instead of the named one.** The `ListChatsQueryHandler` factory lambda was `async () => getGeminiClient()` (zero args). The handler correctly extracted and passed the profile name, but JavaScript silently discarded the extra argument. Fixed the lambda to accept `profileName`.

### Internal

- `createClientServices` extracted from `src/cli/index.ts` into `src/cli/client-services.ts` to expose a testable seam for the `forProfile` wiring.
- Test suite: **954 pass / 1 skip / 0 fail / 2030 expects** (was 928 / 1945 at 2.6.1). Red-then-green regression tests added for each fix at the cheapest seam.
- Phase 0 v2 regression net: 10 tests (0a–0j) across 8 files. Documented at `docs/phase-0/phase-0-v2-design.md`. Bug history ledger at `docs/phantom-bug-synthesis.md`.
- `tests/services/cookie-jar-repro.test.ts`: deterministic repro harness for the 4-cookie degradation symptom at the `GeminiClientService`/SDK seam.
- Architecture review v3 at `docs/phase-0/architecture-review-auth-2026-08-08-v3.html` identifies two deepening candidates for post-v2.7.0 work (state machine explicitness, cookie jar unification).

---

## [2.6.1] - 2026-08-04

### Changed

- **Server-side probe replaced with `models()` RPC.** `ProfileAuthManager.probeServerSession` now calls `geminiClient.models()` instead of `listChats({ limit: 1 })`. The `models()` RPC is the gemini-web-sdk's cheapest definitive positive liveness signal — success means the session is valid, throw means stale. The probe cache TTL and `GEMITERM_PROBE_TTL_MS` override are preserved unchanged.
- **Probe classification simplified from 3 branches to 2.** The "ambiguous" branch (empty `listChats` + no marker) is removed. With `models()` as a definitive yes/no signal, classification is: RPC succeeds → "valid", RPC throws → "stale". A failed RPC is definitive proof of session problems, unlike the prior `listChats`-based probe which treated network failures as "ambiguous" (trust local freshness).

### Removed

- **`profile-has-chats` marker retired.** The per-profile marker file existed only to disambiguate `listChats([])` — stale vs. genuinely empty. With `models()` directly answering "valid or not", the marker has no purpose. `writeProfileHasChats`, `readProfileHasChats` (`io.ts`), and `getProfileHasChatsPath` (`path-utils.ts`) are removed. Existing marker files on disk are harmless zero-byte files; no cleanup migration needed.

### Fixed

- **Cookie jar merge upsert (Proposal A, commit `65b0c38` — previously undocumented in this entry).** `silentRefresh`'s wholesale jar overwrite was replaced with a `mergeCookies` upsert that preserves existing entries (e.g. the `.google.com` `__Secure-1PSIDTS`) instead of evicting them. `CookieStorageService.resolveCookie` now prefers `.google.com`-domain entries, and the L2 `requireRotation` baseline check is domain-preferring, so rotation commits only when the matching domain's cookie actually changed.

### Internal

- `IGeminiClientService` gains `models(): Promise<string[]>`; `GeminiClientService.models()` delegates to the SDK's `models` method.
- `ProbeResult` type reduced from `"valid" | "stale" | "ambiguous"` to `"valid" | "stale"`.
- Phantom-auth test suite and profile-auth-manager tests updated to exercise the `models()` probe path.

---

## [2.6.0] - 2026-08-03

### Added

- Phantom-authentication regression suite (`tests/services/phantom-auth.test.ts`) that locks the post-2h silent-empty-list symptom at the `ProfileAuthManager` seam.
- Server-side session validity probe in `ProfileAuthManager.ensureAuthenticated`. When local cookies pass freshness, the manager now consults `geminiClient.listChats({ limit: 1 })` before returning the loaded cookies. A process-level probe cache (default TTL 150_000 ms, `GEMITERM_PROBE_TTL_MS` override) memoizes the result across calls in the same command run. A per-profile `profile-has-chats` marker is written to disk on every non-empty probe.
- L1 cookie rotation via `accounts.google.com/RotateCookies` (`src/services/cookie-rotation.ts`). `AuthService.silentRefresh` now tries the RotateCookies POST first (no browser, no Playwright, deterministic single round-trip) and only falls through to the L2 headless browser when L1 returns `false` (network error, 401/403, or PSIDTS unchanged). Rate-limited by a 600 s disk-mtime guard and a module-level in-flight throttle. Skippable via `GEMITERM_SKIP_ROTATE_COOKIES`.
- L2 headless refresh hardening. `CookieMonitor.start` accepts an optional `requireRotation` baseline; `AuthService.silentRefresh` snapshots active cookie values before the L2 launch and only commits a refresh when the polled cookies differ from the snapshot, preventing the "no-op rotation" failure mode where the loaded cookies are still valid and Google does not rotate them.

### Fixed

- `GeminiClientService.persistRefreshedCookies` now matches stored cookies by `(name, baselineValue)` instead of `name` only. The SDK jar carries only a `Record<string, string>` (no domain info), so the match key compares the stored cookie's value against `baselineSecure1psid` / `baselineSecure1psidts` captured at construction. On profiles whose storage file contains duplicate `__Secure-1PSID` / `__Secure-1PSIDTS` entries across domains (`.youtube.com` and `.google.com`), this prevents silently overwriting the non-matching domain entry.
- Phantom-authentication symptom (post-2h `gemiterm list` returns empty despite locally-valid cookies and `Profile '<name>' is authenticated` log line). The server-side probe in `ProfileAuthManager.ensureAuthenticated` now detects Google-side session invalidation and triggers silent recovery via the L1 → L2 ladder.
- `list -i` interactive browser: `executeAction` now forwards `chat.profile` to sub-commands (`fetch`, `export`, `continue`, `delete`). Previously the profile was discarded when building argv, forcing the sub-commands through `findProfileForConversation`'s sequential probe and throwing `AuthenticationError` for chats owned by non-default profiles when multiple authenticated profiles exist.

---

## [2.5.0] - 2026-08-02

### Added

- **`gemiterm login`** now automatically extends an existing session silently before it expires, rather than requiring manual re-authentication. `AuthService.silentRefresh()` launches a headless browser, loads stored cookies, and waits for Gemini to merge refreshed session cookies (via `__Secure-1PSIDTS`). If silent refresh succeeds, the command completes without a browser window appearing.
- Interactive re-authentication flow (`gemiterm login` or any command) now prompts with `"Session for profile 'X' has expired. Would you like to launch browser to re-authenticate?"` instead of immediately failing. Answers `y`/`yes` launch the browser; `n`/`no` or `Ctrl+C` re-throws the original `AuthenticationError`.
- `ProfileAuthManager.ensureAuthenticated()` is now `async` and orchestrates the silent-refresh → reauth-prompt chain before surfacing an error to callers.

### Changed

- Cookie freshness threshold reduced from **7 days to 1 hour**. Sessions approaching the 1-hour window before `__Secure-1PSIDTS` expiry are treated as stale, triggering silent refresh on next command invocation. `ProfileManager.getStatus()` now reflects near-expiry state (`isActive: false` with `reason: "session_stale"`).
- `gemiterm list --all-profiles` now filters out unauthenticated profiles before calling `listChats`, preventing stale-profile errors from contaminating results across all profiles. Results are collected via `Promise.allSettled` so one profile's failure does not block others.
- `gemiterm list` throws `GemitermError("Gemini returned no data — session may be expired")` instead of returning an empty list when the SDK returns `null`/`undefined` from `chats()`.
- `profileHasConversation` now propagates errors from `listChats` (e.g. auth failures) instead of swallowing them and returning `false`.

### Internal

- New `src/cli/utils/reauth.ts` facades `AuthService` + inquirer `confirm` for testability.
- `src/cli/index.ts` `setupMediator` refactored: `getGeminiClient()` is now `async`, uses `ProfileAuthManager.ensureAuthenticated()` for all auth decisions, and shares a single `clientService` interface across `FetchChatQueryHandler` / `ListModelsQueryHandler`.
- `CookieStorageService` and `GeminiClientService` cookie-merge paths no longer overwrite the `expires` field of stored cookies, preserving the original expiry set by the browser during auth.
- Added `PlaywrightCliDriver.openHeadless()` for headless browser launches used by silent refresh.

---

## [2.4.2] - 2026-08-01

### Added

- Add DeepWiki badge to README.

---

## [2.4.1] - 2026-08-01

### Added

- Add GitHub stars badge to README.
- Add `keywords` to package.json (agent-tools, ai, cli, gemini-api).

---

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