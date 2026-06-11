# GemiTerm

Access and manage your Gemini web chats from the command line. GemiTerm bridges Playwright-based Google authentication to let you list, fetch, export, continue, and delete conversations trapped in the Gemini web interface — without a standard API. Built with [Bun](https://bun.sh) and TypeScript.

## Prerequisites

- **[Bun](https://bun.sh)** runtime ≥ 1.0.0
- **Chromium Browser** — GemiTerm uses your system Chrome/Edge if available, otherwise installs Playwright's Chromium automatically
- **Google Account** with access to [Gemini](https://gemini.google.com)

## Quick Start (no install)

Use `bunx` to run GemiTerm directly — no install step needed:

```bash
bunx gemiterm auth          # authenticate with Google
bunx gemiterm list          # list your chats
```

## Installation

### Global install (recommended for daily use)

```bash
bun install gemiterm -g
```

Then use from anywhere:

```bash
gemiterm auth
gemiterm list
```

### Install scripts (binary drop)

For systems without Bun — the script auto-bootstraps Bun if needed.

**Windows** (PowerShell 7+):

```powershell
irm https://github.com/expert-vision-software/GemiTerm/releases/latest/download/install.ps1 | iex
```

**Linux / WSL**:

```bash
curl -fsSL https://github.com/expert-vision-software/GemiTerm/releases/latest/download/install.sh | bash
```

See [docs/INSTALL.md](docs/INSTALL.md) for the full guide, uninstall instructions, troubleshooting, and build-from-source steps.

> **Upgrading from v1.4.1?** Your profiles, cookies, and default profile marker are preserved. See the "Upgrade from v1.4.1" section in [docs/INSTALL.md](docs/INSTALL.md) for details.

## Development

```bash
bun install
bun run dev              # run the CLI
bun test                 # run tests (Bun test runner)
bun run typecheck        # TypeScript type checking
bun run build            # compile to standalone Bun binary
bun run build:linux      # cross-compile for Linux x64
bun run build:windows    # cross-compile for Windows x64
```

For installing Chromium, use the platform-specific wrapper scripts:
```bash
bash scripts/install-browser.sh   # Linux/macOS
pwsh scripts/install-browser.ps1 # Windows
```

## Building from source

GemiTerm is built with [Bun](https://bun.sh) 1.3.13 or later.

```bash
bun run build            # native binary (dist/gemiterm or dist/gemiterm.exe)
bun run build:linux      # Linux x64 binary (dist/gemiterm)
bun run build:windows    # Windows x64 binary (dist/gemiterm.exe)
bun run build:release    # minified release binary (dist/gemiterm)
```

Output paths:
- **Linux/macOS**: `dist/gemiterm`
- **Windows**: `dist/gemiterm.exe`

## Release artifacts

The v2.0.0 release ships the following GitHub Release assets:
- `GemiTerm` — Linux x64 binary
- `GemiTerm.exe` — Windows x64 binary
- `install.sh` — POSIX installer script
- `install.ps1` — Windows PowerShell installer script

## Usage

### Authentication

```bash
gemiterm auth
```

Opens a browser window to log in with your Google account. Cookies are saved for future use.

### Check Status

```bash
gemiterm status
```

Shows the config directory and a table of all profiles with their authentication state.

### List Chats

```bash
gemiterm list
```

Options:
- `-n, --limit N`: Maximum number of chats (default: 10)
- `--offset N`: Skip first N chats (default: 0)
- `--sort <recent|oldest|alpha>`: Sort order
- `-s, --search <query>`: Filter by title
- `--after <date>`: Only chats after this date
- `--before <date>`: Only chats before this date
- `--all`: Show all chats (no limit)
- `--all-profiles`: Merge chats from all profiles
- `-f, --format <text|json>`: Output format
- `-p, --path <path>`: Save output to file

### Fetch Chat History

```bash
gemiterm fetch <conversation_id>
```

Options:
- `-f, --format <text|json>`: Output format
- `-p, --path <path>`: Save output to file

### Continue a Chat

```bash
gemiterm continue <conversation_id> [message]
```

Without a message, enters an interactive REPL session. Without a conversation ID, falls back to `list`.

### Start a New Chat

```bash
gemiterm new [message]
```

Options:
- `-p, --profile <name>`: Use a specific profile

Without a message, enters an interactive REPL session.

### Export Chat

```bash
gemiterm export <conversation_id>
```

Options:
- `-o, --output <path>`: Custom output file path
- `-f, --format <markdown|json>`: Export format (default: markdown)
- `--include-metadata`: Include full metadata in export

### Export All Chats

```bash
gemiterm export-all
```

Options:
- `-o, --output-dir <dir>`: Output directory (default: `./exports`)
- `--since <date>`: Only chats newer than this date
- `--include-metadata`: Include full metadata
- `-a, --all-profiles`: Export from all profiles

Creates an `index.md` with links to all exported files.

### Delete a Chat

```bash
gemiterm delete <conversation_id>
```

Options:
- `-f, --force`: Skip confirmation prompt

### Manage Profiles

```bash
gemiterm profile list                    # list all profiles
gemiterm profile add <name>               # add a new profile
gemiterm profile delete <name>            # delete a profile
gemiterm profile rename <name> <newName>  # rename a profile
gemiterm profile default <name>          # set default profile
```

### Install Browser

```bash
gemiterm install-browser
```

Checks for system Chrome/Edge first, falls back to installing Playwright's Chromium.

### Verbose Logging

```bash
gemiterm -v <command>
```

## Skills

GemiTerm has an associated skills repository for AI coding agents (Copilot, Claude, etc.) that provides domain-specific instructions for working with **gemiterm** and automating common workflows. There's also a fun `debate-with-gemini` skill that created an interactive turn-based conversation between your agent and gemini. See [opencode-gemiterm-skills](https://github.com/Expert-Vision-Software/opencode-gemiterm-skills).

## Configuration

### Configuration Directory

Default locations:
- **Binary**: `$env:LOCALAPPDATA\GemiTerm\` (Windows), `~/.local/bin/gemiterm` (Linux/macOS)
- **Config**: `%APPDATA%\gemiterm\` (Windows), `~/gemiterm/` (Linux/macOS)

Override with:
```bash
export GEMITERM_CONFIG_DIR=/custom/path
```

### Profile Storage

```
gemiterm/
  profiles/
    .default              # text file with default profile name
    <profile-name>/
      storage_state.json  # authentication cookies
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GEMITERM_CONFIG_DIR` | Configuration directory | Platform default |

## Architecture

```
src/
  cli/            # CLI commands, argument parsing, output formatting
  core/           # Mediator pattern (CQRS), typed commands/queries, handlers, domain types
  services/       # Business logic: auth flow, cookie management, Gemini API client
  infrastructure/  # Config, file I/O, logging, validation, formatters
tests/
  cli/            # CLI command tests
  core/           # Query handler tests
  services/       # Service layer tests
  infrastructure/  # Infrastructure tests
  fixtures/       # Shared test fixtures
```

Core uses a **Mediator pattern** with typed Command/Query messages dispatching to registered handlers, decoupling CLI commands from business logic.
