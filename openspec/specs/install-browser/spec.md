## Purpose

The browser installation capability. It owns the `InstallBrowserService` that locates an existing system browser (Edge or Chrome on Windows, Chrome/Chromium/Edge on Linux, and Windows-hosted Edge/Chrome from inside WSL) and, when no system browser is found, shells out to `bunx @playwright/cli install-browser chrome-for-testing` to download a managed copy of Chrome for Testing (the canonical chromium channel that `@playwright/cli`'s `--browser=chromium` runtime flag resolves to). It also owns the `install-browser` CLI command that surfaces the install to the user with friendly progress and error messaging.

## Requirements

### Requirement: InstallBrowserService.install prefers an existing system browser
The `InstallBrowserService.install()` method MUST first call `findSystemBrowser()`. When the result has `found === true`, the method MUST log an info-level "Found existing browser" message that includes the browser name and resolved path, print the user-visible string `Using existing <browserName> installation.` to the console, and return successfully without spawning any install subprocess.

#### Scenario: install short-circuits when a system browser is found
- **WHEN** `install()` is called and `findSystemBrowser()` returns `{ found: true, browserName: "Microsoft Edge", path: "<path>" }`
- **THEN** the method resolves successfully, the console receives a line containing `Using existing Microsoft Edge installation.`, and no `bunx @playwright/cli install` subprocess is spawned

### Requirement: InstallBrowserService.install runs bunx playwright install-browser when needed
When `findSystemBrowser()` returns `found === false`, `install()` MUST print the string `No suitable browser found. Installing Chrome for Testing via Playwright...` to the console, log an info message containing `bunx @playwright/cli install-browser chrome-for-testing`, and then run the install subprocess. When the subprocess exits with code 0, the method MUST log the captured stdout, print `Chrome for Testing installed successfully.` to the console, and resolve successfully.

#### Scenario: install runs the bunx subprocess and succeeds
- **WHEN** `findSystemBrowser()` returns `{ found: false, browserName: "none" }` and the subprocess exits with code 0
- **THEN** `install()` resolves successfully, the console receives `No suitable browser found. Installing Chrome for Testing via Playwright...` and `Chrome for Testing installed successfully.`, and the logger receives an info message containing `Browser installation output:`

### Requirement: InstallBrowserService.install throws InstallBrowserError on failure
When the install subprocess fails (non-zero exit, spawn error, or any other failure), the `install()` method MUST throw an `InstallBrowserError`. The error's `cause` field MUST be set to the underlying `PlaywrightCliError` when the failure originates from the CLI subprocess, or to the originating `Error` for any other failure. The error's `message` MUST include the underlying error's message so that the caller can surface it to the user.

#### Scenario: Wraps PlaywrightCliError with cause
- **WHEN** the spawn or the `playwright-cli install-browser` subprocess fails and the underlying error is a `PlaywrightCliError`
- **THEN** `install()` rejects with an `InstallBrowserError` whose `cause` is the `PlaywrightCliError` and whose `message` contains the `PlaywrightCliError.message` text

#### Scenario: Wraps generic Error with cause
- **WHEN** the subprocess fails for any other reason (e.g. spawn error with a plain `Error`)
- **THEN** `install()` rejects with an `InstallBrowserError` whose `cause` is the originating `Error` and whose `message` contains the substring `Failed to install Chrome for Testing:`

#### Scenario: InstallBrowserError exposes name and cause
- **WHEN** an `InstallBrowserError` is constructed with a message and an optional cause
- **THEN** `error.name === "InstallBrowserError"`, `error.message` is the supplied message, and `error.cause` is the supplied cause (or `undefined` when omitted)

### Requirement: InstallBrowserService.findSystemBrowser dispatches by platform
The `findSystemBrowser()` method MUST dispatch to a platform-specific finder based on `process.platform`. On `win32` it MUST call `findWindowsBrowser()`; on `linux` it MUST call `findLinuxBrowser()`; on any other platform it MUST return `{ found: false, browserName: "none" }`.

#### Scenario: Windows platform delegates to the Windows finder
- **WHEN** `findSystemBrowser()` is called with `process.platform === "win32"`
- **THEN** the method returns the result of `findWindowsBrowser()` and uses the Edge/Chrome path resolution

#### Scenario: Linux platform delegates to the Linux finder
- **WHEN** `findSystemBrowser()` is called with `process.platform === "linux"`
- **THEN** the method returns the result of `findLinuxBrowser()`

#### Scenario: Unknown platform returns not found
- **WHEN** `findSystemBrowser()` is called with `process.platform` set to a value other than `win32` or `linux` (e.g. `aix`)
- **THEN** the method returns `{ found: false, browserName: "none" }`

### Requirement: InstallBrowserService Windows finder checks Edge and Chrome
The Windows browser finder MUST check, in order, the following candidate paths for Microsoft Edge and Google Chrome, returning the first one that exists on disk:
- Edge under `%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe` (resolved via `process.env["LOCALAPPDATA"]`, falling back to `<USERPROFILE>\AppData\Local`)
- Edge under `Program Files\...\Microsoft\Edge\Application\msedge.exe` (resolved via `process.env["ProgramFiles(x86)"]` ?? `process.env["ProgramFiles"]` ?? `C:\Program Files`)
- Chrome under `%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe` (same `LOCALAPPDATA` resolution)
- Chrome under `Program Files\...\Google\Chrome\Application\chrome.exe` (same `ProgramFiles` resolution)

The returned object MUST set `browserName` to `"Microsoft Edge"` for an Edge hit and `"Google Chrome"` for a Chrome hit, and MUST set `path` to the resolved path. When none of the paths exist, the method MUST return `{ found: false, browserName: "none" }`.

#### Scenario: Windows finder returns Edge when its local-appdata path exists
- **WHEN** Edge is installed at `<LOCALAPPDATA>\Microsoft\Edge\Application\msedge.exe`
- **THEN** `findSystemBrowser()` returns `{ found: true, browserName: "Microsoft Edge", path: <resolved path> }`

#### Scenario: Windows finder returns Chrome when its Program Files path exists
- **WHEN** Chrome is installed at `<ProgramFiles(x86)>\Google\Chrome\Application\chrome.exe` and Edge is not installed at any checked location
- **THEN** `findSystemBrowser()` returns `{ found: true, browserName: "Google Chrome", path: <resolved path> }`

#### Scenario: Windows finder returns not found when neither browser is installed
- **WHEN** none of the Edge or Chrome candidate paths exist on disk
- **THEN** `findSystemBrowser()` returns `{ found: false, browserName: "none" }`

### Requirement: InstallBrowserService Linux finder checks standard paths
The Linux browser finder MUST check, in order, the following candidate paths and return the first one that exists:
- `/usr/bin/google-chrome` (label `Google Chrome`)
- `/usr/bin/google-chrome-beta` (label `Google Chrome (Beta)`)
- `/usr/bin/chromium` (label `Chromium`)
- `/usr/bin/chromium-browser` (label `Chromium Browser`)
- `/usr/bin/microsoft-edge` (label `Microsoft Edge`)

When none of these paths exist, the finder MUST delegate to the WSL finder if `isWsl()` returns `true`, and MUST otherwise return `{ found: false, browserName: "none" }`.

#### Scenario: Linux finder returns Google Chrome when present
- **WHEN** `/usr/bin/google-chrome` exists on disk
- **THEN** `findSystemBrowser()` returns `{ found: true, browserName: "Google Chrome", path: "/usr/bin/google-chrome" }`

#### Scenario: Linux finder returns Chromium when no Chrome is present
- **WHEN** no Chrome Beta/Chromium/Edge binary exists but `/usr/bin/chromium` does
- **THEN** `findSystemBrowser()` returns `{ found: true, browserName: "Chromium", path: "/usr/bin/chromium" }`

#### Scenario: Linux finder delegates to WSL finder when no Linux browser is found
- **WHEN** none of the candidate Linux paths exist and `isWsl()` returns `true`
- **THEN** `findSystemBrowser()` returns the result of the WSL finder

#### Scenario: Linux finder returns not found when no browser is installed
- **WHEN** none of the candidate Linux paths exist and `isWsl()` returns `false`
- **THEN** `findSystemBrowser()` returns `{ found: false, browserName: "none" }`

### Requirement: InstallBrowserService WSL finder checks Windows paths from inside WSL
The WSL browser finder MUST resolve a Windows root from `/proc/mounts` by finding a line that contains both the substrings `9p` and `drvfs` and using the second whitespace-separated field as the mount point (stripping any trailing `/` or path separator). When no such mount is found, the method MUST return `{ found: false, browserName: "none" }`. With a valid Windows root, the method MUST check, in order:
- `<windowsRoot>/Program Files (x86)/Microsoft/Edge/Application/msedge.exe` (label `Microsoft Edge (Windows via WSL)`)
- `<windowsRoot>/Program Files/Google/Chrome/Application/chrome.exe` (label `Google Chrome (Windows via WSL)`)

The `isWsl()` helper MUST return `true` only when `/proc/version` exists AND its content (lower-cased) contains the substring `microsoft`; otherwise it MUST return `false`.

#### Scenario: WSL finder resolves the Windows root from /proc/mounts
- **WHEN** `/proc/mounts` contains a line matching `9p drvfs` whose mount point is `/mnt/c`
- **THEN** the WSL finder treats `/mnt/c` as the Windows root for path resolution

#### Scenario: WSL finder returns Edge when the Windows Edge path exists
- **WHEN** the resolved Windows root is `/mnt/c` and `/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe` exists
- **THEN** `findSystemBrowser()` returns `{ found: true, browserName: "Microsoft Edge (Windows via WSL)", path: <resolved path> }`

#### Scenario: WSL finder returns Chrome when only the Windows Chrome path exists
- **WHEN** the resolved Windows root is `/mnt/c`, the Edge path does not exist, and `/mnt/c/Program Files/Google/Chrome/Application/chrome.exe` does exist
- **THEN** `findSystemBrowser()` returns `{ found: true, browserName: "Google Chrome (Windows via WSL)", path: <resolved path> }`

#### Scenario: WSL finder returns not found when no Windows browser is reachable
- **WHEN** the resolved Windows root is `/mnt/c` and neither the Edge nor the Chrome path exists
- **THEN** `findSystemBrowser()` returns `{ found: false, browserName: "none" }`

#### Scenario: WSL finder returns not found when no 9p drvfs mount is present
- **WHEN** `/proc/mounts` does not contain any `9p` `drvfs` line
- **THEN** `findSystemBrowser()` returns `{ found: false, browserName: "none" }`

### Requirement: InstallBrowserCommand wraps the install service for CLI invocation
The `InstallBrowserCommand` class MUST be registered as the CLI command `"install-browser"` with a description that includes the words `Chrome for Testing`. The `execute(_args, _context)` method MUST instantiate an `InstallBrowserService` (passing a logger named `"install-browser-command"`), print the dim message `Checking browser installation...` to the console, call `service.install()`, and on success print the green message `Browser ready.` to the console.

#### Scenario: InstallBrowserCommand metadata
- **WHEN** an `InstallBrowserCommand` instance is constructed
- **THEN** `command.name === "install-browser"` and `command.description` contains the substring `Chrome for Testing`

#### Scenario: Successful install prints the ready message
- **WHEN** `execute([], { verbose: false })` is called and `service.install()` resolves
- **THEN** the console receives `Checking browser installation...` followed by `Browser ready.` and the method resolves successfully

### Requirement: InstallBrowserCommand handles InstallBrowserError with a friendly message and exits non-zero
When `service.install()` rejects with an `InstallBrowserError`, the `InstallBrowserCommand.execute` method MUST:
- Log the error's message at error level via the logger.
- When the error has a `cause`, log `Cause: <cause.message>` at error level via the logger.
- Print the red message `Failed to install browser.` to stderr.
- Print the dim message `You may need to run: bunx @playwright/cli install-browser chrome-for-testing` to stderr as remediation.
- Call `process.exit(1)` to terminate the process with a non-zero exit code.

#### Scenario: InstallBrowserError causes exit code 1
- **WHEN** `service.install()` rejects with an `InstallBrowserError` whose message is `install failed`
- **THEN** `execute` ultimately causes `process.exit` to be called with `1` and stderr receives the friendly failure and remediation messages
