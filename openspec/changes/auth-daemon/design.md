## Context

The phantom-authentication symptom (CLI logs `Profile '<name>' is authenticated` while `listChats` returns empty) has been the focus of a 4-day, 3-release sprint. The v2.6.2 fix closes the in-app blind spot by unconditionally calling `rotateCookies` (L1 `accounts.google.com/RotateCookies` POST, gated by a 600 s disk-mtime guard) on every `ensureAuthenticated`. The fix works when the user is actively using the CLI but does not extend the lifetime of a fresh session across long gaps where the CLI is not invoked.

This change adds a defense-in-depth layer: a background process that runs the same `rotateCookies` heartbeat for every active profile on a fixed interval. The process is managed by the operating system's service manager (Task Scheduler on Windows, systemd on Linux and WSL when enabled). The user opts in with a single command (`gemiterm daemon install`) and opts out with a single command (`gemiterm daemon uninstall`). The CLI itself does not gain a new TUI surface; the `daemon` command is hidden from `--help` and is reachable only via `gemiterm daemon --help` or the linked documentation.

The change is structurally similar to "session keepers" used by other CLI tools that talk to OAuth-backed services — `teng-lin/notebooklm-py`'s 7-layer recovery ladder (which inspired the in-app L1 fix) doesn't have a daemon layer, but the pattern is well-known.

## Goals / Non-Goals

**Goals:**

- New capability: `auth-daemon`.
- A background process that heartbeats the L1 `RotateCookies` POST for every active profile.
- Cross-platform install on Windows (Task Scheduler), Linux (systemd user unit), and WSL (systemd when enabled, nohup fallback otherwise).
- Easy install and easy uninstall via `gemiterm daemon {install,uninstall}`. No separate binary.
- One daemon, many profiles. Multi-account by default.
- Crash-safe: OS service manager restarts on failure.
- Reuse `rotateCookies` from `src/services/cookie-rotation.ts` — the daemon does not implement L1 rotation itself.
- The in-app auth flow (`AuthService`, `ProfileAuthManager`, `CookieMonitor`, `CookieMonitor`) is untouched. The change adds a new sibling that calls into the existing rotation primitive.
- Log to a file in the user's config directory; never write to stdout (the OS service detaches stdout).
- Silent install: `gemiterm daemon install` prints a one-line confirmation on success and exits 0.

**Non-Goals:**

- macOS launchd support (the user did not request it; deferred to a follow-up change if needed).
- Windows Service-style hosting via `node-windows` or similar. Task Scheduler handles the lifecycle natively.
- A network socket / IPC channel between the daemon and the CLI. The CLI's per-call L1 rotation continues to run; the daemon is one-way.
- Auto-starting the daemon on first run. The user must opt in explicitly.
- A `daemon`-level config file or daemon-specific environment beyond `GEMITERM_DAEMON_INTERVAL_MIN`.
- Real-time "session health" telemetry that other tools consume. The daemon writes to a log file only.
- Modifying `gemini-web-sdk`, the SDK's auth handshake, or the in-app `AuthService` / `ProfileAuthManager` paths.

## Decisions

### D1. The daemon is a subcommand of the existing CLI, not a separate binary

The daemon is invoked as `gemiterm daemon run`. The OS service spawns the bundled `gemiterm` binary (or `Bun.spawn gemiterm daemon run` in dev) with this argv. This keeps deployment to a single binary per platform and avoids the "which version of the daemon matches the CLI" coordination problem.

**Why not a separate binary:** every release of gemiterm would need to bundle a daemon that the user trusts at the same version. Subcommands avoid this.

**Why not a separate process started from a cron job:** cron is not on every supported system; systemd Task Scheduler are. The OS service manager handles restart-on-crash, run-as-user, and log rotation natively.

### D2. Heartbeat primitive: reuse `rotateCookies` from `cookie-rotation.ts`

