## ADDED Requirements

### Requirement: `daemon` command is hidden from `--help` but reachable via `gemiterm daemon --help`
The CLI MUST register a new top-level command named `daemon`. The command MUST be hidden from the user-facing help output (`gemiterm --help`), but MUST be discoverable via `gemiterm daemon --help` and via the linked documentation in `docs/DAEMON.md`. The `daemon` command MUST accept exactly these subcommands: `install`, `uninstall`, `run`, `status`, `logs`. Any other subcommand MUST print a usage error and exit non-zero.

#### Scenario: `gemiterm --help` does not list `daemon`
- **WHEN** the user runs `gemiterm --help`
- **THEN** the output MUST NOT contain the literal substring `daemon`

#### Scenario: `gemiterm daemon --help` lists the subcommands
- **WHEN** the user runs `gemiterm daemon --help`
- **THEN** the output MUST list at least the five subcommands `install`, `uninstall`, `run`, `status`, `logs`, each with a one-line description

#### Scenario: Unknown subcommand exits non-zero
- **WHEN** the user runs `gemiterm daemon frobnicate`
- **THEN** the CLI prints a usage error to stderr and exits with a non-zero status code

### Requirement: `gemiterm daemon install` registers an OS service per platform
The `install` subcommand MUST register a one-shot service definition in the operating system's native service manager such that the daemon runs at user logon (or boot, when applicable) and restarts on crash. The exact registration is platform-specific and is defined in the platform-specific requirements below. The `install` subcommand MUST be idempotent — re-running it on an already-installed daemon MUST succeed without registering a duplicate service. The subcommand MUST silently succeed on success (exit 0, no TTY interaction), and MUST print a one-line confirmation that includes the platform-specific service identifier (e.g., the Task Scheduler task name, the systemd unit name). The subcommand MUST NOT modify any cookie data.

#### Scenario: First-time install on Windows
- **WHEN** the user runs `gemiterm daemon install` on Windows and no `gemiterm-daemon` Task Scheduler task exists
- **THEN** a new Task Scheduler user task `gemiterm-daemon` is registered with the trigger `onlogon`, the action invoking `<absolute-path-to-gemiterm> daemon run`, the run-level `limited`, and the force flag set; the subcommand exits 0 and prints one line containing `gemiterm-daemon`

#### Scenario: First-time install on Linux
- **WHEN** the user runs `gemiterm daemon install` on Linux and `~/.config/systemd/user/gemiterm-daemon.service` does not exist
- **THEN** the unit file is written with `Type=simple`, `ExecStart=<absolute-path-to-gemiterm> daemon run`, `Restart=on-failure`, `RestartSec=30`, the environment variable `GEMITERM_DAEMON_INTERVAL_MIN=30`, and `WantedBy=default.target`; `systemctl --user daemon-reload` and `systemctl --user enable --now gemiterm-daemon.service` are invoked; the subcommand exits 0 and prints one line containing `gemiterm-daemon.service`

#### Scenario: Idempotent reinstall overwrites in place
- **WHEN** the user runs `gemiterm daemon install` on any platform when the service is already registered
- **THEN** the existing service definition is replaced in place (overwritten, not duplicated) and the subcommand exits 0

#### Scenario: Install never modifies cookie data
- **WHEN** the user runs `gemiterm daemon install` on any platform
- **THEN** no files under any profile directory are written or modified (verified by mtime before and after)

### Requirement: `gemiterm daemon uninstall` reverses the install atomically
The `uninstall` subcommand MUST stop the running service, disable it, and remove the platform-specific service definition. It MUST exit 0 on success even when no service is registered (idempotent). It MUST NOT modify any cookie data. It MUST NOT print anything to stdout on success other than a one-line confirmation; failures MUST print the platform-specific error reason to stderr and exit non-zero.

#### Scenario: Uninstall on Windows when the task is registered
- **WHEN** the user runs `gemiterm daemon uninstall` on Windows and the `gemiterm-daemon` task exists
- **THEN** the task is deleted via `schtasks /delete /tn "gemiterm-daemon" /f` and the subcommand exits 0

#### Scenario: Uninstall on Linux when the unit file exists
- **WHEN** the user runs `gemiterm daemon uninstall` on Linux and `~/.config/systemd/user/gemiterm-daemon.service` exists
- **THEN** `systemctl --user disable --now gemiterm-daemon.service` is invoked and the unit file is removed; the subcommand exits 0

#### Scenario: Uninstall is idempotent
- **WHEN** the user runs `gemiterm daemon uninstall` on any platform when no service is registered
- **THEN** the subcommand exits 0 without creating any new files or services

### Requirement: `gemiterm daemon run` is the foreground heartbeat loop the OS service invokes
The `run` subcommand is the long-running foreground process that the OS service spawns. It MUST NOT prompt for input, MUST NOT block on stdin, MUST NOT write to stdout (the OS service may detach stdout), MUST write structured log lines to a file whose path is resolved by `getDaemonLogPath()`, and MUST iterate the active-profile list returned by `ProfileManager.listActive()` calling `rotateCookies(profileName, options)` for each on a fixed interval. The interval MUST default to 30 minutes and MUST be overridable via the env var `GEMITERM_DAEMON_INTERVAL_MIN`. Values < 10 MUST be clamped to 10. The loop MUST terminate cleanly on SIGINT and SIGTERM, flushing any pending log writes before exit. The loop MUST be resilient to a single profile's `rotateCookies` throwing — the failed profile is skipped and the next tick proceeds normally.

