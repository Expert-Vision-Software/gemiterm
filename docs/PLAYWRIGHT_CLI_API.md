# playwright-cli API Reference

> Source: [microsoft/playwright-cli](https://github.com/microsoft/playwright-cli)  
> Verified against: `@playwright/cli` (installed via `bunx --bun @playwright/cli --help`)

## Architecture

- **Daemon-based**: `open` returns immediately; the browser runs as a background process.
- **Session-based**: Every command targets a browser session via `-s=<name>`. Without `-s`, commands hit the unnamed **default session**.
- **Session resolution priority**: `-s=<name>` flag → `PLAYWRIGHT_CLI_SESSION` env var → default session.

## Session Management

```bash
playwright-cli list                          # list all active sessions
playwright-cli -s=myprofile list            # list details for one session
playwright-cli close                        # close the default session
playwright-cli close-all                    # close all sessions gracefully
playwright-cli kill-all                     # force-kill all sessions
playwright-cli delete-data                  # wipe persistent profile data for a session
```

## Core Commands

### `open [url]`

Opens a headed browser and navigates to the URL. **Returns immediately** (daemon-style).

```bash
playwright-cli open https://example.com
playwright-cli -s=myprofile open --browser=chromium --headed --persistent --profile=/path/to/dir https://example.com
```

| Flag | Description | Values |
|---|---|---|
| `--browser` | Browser engine | `chromium`, `firefox`, `webkit`, `msedge` |
| `--headed` | Show the browser UI (default: headless) | flag |
| `--persistent` | Persist profile to disk on close | flag |
| `--profile=<path>` | Custom user-data directory path | absolute path |
| `--config=<file>` | Path to config file | default: `.playwright/cli.config.json` |
| `--extension` | Connect via browser extension | flag |

### `goto <url>`

Navigate the current session to a URL (must target an open session):

```bash
playwright-cli -s=myprofile goto https://other.example.com
```

### `close` / `detach` / `attach`

```bash
playwright-cli -s=myprofile close           # graceful close
playwright-cli -s=myprofile detach          # detach CLI but keep browser running
playwright-cli attach myprofile             # re-attach to a running session
```

## Input Commands

All input commands target an active session and operate on element references obtained from `snapshot`.

```bash
playwright-cli -s=myprofile click <ref> [button]
playwright-cli -s=myprofile type <text>
playwright-cli -s=myprofile fill <ref> <text>
playwright-cli -s=myprofile press <key>          # e.g. Enter, Tab, Escape
playwright-cli -s=myprofile hover <ref>
playwright-cli -s=myprofile select <ref> <val>
playwright-cli -s=myprofile upload <file>
playwright-cli -s=myprofile check <ref> / uncheck <ref>
playwright-cli -s=myprofile drag <startRef> <endRef>
playwright-cli -s=myprofile drop <ref>
playwright-cli -s=myprofile dialog-accept [prompt]
playwright-cli -s=myprofile dialog-dismiss
```

## Storage & State Commands

### `state-save [filename]`

Exports the current session's cookies + localStorage to a JSON file. **Writes directly to disk.**

```bash
playwright-cli -s=myprofile state-save auth.json
playwright-cli -s=myprofile state-save           # auto-name: storage-state-{timestamp}.json
```

The output JSON matches Playwright's `StorageState` format:

```jsonc
{
  "cookies": [{ "name": "...", "value": "...", "domain": "...", "path": "/", "expires": -1, "httpOnly": true, "secure": true, "sameSite": "Lax" }],
  "origins": [{ "origin": "https://example.com", "localStorage": [{ "name": "...", "value": "..." }] }]
}
```

### `state-load <filename>`

Imports cookies and localStorage from a JSON file into the current session. **Must be called after the browser is open.**

```bash
playwright-cli -s=myprofile state-load auth.json
```

### `cookie-list` / `cookie-get` / `cookie-set` / `cookie-delete` / `cookie-clear`

```bash
playwright-cli -s=myprofile cookie-list                  # text table output
playwright-cli -s=myprofile cookie-list --json           # JSON output
playwright-cli -s=myprofile cookie-list --domain=google.com   # filter by domain
playwright-cli -s=myprofile cookie-get "__Secure-1PSID"
playwright-cli -s=myprofile cookie-set "name" "value" --domain=.example.com --secure --httpOnly
playwright-cli -s=myprofile cookie-delete "name"
playwright-cli -s=myprofile cookie-clear
```

**Important**: `cookie-list` outputs a human-readable text table by default. The `--json` flag (undocumented in `--help`, silently supported) wraps that text in a JSON object: `{"result": "<text>"}` — it does **not** emit a JSON array of cookie objects. See [Cookie-list output format](#cookie-list-output-format) below for the real shapes.

### Cookie-list output format

`cookie-list` is one of the most-misused commands because `--json` does not return what its name suggests.

**Default output (no flag)** — one cookie per line, no header:
```
__Secure-1PSID=abc123 (domain: .google.com, path: /)
__Secure-1PSIDTS=xyz789 (domain: .google.com, path: /)
```

**With `--json`** — single-line wrapper whose `result` field is the same text as above:
```json
{"result": "__Secure-1PSID=abc123 (domain: .google.com, path: /)\n__Secure-1PSIDTS=xyz789 (domain: .google.com, path: /)\n"}
```

**Empty state** — the literal line `No cookies found` (and with `--json`, `{"result": "No cookies found\n"}`).

**What's missing from the text format:** `expires`, `httpOnly`, `secure`, `sameSite`. If you need those, use `run-code` with `page.context().cookies()` or call `state-save` and parse the resulting file.

**Note:** `--json` is not listed in `cookie-list --help` but is silently supported. Verified in `@playwright/cli` v0.1.13.

## Evaluation & Snapshots

### `eval <func> [ref]`

Run JavaScript on the page and print the result.

```bash
playwright-cli -s=myprofile eval "document.title"
playwright-cli -s=myprofile eval "document.querySelector('textarea') !== null"
playwright-cli -s=myprofile eval "window.location.href"
```

### `snapshot [target]`

Captures a page snapshot for obtaining element references. **Returns YAML/HTML, NOT JSON.**

```bash
playwright-cli -s=myprofile snapshot                         # full page → stdout/YAML
playwright-cli -s=myprofile snapshot --filename=snap.yaml   # save to file
playwright-cli -s=myprofile snapshot "div.main"            # target a specific element
```

> ⚠️ `snapshot` does **not** return an accessibility (AX) tree. Use `eval` with DOM queries for conditional logic like login detection.

### `run-code [code]`

Run a Playwright code snippet with access to the `page` object.

```bash
playwright-cli -s=myprofile run-code "async page => {
  const title = await page.title();
  return title;
}"
```

## Navigation Commands

```bash
playwright-cli -s=myprofile go-back
playwright-cli -s=myprofile go-forward
playwright-cli -s=myprofile reload
```

## Tab Management

```bash
playwright-cli -s=myprofile tab-list
playwright-cli -s=myprofile tab-new [url]
playwright-cli -s=myprofile tab-close [index]
playwright-cli -s=myprofile tab-select <index>
```

## Global Flags

| Flag | Description |
|---|---|
| `-s=<name>` | Target a named session |
| `--json` | Output as JSON (applies to most read commands) |
| `--raw` | Output only the value, no status wrapper |
| `--config=<file>` | Use a specific config file |
| `--help [command]` | Show help |
| `--version` | Print version |

## Configuration File

Located at `.playwright/cli.config.json` by default:

```jsonc
{
  "browser": {
    "browserName": "chromium",       // chromium | firefox | webkit
    "isolated": false,                // true = in-memory only (no persistence)
    "userDataDir": "/path/to/dir",   // persistent profile directory
    "launchOptions": {
      "headless": false,
      "channel": "chrome",           // use system Chrome instead of bundled Chromium
      "executablePath": "/path/to/browser"
    },
    "contextOptions": {
      "viewport": { "width": 1280, "height": 720 }
    }
  },
  "outputDir": "./output",
  "outputMode": "stdout",            // stdout | file
  "console": { "level": "info" },
  "testIdAttribute": "data-testid"
}
```

## Output Format Reference

| Command | Default Output | With `--json` |
|---|---|---|
| `cookie-list` | Text table (name, value, domain, flags) | JSON wrapper `{"result": "<text>"}` (not an array) |
| `snapshot` | YAML/HTML (not AX tree) | JSON status wrapper |
| `state-save` | Writes file to disk, confirmation on stdout | N/A |
| `eval` | Raw JS return value | JSON status wrapper |
| `list` | Text session info | JSON session objects |

## Persistence Behavior

- `--persistent` / `--profile=<dir>`: Profile data is **automatically saved** when the browser closes. Reopening with the same profile preserves cookies, localStorage, etc.
- `state-save`: **Explicit export** to a portable JSON file. Needed when you want to share state across different profile directories or import into non-CLI Playwright contexts.
- For cookie scraping: use `state-save` to export to `.auth/<profile>.json`. The persistent profile is only for the browser's own session continuity.

## Common Patterns

### Login Detection (eval)

```bash
# Check for Gemini prompt textarea
playwright-cli -s=gemini eval "document.querySelector('textarea[aria-label*=\"prompt\" i]') !== null"

# Check URL
playwright-cli -s=gemini eval "window.location.href"
```

> Tip: cookie-based detection (poll `cookie-list` for `__Secure-1PSID`) is more reliable than DOM probes because cookies are observable even when the page is still mid-render. See [Cookie-list output format](#cookie-list-output-format) for how to parse the response.

### Cookie Scraping Pipeline

```bash
# 1. Open headed browser with persistent profile
playwright-cli -s=mysess open --headed --persistent --profile=./.auth/profiles/gemini https://gemini.google.com/app

# 2. User logs in manually...

# 3. Export state to portable JSON
playwright-cli -s=mysess state-save .auth/gemini.json

# 4. Close the session
playwright-cli -s=mysess close
```

### Re-verify a Saved Login

```bash
# 1. Open browser (can use same persistent profile or fresh)
playwright-cli -s=mysess open --headed https://gemini.google.com/app

# 2. Inject saved state
playwright-cli -s=mysess state-load .auth/gemini.json

# 3. Reload page to apply cookies
playwright-cli -s=mysess reload

## Common Pitfalls

Things that look right but will silently break your code. Verified against `@playwright/cli` v0.1.13.

### `cookie-list --json` is not a JSON array

It's a wrapper `{"result": "<text>"}` around the same human-readable text. Calling `JSON.parse` and treating the result as an array will always yield zero cookies, and your login detection will time out without any visible error. See [Cookie-list output format](#cookie-list-output-format).

### `eval` results are wrapped unless you pass `--raw`

`playwright-cli -s=X eval "..."` returns a JSON status envelope, e.g. `{"status":"success","result":"..."}`. To get the raw return value, append `--raw`. Required whenever you compare an eval result to a literal string (e.g. `=== "true"`).

### `open` is fire-and-forget (daemon-style)

`playwright-cli open <url>` returns as soon as the browser process has been launched, not when the page is loaded. If you start polling the session immediately after, your first `eval` / `cookie-list` may race the still-spawning daemon and throw. Either delay the first poll or use the `state-save` round-trip to wait for the page to be ready.

### `--profile` requires an absolute path

Relative paths are accepted by the CLI but the resulting profile directory is not portable across working directories and may not be picked up by subsequent runs.
```
