<div align="center">

# GemiTerm

### Google Gemini in your terminal — list, search, export, continue, and debate from the command line.

[![npm version](https://img.shields.io/npm/v/gemiterm?color=cb3837&label=npm)](https://www.npmjs.com/package/gemiterm)
[![Bun](https://img.shields.io/badge/Runtime-Bun-f9f1e1?logo=bun&logoColor=black)](https://bun.sh)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-22c55e)](LICENSE.md)
[![Platforms](https://img.shields.io/badge/Platforms-Windows%20%7C%20Linux%20%7C%20macOS-6366f1)](#installation)

**List · Search · Export · Continue · Debate · Automate**

[Quick Start](#quick-start) · [Features](#features) · [Cross-Agent Debates](#cross-agent-debates-with-gemini) · [Commands](#commands) · [Configuration](#configuration) · [Contributing](#contributing) · [Acknowledgements](#acknowledgments)

</div>

---

## What is GemiTerm?

[Gemini](https://gemini.google.com) is one of the most capable AI assistants available — and almost all of your best conversations with it live **trapped inside the web UI**, with no public API to reach them. GemiTerm is the bridge.

It's a fast, scriptable command-line client for the **Google Gemini web app**. Authenticate once, then list, search, fetch, export, continue, and delete chats from your shell. Pipe JSON into other tools. Wire it into CI. Or hand it to your AI coding agent and let it argue trade-offs with Gemini in real time.

GemiTerm is built with **[Bun](https://bun.sh)** and TypeScript, ships as a single native binary, and authenticates via Playwright — no Google API key, no rate limits, no quota.

> **TL;DR:** If you've ever wanted to `grep` your Gemini history, bulk-export months of chats, or have your coding agent debate Gemini about architecture before you commit — GemiTerm is for you.

## Why GemiTerm?

- **No public API? No problem.** GemiTerm drives the real Gemini web app via a headless browser. It sees exactly what you see, including your entire history.
- **Cross-agent debates built-in.** Spin up a `debate-with-gemini` skill and your coding agent (Claude Code, OpenCode, GitHub Copilot, …) will argue both sides of a technical decision with real Gemini responses, for N rounds. Catch design flaws before they ship.
- **Scriptable & pipeable.** First-class `text` and `json` output. Works in cron jobs, Makefiles, shell loops, and CI.
- **Searchable archive.** Bulk-export to Markdown or JSON and run `grep`, `rg`, or your favorite search tool over months of AI conversations.
- **Multi-profile, multi-account.** Keep work, personal, and side-project identities separate. One CLI, many Gemini accounts.
- **Single binary, every OS.** Native builds for Windows, Linux, and macOS. No Node, no Python, no runtime to install.
- **Local-first, private.** Cookies never leave your machine. 7-day freshness window. You own your data.

## Features

- 🔍 **List & search** — find any Gemini chat by title, date, or content (`--sort`, `--after`, `--before`, `--search`, `--all`, `--all-profiles`)
- 📥 **Bulk export** — Markdown or JSON, indexed `index.md`, ready for grep and archival
- 💬 **Continue or start** — interactive REPL or one-shot, with `--prompt-file` for long prompts
- 🗑️ **Delete with confirmation** — clean up old chats safely (`--force` to skip)
- 👤 **Multi-profile** — separate identities for work / personal / side-projects, one-click switching
- 🤖 **AI-agent skills** — plug into OpenCode, Claude Code, GitHub Copilot, and any agent that reads skills
- 🗣️ **Cross-agent debates** — your agent argues both sides with Gemini, surfaces real agreements and disagreements
- 📦 **Single binary** — Bun-compiled, no runtime required; works on Windows, Linux, macOS
- 🔐 **Local cookies** — never uploaded; 7-day freshness window

## Cross-Agent Debates with Gemini

The killer feature isn't just CLI access — it's what your **AI coding agent** can do with it.

GemiTerm ships with a companion **skills package** (`opencode-gemiterm-skills`) that teaches any LLM-powered terminal how to use GemiTerm on demand. Two skills are included:

| Skill | What it does |
| --- | --- |
| **`gemiterm`** | Search, list, export, and manage your Gemini chats from inside an agent session. |
| **`debate-with-gemini`** | Run structured multi-turn technical debates with Gemini — perfect for stress-testing architecture decisions, trade-offs, and design choices. |

Install in one command:

```bash
gemiterm install-skills
# or, for any agent that supports the skills CLI
bunx opencode-gemiterm-skills install
```

Then in your agent session, just ask:

> **You:** "Debate Gemini for/against using SQLite as the primary database for a SaaS app. Context: docs/arch.md. 5 turns."

The agent reads your context, seeds a fresh Gemini chat with the opposing view, and runs a 5-round autonomous back-and-forth:

```
Debate complete (5 turns). Gemini argued FOR SQLite (simplicity, zero-config).
I argued AGAINST (concurrency limits, no network access, scaling ceiling).
Key agreements: fine for prototyping, migrate to Postgres before 100+ concurrent users.
```

Other use cases for `debate-with-gemini`:

- **Validate API design** — "Have Gemini argue against this REST contract. 3 turns."
- **Review a refactor** — "Stress-test the migration to event-sourcing with Gemini. 4 turns."
- **Compare libraries** — "Argue both sides of `Zod` vs. `valibot` for this schema. 3 turns."
- **Continue a previous debate** — "Resume chat `c_abc123` for 3 more turns."

The full skill bundle lives at [`opencode-gemiterm-skills`](https://www.npmjs.com/package/opencode-gemiterm-skills).

## Quick Start

### Try without installing

```bash
bunx gemiterm auth          # sign in to Google
bunx gemiterm list          # show your recent chats
```

### Install globally (recommended for daily use)

```bash
bun install -g gemiterm

gemiterm auth
gemiterm list
```

### Install scripts (no Bun required — bootstraps it for you)

**Windows (PowerShell 7+):**

```powershell
irm https://github.com/expert-vision-software/GemiTerm/releases/latest/download/install.ps1 | iex
```

**Linux / macOS:**

```bash
curl -fsSL https://github.com/expert-vision-software/GemiTerm/releases/latest/download/install.sh | bash
```

> **Upgrading from v1.4.1?** Your profiles, cookies, and default profile marker are preserved. See [docs/INSTALL.md](docs/INSTALL.md) for details.

See [docs/INSTALL.md](docs/INSTALL.md) for the full guide, uninstall instructions, troubleshooting, and build-from-source steps.

## Reset / Clean slate

Use the `-Uninstall` (Windows) or `--uninstall` (Linux/macOS) flag to wipe every trace of GemiTerm from a machine — binary, PATH entries, bun/npm global packages, bun cache, Playwright browser cache, and your config directory (profiles + cookies).

**Windows (PowerShell) — one-liner to uninstall then re-install latest:**

```powershell
pwsh -Command "irm https://github.com/expert-vision-software/GemiTerm/releases/latest/download/install.ps1 | iex -Args '-Uninstall'; irm https://github.com/expert-vision-software/GemiTerm/releases/latest/download/install.ps1 | iex"
```

**Linux / macOS — one-liner uninstall:**

```bash
curl -fsSL https://github.com/expert-vision-software/GemiTerm/releases/latest/download/install.sh | bash -s -- --uninstall
```

**What `-Uninstall` removes:**

| What | Windows | Linux / macOS |
| --- | --- | --- |
| Binary | `%LOCALAPPDATA%\GemiTerm\GemiTerm.exe` | `~/.local/bin/gemiterm` |
| User PATH entry | Registry `Path` (User) | Shell rc files (`~/.bashrc`, `~/.zshrc`) |
| bun global package | `bun remove -g gemiterm` | `bun remove -g gemiterm` |
| bun download cache | `~/.bun/install/cache/gemiterm*` | `~/.bun/install/cache/gemiterm*` |
| npm global package | `npm uninstall -g gemiterm` | `npm uninstall -g gemiterm` |
| Playwright browser | `%LOCALAPPDATA\ms-playwright` | `~/.cache/ms-playwright` |
| All profiles & cookies | `%APPDATA\gemiterm\` | `~/gemiterm/` |

**Test a specific pre-release version:**

```powershell
# Windows
pwsh -File install.ps1 -Tag v2.4.0-rc.1
```

```bash
# Linux/macOS
GEMITERM_TAG=v2.4.0-rc.1 bash install.sh
```

## Prerequisites

- **[Bun](https://bun.sh)** runtime ≥ 1.0.0 (only required for `bunx` / `bun install` use — not needed for install scripts)
- **Chromium browser** — GemiTerm prefers your system Chrome / Edge; otherwise it installs Playwright's Chromium automatically (`gemiterm install-browser`)
- **Google Account** with access to [Gemini](https://gemini.google.com)

## Commands

| Command | Alias | Purpose |
| --- | --- | --- |
| `gemiterm auth` | `gemiterm login` | Sign in to Google and save cookies |
| `gemiterm status` | — | Show config dir and profile table |
| `gemiterm list` | — | List chats (filter, sort, search) |
| `gemiterm fetch <id>` | — | Fetch a chat's full history |
| `gemiterm new [message]` | — | Start a new chat (one-shot or REPL) |
| `gemiterm continue <id> [msg]` | — | Continue an existing chat |
| `gemiterm export <id>` | — | Export one chat to Markdown / JSON |
| `gemiterm export-all` | — | Bulk-export all chats with `index.md` |
| `gemiterm delete <id>` | — | Delete a chat (with confirmation) |
| `gemiterm profile <sub>` | — | Manage profiles (list / add / delete / rename / default) |
| `gemiterm install-browser` | — | Install Playwright Chromium |
| `gemiterm install-skills` | — | Install the cross-agent skills bundle |
| `gemiterm -v <cmd>` | — | Verbose logging for any command |

### `gemiterm list`

List, filter, and search your Gemini chats.

```bash
gemiterm list
gemiterm list -n 50 --sort alpha
gemiterm list --search "react server components"
gemiterm list --after 2026-01-01 --before 2026-06-01
gemiterm list --all --all-profiles -f json -p chats.json
```

| Flag | Description |
| --- | --- |
| `-n, --limit N` | Max chats to show (default: 10) |
| `--offset N` | Skip the first N chats |
| `--sort <recent\|oldest\|alpha>` | Sort order |
| `-s, --search <query>` | Filter by title |
| `--after <date>` | Only chats after this date |
| `--before <date>` | Only chats before this date |
| `--all` | Show all chats (no limit) |
| `--all-profiles` | Merge chats from all profiles |
| `-f, --format <text\|json>` | Output format |
| `-o, --out <path>` | Save output to file |

### `gemiterm fetch <conversation_id>`

Fetch a single conversation's full history.

```bash
gemiterm fetch c_abc123
gemiterm fetch c_abc123 -f json -o chat.json
```

| Flag | Description |
| --- | --- |
| `-f, --format <text\|json>` | Output format |
| `-o, --out <path>` | Save output to file |

### `gemiterm new [message]`

Start a new chat. One-shot if you pass a message; otherwise drops into an interactive REPL.

```bash
gemiterm new "Explain the CAP theorem like I'm 12"
gemiterm new --profile work "Draft a status update"
gemiterm new --prompt-file ./long-prompt.md
```

| Flag | Description |
| --- | --- |
| `-p, --profile <name>` | Use a specific profile |
| `-f, --prompt-file <path>` | Read the message from a file (bypasses shell arg-length limits) |
| `-h, --help` | Show help |

### `gemiterm continue <conversation_id> [message]`

Continue an existing chat. With no message, enters an interactive REPL. With no conversation ID, falls back to `list`.

```bash
gemiterm continue c_abc123
gemiterm continue c_abc123 "And what about edge cases?"
gemiterm continue c_abc123 --prompt-file ./refactor-context.md
```

| Flag | Description |
| --- | --- |
| `-f, --prompt-file <path>` | Read the message from a file (bypasses shell arg-length limits) |
| `-h, --help` | Show help |

> **Long prompts?** On Windows the shell argument limit is roughly 2 048 UTF-16 code units. GemiTerm detects oversized messages and **spills them to a temp file automatically** — or you can use `--prompt-file` explicitly to read from a file you control.

### `gemiterm export <conversation_id>`

Export a single chat to a file.

```bash
gemiterm export c_abc123
gemiterm export c_abc123 -o ./chat.md -f json --include-metadata
```

| Flag | Description |
| --- | --- |
| `-o, --out <path>` | Custom output file path |
| `-f, --format <markdown\|json>` | Export format (default: `markdown`) |
| `--include-metadata` | Include full metadata in the export |

### `gemiterm export-all`

Bulk-export every chat (or every chat since a date) with an auto-generated `index.md`.

```bash
gemiterm export-all
gemiterm export-all --since 2026-01-01 --include-metadata
gemiterm export-all -o ./exports -a
```

| Flag | Description |
| --- | --- |
| `-o, --out-dir <dir>` | Output directory (default: `./exports`) |
| `--since <date>` | Only chats newer than this date |
| `--include-metadata` | Include full metadata |
| `-a, --all-profiles` | Export from all profiles |

### `gemiterm delete <conversation_id>`

Delete a chat from your Gemini account. Confirms by default.

```bash
gemiterm delete c_abc123
gemiterm delete c_abc123 --force
```

| Flag | Description |
| --- | --- |
| `-f, --force` | Skip the confirmation prompt |

### `gemiterm profile <subcommand>`

Manage multiple Gemini profiles (separate Google accounts or isolated cookie stores).

```bash
gemiterm profile list
gemiterm profile add work
gemiterm profile delete work
gemiterm profile rename work jobs
gemiterm profile default work
```

### `gemiterm install-browser`

Checks for a system Chrome / Edge first; falls back to Playwright's Chromium. Usually only needed once after install.

### `gemiterm install-skills`

Installs the [`opencode-gemiterm-skills`](https://www.npmjs.com/package/opencode-gemiterm-skills) bundle so your AI agent can use GemiTerm (and the `debate-with-gemini` skill) automatically.

## Configuration

### Configuration directory

| Platform | Config dir | Binary location (install script) |
| --- | --- | --- |
| Windows | `%APPDATA%\gemiterm\` | `%LOCALAPPDATA%\GemiTerm\` |
| Linux / macOS | `~/gemiterm/` | `~/.local/bin/gemiterm` |

Override with:

```bash
export GEMITERM_CONFIG_DIR=/custom/path
```

### Profile storage

```
gemiterm/
  profiles/
    .default              # text file with the default profile name
    <profile-name>/
      storage_state.json  # authenticated cookies
```

Upgrading from v1.4.1 keeps these paths and files unchanged.

### Environment variables

| Variable | Description | Default |
| --- | --- | --- |
| `GEMITERM_CONFIG_DIR` | Override the configuration directory | Platform default |

## Contributing

Architecture, development workflow, build instructions, and contribution guidelines live in **[CONTRIBUTING.md](CONTRIBUTING.md)**. The agent guide — including the path-mediation rules, the sensitive auth files, and the OpenSpec workflow — lives in **[AGENTS.md](AGENTS.md)**.

## Acknowledgments

- [Google Gemini](https://gemini.google.com) — the model and web app this CLI wraps
- [Bun](https://bun.sh) — runtime, bundler, and the path to single-binary distribution
- [`@playwright/cli`](https://www.npmjs.com/package/@playwright/cli) — the headless browser that powers authentication
- [OpenCode](https://opencode.ai) and the broader AI-agent ecosystem — for the `debate-with-gemini` use case that inspired the skills bundle
- [`opencode-gemiterm-skills`](https://www.npmjs.com/package/opencode-gemiterm-skills) — the agent-skills companion package

## License

[MIT](LICENSE.md)