#### Scenario: Heartbeat fires for every active profile each tick
- **WHEN** the daemon process has been running for one full interval with three active profiles and `rotateCookies` returns `{ rotated: true, attempted: true }` for each
- **THEN** exactly three calls to `rotateCookies` are made per tick, one per profile, in the order returned by `ProfileManager.listActive()`

#### Scenario: A single profile failure does not stop the loop
- **WHEN** `rotateCookies` for profile `B` throws an error and profiles `A` and `C` succeed
- **THEN** the daemon logs a warn-level line for `B`, continues to call `rotateCookies` for `C`, and waits the next interval; the loop does not exit

#### Scenario: Sub-10-minute interval is clamped to 10
- **WHEN** `GEMITERM_DAEMON_INTERVAL_MIN=5` is set and the daemon starts
- **THEN** the effective interval between ticks is 10 minutes (the L1 disk-mtime guard is the actual per-profile throttle)

#### Scenario: SIGINT terminates the loop within one interval
- **WHEN** the daemon receives SIGINT
- **THEN** the in-flight tick completes, the log file is flushed, and the process exits with status 0 within one heartbeat interval

#### Scenario: The daemon does not write to stdout
- **WHEN** the daemon logs a message at any level
- **THEN** the message is written to the log file resolved by `getDaemonLogPath()` and is NOT written to process stdout

