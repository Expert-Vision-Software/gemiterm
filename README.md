# GemiTerm

Access and manage your Gemini web chats from the command line. GemiTerm bridges Playwright-based Google authentication to let you list, fetch, export, and continue conversations trapped in the Gemini web interface — without a standard API.

## Installation

### Windows (standalone - no Python required)

Open PowerShell and run:

```powershell
irm https://raw.githubusercontent.com/expert-vision-software/GemiTerm/main/install.ps1 | iex
```

This downloads the latest `GemiTerm.exe`, installs Chromium browser, and adds GemiTerm to your PATH.

**Uninstall:**
```powershell
irm https://raw.githubusercontent.com/expert-vision-software/GemiTerm/main/install.ps1 | iex -- -uninstall
```

### Linux

Download the `GemiTerm` binary from the [latest release](https://github.com/expert-vision-software/GemiTerm/releases/latest).

```bash
chmod +x GemiTerm
./GemiTerm install-browser  # install Chromium if needed
```

### pip/pipx (requires Python)

```bash
pip install gemiterm       # global install
pipx install gemiterm      # global install (isolated)
pipx run gemiterm auth     # temporary run (npx equivalent)
```

### From Source

```bash
pip install -e .
playwright install chromium
```

## Prerequisites

- **Chromium Browser**: GemiTerm will attempt to use your system Chrome if available, otherwise it installs Playwright's Chromium automatically.
- **Google Account**: A Google account with access to Gemini (https://gemini.google.com)

## Usage

### Authentication

Before using the CLI, you need to authenticate with your Google account:

```bash
gemiterm auth
```

This will open a browser window for you to log in with your Google account. Cookies will be saved for future use.

### Check Status

Verify your authentication status:

```bash
gemiterm status
```

### List Chats

Display all your Gemini chats in a table:

```bash
gemiterm list
```

Options:
- `-n, --limit N`: Maximum number of chats to display (default: 10, max: 50)

### Fetch Chat History

Fetch and display the message history of a specific conversation:

```bash
gemiterm fetch <conversation_id>
```

Options:
- `--format, -f`: Output format - `text` (default) or `json`

### Continue a Chat

Send a message to an existing conversation:

```bash
gemiterm continue <conversation_id> <message>
```

### Start a New Chat

Start a new conversation:

```bash
gemiterm new [message]
```

Options:
- `-p, --profile TEXT`: Profile to use for the new conversation

With a message argument, creates a conversation, sends the message, prints the response, and returns the new conversation ID. Without a message argument, creates a conversation and starts an interactive chat session.

### Export Chat

Export a conversation to a Markdown file:

```bash
gemiterm export <conversation_id>
```

Options:
- `-o, --output PATH`: Custom output file path
- `-f, --format FORMAT`: Export format - `markdown` (default) or `json`
- `--include-metadata`: Include full metadata in export

### Export All Chats

Export all conversations to a directory with an index file:

```bash
gemiterm export-all
```

Options:
- `-o, --output-dir PATH`: Directory to export to (default: `./exports`)
- `--since ISO_DATE`: Export only conversations newer than this date
- `--include-metadata`: Include full metadata in each export

### Verbose Logging

Enable detailed logging for debugging:

```bash
gemiterm -v <command>
```

## Configuration

### Configuration Directory

Default location: `~/.config/gemiterm/`

Override with environment variable:
```bash
export GEMITERM_CONFIG_DIR=/custom/path
```

### Storage File

The storage file (`storage_state.json`) contains your authentication cookies. It is located in the configuration directory.

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GEMITERM_CONFIG_DIR` | Configuration directory | `~/.config/gemiterm/` |
| `GEMITERM_VERBOSE` | Enable verbose logging | `false` |

## Troubleshooting

### Browser Automation Issues

If browser automation fails or is unavailable, you can manually extract cookies from your browser:

1. Install the "EditThisCookie" extension or similar in your browser
2. Go to https://gemini.google.com and log in
3. Export the cookies in JSON format
4. Save them to `~/.config/gemiterm/storage_state.json` with the following format:
   ```json
   {
     "cookies": [
       {"name": "__Secure-1PSID", "value": "your_value_here", ...},
       {"name": "__Secure-1PSIDTS", "value": "your_value_here", ...}
     ]
   }
   ```

### Session Expired

If you see "Session expired" errors:

1. Run `gemiterm auth` to re-authenticate
2. If the issue persists, delete `storage_state.json` and run `gemiterm auth` again

### API Errors

If you encounter API errors:

1. Run `gemiterm status` to check your authentication state
2. Ensure you have a valid Google account with Gemini access
3. Try re-authenticating with `gemiterm auth`

### Verbose Logging

Use the `-v` or `--verbose` flag to enable detailed logging for debugging:

```bash
gemiterm -v list
```

## Future Enhancements

- Interactive CLI mode with menu-driven navigation
- REPL mode for conversational interaction
- Support for conversation creation and deletion
- Export to multiple formats (HTML, PDF)