The daemon does **not** call `accounts.google.com/RotateCookies` directly. It imports and calls `rotateCookies(profileName, options)` from `src/services/cookie-rotation.ts`. This means:

- The 600 s L1 disk-mtime guard, the in-process throttle, the `GEMITERM_SKIP_ROTATE_COOKIES` opt-out, and the response parsing all apply automatically to the daemon.
- Bug fixes to L1 rotation (e.g., a future move to a different endpoint) are picked up by the daemon on its next heartbeat tick without any daemon-side change.
- The CLI's per-call L1 rotation and the daemon's heartbeat cannot drift apart — they are the same function.

The daemon imports `rotateCookies` and constructs an in-process handle using the same `CookieStorage`, `CookieStorageService`, and `Logger` instances that the CLI uses. There is no new IPC, no new HTTP client, no new rotation logic.

**Alternative considered:** daemon uses `axios`-style direct HTTP. Rejected — duplicates the L1 logic and creates drift potential.

### D3. Heartbeat cadence: 30 minutes default, with `GEMITERM_DAEMON_INTERVAL_MIN` override

The default interval is 30 minutes. This is intentionally longer than the L1 600 s disk-mtime guard so the daemon rotates everything once per tick but the guard fires as a no-op when the user is actively using the CLI. A 30-minute default means:

- Steady-state HTTP load: one L1 POST per 30 minutes per profile, regardless of how active the user is with the CLI. When the user actively uses the CLI, the per-call rotation handles the freshness and the daemon's tick is a no-op courtesy.
- Worst-case staleness window: ~30 minutes between an actual rotation and a successful server-side response. This is well within Google's rotation tolerance.

The env var `GEMITERM_DAEMON_INTERVAL_MIN` overrides the default. Values < 10 are clamped to 10 (the L1 disk-mtime guard; rotating more frequently is wasted work).

**Alternative considered:** shorter default (5 min). Rejected — burns the L1 disk-mtime guard on every tick and produces zero HTTP requests because the guard short-circuits to "no-op." 30 min gives the guard room to fire on at least one profile per tick when there's something to do.

### D4. Process model: single-process, sequential profile iteration

A single Bun process runs the heartbeat loop. Each tick iterates `ProfileManager.listActive()` sequentially and calls `rotateCookies(profile)` for each. The L1 in-process throttle deduplicates concurrent calls per profile, and the per-profile disk-mtime guard makes sub-throttle-interval calls return early.

This is simpler than a multi-process model (no IPC, no state, no coordination). The wall-time per tick is `O(N_profiles × 100ms)`, which is fine for typical N (1-5 profiles).

### D5. Cross-platform install strategy

Detection happens at install time via `process.platform`. Three implementations:

#### Windows

`gemiterm daemon install` invokes `schtasks /create`:

```
schtasks /create ^
  /tn "gemiterm-daemon" ^
  /tr "<absolute-path-to-gemiterm> daemon run" ^
  /sc onlogon ^
  /rl limited ^
  /f
```

- `onlogon` triggers at user logon. The daemon is a user task; no elevation.
- `rl limited` runs as the logged-on user with limited privileges. No UAC prompt.
- `/f` overwrites any pre-existing task with the same name (idempotent reinstall).
- Absolute path captured via `process.execPath` at install time.
- Status: `schtasks /query /tn "gemiterm-daemon" /fo list` parsed for `Status`.
- Uninstall: `schtasks /delete /tn "gemiterm-daemon" /f`.

#### Linux

Write `~/.config/systemd/user/gemiterm-daemon.service`:

```ini
[Unit]
Description=gemiterm cookie freshness daemon
After=network-online.target

[Service]
Type=simple
ExecStart=%h/.local/bin/gemiterm daemon run
Restart=on-failure
RestartSec=30
Environment=GEMITERM_DAEMON_INTERVAL_MIN=30

[Install]
WantedBy=default.target
```

Then `systemctl --user daemon-reload && systemctl --user enable --now gemiterm-daemon.service`.

