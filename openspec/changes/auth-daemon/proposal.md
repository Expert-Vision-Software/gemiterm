## Why

The v2.6.2 in-app fix (unconditional L1 `RotateCookies` POST on every `ensureAuthenticated`) is the primary defense against the phantom-auth symptom. It works only when the user is actively invoking the CLI. Gemiterm is used occasionally across multiple accounts, and the user does not want to re-login to any of them between sessions. We assume the in-app fix may not be sufficient on its own — Google can rotate `__Secure-1PSIDTS` server-side at any time, including during a multi-day gap where the CLI is not invoked. A defense-in-depth background heartbeat keeps all configured profiles fresh in the background.

This change is purely additive. It does not modify the in-app auth flow, the L1 rotation function, or the cookie storage. The daemon reuses `rotateCookies` from `src/services/cookie-rotation.ts` as its heartbeat primitive, so any improvements or repairs to L1 are picked up automatically.

## What Changes

- **New capability: `auth-daemon`.** A background process, spawned and managed by the operating system's service manager, that heartbeats `rotateCookies(profile)` for every active profile on a fixed interval.
- **New command: `gemiterm daemon`.** Hidden from `--help`. Subcommands: `install`, `uninstall`, `run`, `status`, `logs`. The `install` and `uninstall` subcommands register and remove the OS service; `run` is the foreground heartbeat loop that the OS service invokes.
- **Cross-platform install.** Windows: Task Scheduler user task `gemiterm-daemon` triggered at logon. Linux: systemd user unit at `~/.config/systemd/user/gemiterm-daemon.service`. WSL: systemd path when enabled, nohup fallback otherwise.
- **Multi-profile by default.** The daemon iterates every profile returned by `ProfileManager.listActive()`. One daemon process per user; no per-profile daemons.
- **Default 30-minute heartbeat.** Overridable via `GEMITERM_DAEMON_INTERVAL_MIN`. The existing 600 s L1 disk-mtime guard remains the per-profile throttle, so the daemon's HTTP load is bounded regardless of the loop interval.
- **Easy install.** Single command. Single uninstall. No separate binary. No auto-prompt — the user opts in explicitly.
- **No breaking changes.** Existing CLI surface, existing flags, existing tests, existing in-app auth flow are all untouched.

## Capabilities

### New Capabilities

- `auth-daemon`: the background heartbeat subprocess, its OS-level lifecycle (install / uninstall / run / status / logs), and the contract that the daemon reuses `rotateCookies` from `cookie-rotation.ts` and never touches the in-app auth flow.

### Modified Capabilities

- `auth`: gains one new requirement — `AuthService` MUST be safe to invoke concurrently with a running `auth-daemon` process, and the two MUST NOT perform conflicting writes to the cookie storage. The L1 disk-mtime guard and the `mergeCookies` upsert in the in-app silent-refresh path satisfy this; the requirement is added so it is locked in the spec rather than only in the code.

## Impact

- **Affected code:** all-new under `src/cli/commands/daemon-command.ts`, `src/services/daemon-service.ts`, `src/services/daemon-install-windows.ts`, `src/services/daemon-install-linux.ts`. Plus a helper in `src/infrastructure/path-utils.ts` (`getDaemonLogPath`). No edits to existing auth, rotation, storage, or profile code.
- **APIs / public surface:** new `gemiterm daemon {install,uninstall,run,status,logs}` subcommand. Hidden from `--help`. No changes to existing flags or commands.
- **Dependencies:** none new. Task Scheduler and systemd are already on the user's system; we just write configs.
- **Multi-profile:** required by design. The daemon iterates profiles from `ProfileManager`. Adding/removing a profile is picked up on the next heartbeat tick; no daemon restart needed.
- **TTY:** the daemon is run by the OS service manager and does not have a TTY. The `daemon run` subcommand MUST NOT prompt for input, MUST NOT block on `await inquirer.prompts`, and MUST log to a file rather than stdout.
- **Conformance:** non-interactive `gemiterm list`, `fetch`, `send`, `new`, `export`, `delete`, `status`, `auth`, `profile` are byte-equivalent to the pre-change baseline. The daemon is opt-in: an explicit `gemiterm daemon install` is required to register the OS service. Default installs are not affected.
- **Security:** the daemon runs as the user, reads cookies from the user's profile directory, and writes logs to the user's config directory. No elevation. No network listeners. HTTPS only (the underlying `rotateCookies` already uses `https://accounts.google.com/RotateCookies`).
