# GemiTerm

Access and manage your Gemini web chats from the command line. GemiTerm bridges Playwright-based Google authentication to let you list, fetch, export, continue, and delete conversations trapped in the Gemini web interface — without a standard API. Built with [Bun](https://bun.sh) and TypeScript.

## Prerequisites

- **[Bun](https://bun.sh)** runtime
- **Chromium Browser** — GemiTerm uses your system Chrome/Edge if available, otherwise installs Playwright's Chromium automatically
- **Google Account** with access to [Gemini](https://gemini.google.com)

## Quick Start

```bash
bun install
bun run src/cli/index.ts auth        # authenticate with Google
bun run src/cli/index.ts list        # list your chats
```

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

## Configuration

### Configuration Directory

Default locations:
- **Windows**: `%APPDATA%\gemiterm\`
- **Linux/macOS**: `~/.config/gemiterm/`

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