- `Type=simple` because the daemon runs in the foreground.
- `Restart=on-failure` with `RestartSec=30` so transient network failures don't thrash.
- `WantedBy=default.target` (user unit, not system).
- Environment variable set in the unit file so editing cadence is one-line.
- Status: `systemctl --user is-active gemiterm-daemon.service`.
- Uninstall: `systemctl --user disable --now gemiterm-daemon.service && rm ~/.config/systemd/user/gemiterm-daemon.service`.

#### WSL

Same as Linux. Detect WSL via the presence of `WSL_INTEROP` env var. If systemd is enabled (`pidof systemd` returns a PID), use the systemd path. Otherwise, fall back to nohup:

```sh
nohup <absolute-path-to-gemiterm> daemon run >> ~/.config/gemiterm/daemon.log 2>&1 &
echo $! > ~/.config/gemiterm/daemon.pid
```

This is a degraded fallback. The user is informed at install time: "WSL without systemd: using nohup fallback. Daemon will not auto-restart on crash or restart on distro reboot."

**Alternative considered:** unified cross-platform service abstraction via `node-windows` + `node-mac` + a wrapper for systemd. Rejected — each platform has native primitives; abstraction layers leak. We ship three small native installers, each ~80 lines.

### D6. Log handling: file with rotation, default 5 MB / 3 files

Default path via `getDaemonLogPath()`:

- Linux/WSL: `~/.config/gemiterm/daemon.log` (falls back to `getConfigDir()`).
- Windows: `%APPDATA%\gemiterm\daemon.log` (via `getConfigDir()` which resolves to `GEMITERM_CONFIG_DIR` → `%APPDATA%\gemiterm`).

Rolling at 5 MB, keep last 3 files (`daemon.log` plus `daemon.log.1`, `daemon.log.2`). Lines are RFC 3339 timestamps + log level + message. Reuse the existing `Logger` from `src/infrastructure/logger.ts` with a streaming file handler. The daemon's logger is configured at startup; level is `info` by default, `debug` if `GEMITERM_VERBOSE=1`.

**`gemiterm daemon logs [-f]`** tails the log file. `-f` follows like `tail -f`; default prints the last 100 lines.

### D7. Concurrency: daemon and CLI may run at the same time

The daemon's heartbeat and the CLI's per-call L1 rotation may interleave. This is safe by construction:

- The CLI's `rotateCookies` is per-process; the daemon is its own process.
- The L1 disk-mtime guard is per-profile per-file, not per-process. Both processes read the same `storage_state.json` mtime; whichever rotates first writes the new cookies, the second sees the new mtime and short-circuits.
- The `mergeCookies` upsert in the in-app `silentRefresh` path (proposal A in v2.6.1) makes the cookie storage write idempotent.

No locking. The two writers race benignly.

### D8. TTY safety

The daemon process is started by the OS service manager, not from a terminal. It has no TTY and no stdin. The `daemon run` subcommand MUST NOT:

- Call `await` on any `@inquirer/prompts` API (which gates on TTY).
- Write to stdout — the OS service detaches stdout in some configurations, so logs would be lost.
- Block waiting for keyboard input.
- Read environment variables that require a TTY (e.g., `SSH_TTY`, `TTY`).

All output goes to the log file. Errors at startup are written to the log file and to stderr (so the OS service manager can capture them via journalctl / Event Log).

### D9. CLI dispatch: hidden from `--help`, reachable via `daemon --help`

The CLI's `registerAllCommands()` lists commands in the order they appear in `--help`. Adding `daemon` to that list would clutter the user-facing surface. Instead:

- `CommandRegistry` is extended with a `hidden` flag on each command. `--help` filters out `hidden` commands.
- `gemiterm daemon --help` lists the subcommands as usual (`install`, `uninstall`, `run`, `status`, `logs`).
- `docs/DAEMON.md` is the primary documentation surface; the README mentions it briefly.