### Requirement: `gemiterm daemon status` reports installed state and last-rotation timestamps
The `status` subcommand MUST report, on a single line per platform-specific identifier: whether the service is registered, whether the service is currently running, and (for the daemon's last tick) the timestamp at which each profile was last rotated. When the daemon is not running or not installed, `status` MUST report the relevant subset clearly and exit 0. The subcommand MUST read the log file or a per-daemon status file written by the daemon to obtain the last-rotation timestamps — `status` MUST NOT itself invoke `rotateCookies` or any other network operation.

#### Scenario: Service running and healthy
- **WHEN** the daemon service is registered and running and the last tick rotated two profiles
- **THEN** `gemiterm daemon status` prints at least the service identifier, the literal substring `running`, and one line per profile containing the profile name and a parseable timestamp

#### Scenario: Service registered but not running
- **WHEN** the daemon service is registered but not currently running
- **THEN** `gemiterm daemon status` prints at least the service identifier and the literal substring `not running` and exits 0

#### Scenario: Service not registered
- **WHEN** the user runs `gemiterm daemon status` with no service registered
- **THEN** the subcommand prints a one-line `not installed` message and exits 0

### Requirement: `gemiterm daemon logs [-f]` reads the daemon log file
The `logs` subcommand MUST read the same log file resolved by `getDaemonLogPath()`. With no flag, it MUST print the last 100 lines (or all lines if fewer than 100 exist) and exit 0. With `--follow` (`-f`), it MUST tail the file and append new lines as they are written, terminating only on SIGINT. The subcommand MUST NOT modify the log file.

#### Scenario: Default reads last 100 lines
- **WHEN** the log file has 200 lines and the user runs `gemiterm daemon logs`
- **THEN** exactly the last 100 lines are printed and the subcommand exits 0

#### Scenario: `--follow` tails until interrupted
- **WHEN** the daemon writes a new log line after the user runs `gemiterm daemon logs -f`
- **THEN** the new line appears in the user's terminal within one second of being written, and the subcommand does not exit until the user terminates it with SIGINT

### Requirement: Heartbeat primitive is `rotateCookies` from `src/services/cookie-rotation.ts`
The daemon MUST invoke the existing `rotateCookies(profileName, options)` function from `src/services/cookie-rotation.ts` for each profile in the heartbeat loop. The daemon MUST NOT issue a direct HTTP request to `accounts.google.com/RotateCookies` or any other Google endpoint. The daemon MUST construct the `RotateCookiesOptions` handle using the same `CookieStorage`, `CookieStorageService`, and `Logger` instances that the CLI uses (resolved via the standard mediation paths under `src/infrastructure/`). This guarantees the L1 disk-mtime guard, the in-process throttle, and the `GEMITERM_SKIP_ROTATE_COOKIES` opt-out apply identically to the in-app and daemon paths.

#### Scenario: Daemon call resolves to the same exported function as in-app
- **WHEN** the daemon process calls the heartbeat function for a profile
- **THEN** the call enters the `cookie-rotation.ts` exported `rotateCookies` function (verified via test seam or by the absence of any direct HTTP request from the daemon process to `accounts.google.com`)

#### Scenario: Disk-mtime guard short-circuits the daemon too
- **WHEN** the daemon calls the heartbeat function within 600 seconds of the last successful L1 rotation (per the storage_state.json mtime)
- **THEN** the call returns early without issuing a network request and the daemon logs a debug-level message about the throttle

### Requirement: Cross-platform install supports Windows, Linux, and WSL
The install behavior MUST be selected at runtime by inspecting `process.platform` and (on Linux) the `WSL_INTEROP` and `WSL_DISTRO_NAME` env vars. On `win32`, the Task Scheduler path is used. On `linux` without `WSL_*` env vars, the systemd user unit path is used. On `linux` with `WSL_*` env vars, the systemd path is used when `pidof systemd` returns a PID; otherwise the nohup fallback is used. The CLI MUST NOT fail outright on any unsupported platform — instead, `gemiterm daemon install` MUST print a clear, non-zero-exit error to stderr explaining the platform is not yet supported (unless that error itself would be more confusing than failing silently, in which case the install MUST exit 0 with a `not supported` message).

#### Scenario: Windows install runs only `schtasks`
- **WHEN** `gemiterm daemon install` is run on Windows
- **THEN** the only side effects are a `schtasks /create` invocation and the resulting Task Scheduler registration; no systemd or nohup files are created

#### Scenario: Linux install (non-WSL) runs only systemd
- **WHEN** `gemiterm daemon install` is run on Linux without `WSL_INTEROP` set
- **THEN** the only side effects are the systemd unit file write and `systemctl --user daemon-reload/enable/now` invocations; no `schtasks` invocation and no nohup files are created

#### Scenario: WSL with systemd uses systemd
- **WHEN** `gemiterm daemon install` is run on Linux with `WSL_INTEROP` set and `pidof systemd` returns a PID
- **THEN** the install proceeds exactly as the non-WSL Linux case (systemd path)

#### Scenario: WSL without systemd uses nohup fallback
- **WHEN** `gemiterm daemon install` is run on Linux with `WSL_INTEROP` set and `pidof systemd` returns nothing
- **THEN** the nohup fallback path is used: a nohup invocation of `gemiterm daemon run` is started, the PID is written to `~/.config/gemiterm/daemon.pid`, stdout/stderr are redirected to the log file, and the user is informed at install time that the nohup fallback does not auto-restart

### Requirement: The daemon runs under the user account and uses the user's config directory
On every supported platform, the daemon MUST run as the user (not as root or as a system service). The log file path MUST be resolved via `getConfigDir()` followed by `getDaemonLogPath()`. The cookie storage it reads MUST be the user's cookie storage at the same path the CLI uses. No elevation prompt (UAC, sudo) is ever required to install, run, or uninstall the daemon.

#### Scenario: No elevation prompt on Windows
- **WHEN** `gemiterm daemon install` is run on Windows from a non-elevated shell
- **THEN** the install completes without a UAC prompt

#### Scenario: No sudo prompt on Linux
- **WHEN** `gemiterm daemon install` is run on Linux from a non-root shell
- **THEN** the install completes without a sudo prompt

### Requirement: Daemon and CLI may run concurrently without cookie-storage conflicts
A running daemon and a simultaneous CLI invocation MUST both succeed. The 600 s L1 disk-mtime guard (`src/services/cookie-rotation.ts:49-53`) is a per-file guard read by both processes via the OS filesystem, and the `mergeCookies` upsert in `src/services/auth-service.ts:20-30` plus the `persistRefreshedCookies` `(name, baselineValue)` merge in `src/services/gemini-client-wrapper.ts:119-151` make the cookie storage writes idempotent. The spec locks these existing mechanisms as the contract for cross-process safety; the daemon MUST NOT introduce any new locking.

#### Scenario: CLI rotation succeeds while daemon is running
- **WHEN** a `gemiterm list` call invokes `rotateCookies` at the same wall-clock time the daemon is rotating the same profile
- **THEN** whichever process completes first updates the storage; the second process's `rotateCookies` short-circuits via the disk-mtime guard; no write conflicts and no data loss

#### Scenario: Consecutive CLI invocations while daemon is running
- **WHEN** the user runs `gemiterm list` and then `gemiterm fetch` within 30 seconds while the daemon is also heartbeating
- **THEN** all three invocations (`list`, `fetch`, daemon tick) complete normally; the L1 disk-mtime guard deduplicates the work and no over-rotation occurs

### Requirement: The daemon is opt-in and the prompt layer is untouched
The `daemon` subcommand MUST NOT be auto-prompted on first run. There is no scheduled install, no surprise `Would you like to install the daemon? [y/N]` interactive question, and no entry in `gemiterm init` or `gemiterm setup`. The user MUST explicitly invoke `gemiterm daemon install` to register the service. The `daemon run` subcommand MUST NOT touch any module under `src/cli/utils/prompts.ts` (the prompt layer is the only allowed importer of `@inquirer/prompts` and `@inquirer/core`).

#### Scenario: No auto-install on auth
- **WHEN** the user runs `gemiterm auth` for the first time after installing gemiterm
- **THEN** the daemon is not installed and no install prompt is shown

#### Scenario: Daemon does not import the prompt layer
- **WHEN** the daemon `daemon run` subcommand is statically analyzed
- **THEN** no import statement resolves to `src/cli/utils/prompts.ts` (the prompt facade)
