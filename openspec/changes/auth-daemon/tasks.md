## 1. Infrastructure: log-file path helper

- [ ] 1.1 Add `getDaemonLogPath()` to `src/infrastructure/path-utils.ts` returning `joinPath(getConfigDir(), "daemon.log")`. The function MUST resolve via the standard mediation path (no direct `node:path` use).
- [ ] 1.2 Ensure `getDaemonLogPath` has at least 2 call sites once `daemon-service.ts` and `tests/cli/daemon-command.test.ts` consume it (CI enforcement: `io.ts` and `path-utils.ts` 2-call-site rule from `AGENTS.md`).

## 2. `daemon-service`: heartbeat loop and lifecycle

- [ ] 2.1 Create `src/services/daemon-service.ts` exporting a `DaemonService` class with constructor dependencies `logger: Logger`, `cookieStorage: CookieStorage`, `cookieStorageService: CookieStorageService`, `profileManager: ProfileManager`.
- [ ] 2.2 Implement `start(intervalMin?: number): Promise<void>` that begins the heartbeat loop. The interval MUST default to 30 (minutes), be overridable via `GEMITERM_DAEMON_INTERVAL_MIN`, and clamp any value < 10 to 10.
- [ ] 2.3 Implement the per-tick iteration: read `profileManager.listActive()`, call `rotateCookies(name, {cookieStorage, cookieStorageService, logger, fetcher: fetch, now: Date.now})` for each, wrap each call in try/catch (log warn on throw, do not abort the tick), and emit a debug-level summary line at the end of the tick.
- [ ] 2.4 Implement SIGINT/SIGTERM handling: install signal handlers on first `start()`, on signal set a "stopping" flag, finish the in-flight tick, flush logger, and `process.exit(0)`. Handlers MUST be idempotent on repeated signals.
- [ ] 2.5 Implement `stop(): Promise<void>` for explicit shutdown (called from `daemon run`'s shutdown path, not from `install`/`uninstall`).
- [ ] 2.6 Wire the file logger: a `Logger` instance configured to write to `getDaemonLogPath()` with rolling rotation (5 MB × 3 files). RFC 3339 timestamp lines.
- [ ] 2.7 Add a unit test `tests/services/daemon-service.test.ts` verifying: (a) all active profiles are rotated each tick, (b) a single profile throwing does not stop the loop, (c) sub-10 interval clamps to 10, (d) SIGINT terminates cleanly.

## 3. Windows install/uninstall (`daemon-install-windows.ts`)

- [ ] 3.1 Create `src/services/daemon-install-windows.ts` exporting `installWindows(gemitermPath: string, logger: Logger): Promise<void>`, `uninstallWindows(logger: Logger): Promise<void>`, and `statusWindows(): Promise<{ installed: boolean; running: boolean }>`.
- [ ] 3.2 `installWindows` uses `Bun.spawn(["schtasks", "/create", "/tn", "gemiterm-daemon", "/tr", `<gemitermPath> daemon run`, "/sc", "onlogon", "/rl", "limited", "/f"])` and rejects on non-zero exit. The error message MUST include the captured stderr.
- [ ] 3.3 `uninstallWindows` uses `Bun.spawn(["schtasks", "/delete", "/tn", "gemiterm-daemon", "/f"])` and returns silently on `not found` (interpret "ERROR: The system cannot find the file specified" as success).
- [ ] 3.4 `statusWindows` parses `schtasks /query /tn "gemiterm-daemon" /fo list` and returns `{ installed: <bool>, running: <bool> }`.
- [ ] 3.5 Write the executable-path resolver: capture `process.execPath` for bundled-binary builds, or `bun + script` for dev. The dev path falls back to `bun run <absolute-script-path> daemon run`. The path is resolved at install time and embedded in the task.
- [ ] 3.6 Add a unit test `tests/integration/daemon-install.test.ts` mocking `Bun.spawn` to assert correct `schtasks` argv for install/uninstall/status.

## 4. Linux systemd install/uninstall (`daemon-install-linux.ts`)

- [ ] 4.1 Create `src/services/daemon-install-linux.ts` exporting `installSystemd(gemitermPath: string, intervalMin: number, logger: Logger): Promise<void>`, `uninstallSystemd(logger: Logger): Promise<void>`, `statusSystemd(): Promise<{installed: boolean; running: boolean}>`, and `isSystemdAvailable(): Promise<boolean>`.
- [ ] 4.2 `installSystemd` writes the unit file to `~/.config/systemd/user/gemiterm-daemon.service` (using `writeTextFile` from `io.ts`), then runs `systemctl --user daemon-reload` and `systemctl --user enable --now gemiterm-daemon.service` via `Bun.spawn`. Reject on non-zero; capture stderr in the error message.
- [ ] 4.3 `uninstallSystemd` runs `systemctl --user disable --now gemiterm-daemon.service` (interpret "Unit not loaded" as success) and removes the unit file via `removeDir`/`safeReadTextFile` from `io.ts` (or `Bun.spawn(["rm", path])` if no helper exists, gated by the 2-call-site rule).
- [ ] 4.4 `statusSystemd` runs `systemctl --user is-active gemiterm-daemon.service` and parses the output (`active` / `inactive` / `unknown`). Also check `~/.config/systemd/user/gemiterm-daemon.service` existence for `installed`.
- [ ] 4.5 `isSystemdAvailable` returns `true` when `pidof systemd` (via `Bun.spawn`) returns at least one PID.
- [ ] 4.6 Write the unit file template using a `String.raw` template in code. The `ExecStart` MUST be the absolute `gemitermPath` resolved per D5 (Linux).
- [ ] 4.7 Add the same mock-`Bun.spawn` test coverage as Windows in `tests/integration/daemon-install.test.ts`.

## 5. WSL detection and nohup fallback

- [ ] 5.1 Add `isWSL(): boolean` resolution helper to `src/services/daemon-install-linux.ts` (or expose the existing `isWSL` from `path-utils.ts` if it exists — verify before adding).
- [ ] 5.2 Implement `installNohupFallback(gemitermPath: string, intervalMin: number, logger: Logger): Promise<void>` and `statusNohubFallback(): Promise<{installed: boolean; running: boolean}>`.
- [ ] 5.3 `installNohupFallback` resolves `~/.config/gemiterm/` (via `getConfigDir()` if it coincides or a new helper), writes the PID to `daemon.pid`, and spawns `nohup` via `Bun.spawn` with `stdout: "ignore"`, `stderr: "ignore"` and `detached: true`. The process MUST be detached so closing the parent terminal does not kill it.
- [ ] 5.4 `statusNohubFallback` checks `daemon.pid` existence and `kill -0` via `Bun.spawn` (returns `running: true` if `kill -0 <pid>` exits 0).
- [ ] 5.5 Top-level `installLinuxOrWSL(...)` in the same file: if `isWSL()` and `!await isSystemdAvailable()`, use `installNohupFallback`; otherwise `installSystemd`. Log an `info` line on which path was taken.
- [ ] 5.6 Top-level `uninstallLinuxOrWSL(...)` mirrors: `pkill` the nohup PID file if present, otherwise `uninstallSystemd`.
- [ ] 5.7 Add test coverage in `tests/integration/daemon-install.test.ts` for both branches.

## 6. `daemon` CLI command (`daemon-command.ts`)

- [ ] 6.1 Create `src/cli/commands/daemon-command.ts` with a single `DaemonCommand` class exporting `execute(args, deps)`. The handler MUST dispatch on the first positional arg to one of `install`, `uninstall`, `run`, `status`, `logs`.
- [ ] 6.2 Implement `install`: detect platform via `process.platform`. On `win32` call `installWindows`. On `linux` call `installLinuxOrWSL`. On other platforms print `not supported` to stderr and exit non-zero. Print one confirmation line including the platform-specific service identifier; exit 0 on success.
- [ ] 6.3 Implement `uninstall`: same platform dispatch via `uninstallWindows` / `uninstallLinuxOrWSL`. Exit 0 (idempotent). Do NOT modify cookie data.
- [ ] 6.4 Implement `run`: instantiate `DaemonService` with the resolved deps from `deps`, call `start()` and `await` until the SIGINT/SIGTERM handler triggers `stop()`. The command MUST NOT register a TTY prompt or write to stdout.
- [ ] 6.5 Implement `status`: dispatch to `statusWindows` / top-level `statusLinuxOrWSL`. Print a multi-line summary (installed, running, per-profile last-rotation timestamp). Exit 0 in all cases.
- [ ] 6.6 Implement `logs`: read the file via `readTextFile` from `io.ts`. Default: print last 100 lines. With `--follow` / `-f`: tail the file using a small `Bun.file(path).stream()` watcher (or `setInterval` polling at 1 s) until SIGINT.
- [ ] 6.7 Add a CLI smoke test `tests/cli/daemon-command.test.ts` that asserts: (a) unknown subcommand exits non-zero, (b) `install` on a mocked `Bun.spawn` produces the correct platform-specific call, (c) `logs -f` reads the file via `readTextFile`.

## 7. Register `daemon` as a hidden command

- [ ] 7.1 Add a `hidden?: boolean` field to the `CommandRegistration` shape in `src/cli/command-registry.ts` (verify the exact type name first). Default `false`.
- [ ] 7.2 Register `daemon` in `registerAllCommands()` with `hidden: true`. Place the registration after the user-facing commands.
- [ ] 7.3 Verify `gemiterm --help` no longer shows `daemon`. Add a CLI integration test in `tests/cli/cli-help.test.ts` (or equivalent) asserting that the literal substring `daemon` is NOT in the help output but IS in `gemiterm daemon --help`.

## 8. Concurrent-safety contract test for the `auth` capability

- [ ] 8.1 Add a contract test in `tests/services/auth-daemon-concurrency.test.ts` (or extend an existing concurrency suite) that:
  - Runs two `rotateCookies(profileName, ...)` invocations concurrently from two distinct `ProfileAuthManager` instances using the same `CookieStorage` backing file.
  - Asserts that exactly ONE HTTP POST is issued across both processes (verifiable via a mock `fetcher`).
  - Asserts both processes return a sane `RotateCookiesResult` (one `{ rotated: true, attempted: true }`, one `{ rotated: false, attempted: false }` short-circuit).
- [ ] 8.2 Add a second test that runs `mergeCookies([validPSIDGoogle, validPSIDTSGoogle], [validPSIDGoogle, polledPSIDTSDifferent])` and asserts the `.google.com` `__Secure-1PSIDTS` is preserved.
- [ ] 8.3 Wire the test into `bun run test:unit` so it runs in CI.

## 9. Cross-platform install CI smoke

- [ ] 9.1 Add a Windows runner step to `.github/workflows/test.yml` that runs `bun run build:windows` and then executes `gemiterm.exe daemon install` followed by `gemiterm.exe daemon status` asserting the substring `gemiterm-daemon` appears.
- [ ] 9.2 Add a Linux runner step that runs `bun run build:linux` and then `gemiterm daemon install` and `gemiterm daemon status` on the systemd path, asserting `gemiterm-daemon.service` is `active`.
- [ ] 9.3 The CI steps MUST `gemiterm daemon uninstall` in a `finally` block so the runner's session isn't polluted.

## 10. Documentation and CHANGELOG

- [ ] 10.1 Create `docs/DAEMON.md` covering: what the daemon is, why it exists, install per platform (Windows / Linux / WSL with systemd / WSL without systemd), uninstall, where logs live, how to interpret `status`, troubleshooting (failed install, daemon not rotating, 401 errors from `rotateCookies`), and the explicit "fully-degraded session requires re-login" limitation.
- [ ] 10.2 Add a brief `## Background daemon` section to `README.md` linking to `docs/DAEMON.md`. Do NOT auto-prompt or auto-install.
- [ ] 10.3 Add an `Added` entry under the `## [Unreleased]` heading in `CHANGELOG.md` for the daemon, including the cross-platform install matrix and the link to `docs/DAEMON.md`.

## 11. Verification

- [ ] 11.1 `bun run typecheck` clean.
- [ ] 11.2 `bun test` (full suite) green. Update `docs/testing-baseline.xml` with the new test count and `<LastUpdated>`.
- [ ] 11.3 `openspec validate --strict --change auth-daemon` clean.
- [ ] 11.4 Manual smoke:
  - [ ] 11.4.1 `bun run dev daemon install` on Windows or Linux dev environment; assert no elevation prompt.
  - [ ] 11.4.2 `bun run dev daemon status` returns `running` after install.
  - [ ] 11.4.3 `bun run dev daemon logs -f` tails a live rotation event from a `bun run dev list --profile <name>` invocation.
  - [ ] 11.4.4 `bun run dev daemon uninstall` reverses the install; subsequent `daemon status` returns `not installed`.
  - [ ] 11.4.5 Concurrent: with the daemon running, run `bun run dev list` twice within 30 s. The second invocation MUST NOT issue a second HTTP `RotateCookies` POST (verified via `--verbose` log line on the L1 guard skip).