### D10. Auth-resilience: fully-degraded sessions are out of scope

A session that has been server-side-invalidated for >24 hours will return 401 from `RotateCookies`. The daemon cannot recover such a session; it can only keep an already-valid session fresh. The user must re-login once via the CLI after a long absence. This is documented in `docs/DAEMON.md`.

The daemon logs a `warn` line when `rotateCookies` returns `{ rotated: false, attempted: true }`, which is the signature of an attempted-but-rejected rotation (401, 403, or unchanged PSIDTS). The user can `gemiterm daemon logs --follow` to see these.

## Risks / Trade-offs

- **[Daemon crashes between ticks]** → restart on `on-failure` (systemd) or next-task-run (Task Scheduler). Worst-case staleness window = default heartbeat interval (30 min).
- **[WSL without systemd falls back to nohup]** → user is informed at install time. If the WSL distro shuts down, the daemon dies. The user must restart the distro.
- **[Linux non-systemd inits not covered]** → OpenRC, runit, dinit users will see `systemctl --user` fail. Documented limitation.
- **[macOS not supported in this change]** → launchd support is a follow-up. macOS users fall back to in-app L1 rotation only.
- **[Fully-degraded sessions]** → user must re-login via the CLI. The daemon can't recover a 401.
- **[Concurrent writes between daemon and CLI]** → benign race per D7. The disk-mtime guard and `mergeCookies` upsert make both paths idempotent.
- **[Malformed systemd unit file]** → `systemctl --user daemon-reload` reports the error; install returns non-zero with the journalctl-extracted reason. Documented troubleshooting in `docs/DAEMON.md`.
- **[Path staleness on Windows upgrades]** → the Task Scheduler task captures the executable path at install time. If the user upgrades gemiterm and the install path changes, the task runs the old binary. `gemiterm daemon install` is re-run by the upgrade docs; a future change could detect the path mismatch and re-register.
- **[Gem path detection in dev]** → in dev (`bun run`), `process.execPath` is the Bun binary, not the script. The task / unit captures `bun run <script> daemon run`, which is functionally equivalent but slower at startup. Acceptable for dev; release builds use the bundled `gemiterm.exe` (Windows) or POSIX shell wrapper (Linux).

## Migration Plan

- The change is purely additive. No existing commands, flags, or auth flows are modified.
- New `gemiterm daemon` subcommand is hidden from `--help`. Users learn about it via `docs/DAEMON.md` linked from the README.
- Install is opt-in: `gemiterm daemon install`. Uninstall is opt-in: `gemiterm daemon uninstall`. There is no auto-prompt.
- The first release that ships the daemon exposes it under "Unreleased" → next minor version bump. The CHANGELOG entry under "Added" describes the daemon briefly and links to `docs/DAEMON.md`.
- Rollback strategy: `gemiterm daemon uninstall` reverses the install. The cookie data is untouched. Worst case: the user re-installs after a future release if they want the daemon back.

## Open Questions

- **Telemetry to `gemiterm status`.** Should the daemon write a small JSON snapshot (`lastRotationPerProfile`, `lastError`, `pid`) to the user's config directory so `gemiterm status --verbose` can surface daemon health? **Lean yes** — adds one file write per tick and lets the user see daemon state without `gemiterm daemon status`. Decision deferred to spec phase.
- **First-run guidance.** After install, should the daemon print a one-liner ("Installed: <task-name>. Run `gemiterm daemon status` to confirm." and exit 0)? **Lean yes** — keeps install silent on success but visible on failure.
- **Optional firewall prompt on macOS.** macOS is out of scope for this change, but if it lands later, the user may need a firewall prompt the first time the daemon makes an outbound connection. Document as a follow-up, not part of this change.
- **Rotation interval lower bound.** Default 30 min, env-var override, clamp to min 10? Or clamp to min 5 and accept the disk-mtime-guard waste? **Lean 10** — anything below 10 wastes HTTP on the no-op guard.
