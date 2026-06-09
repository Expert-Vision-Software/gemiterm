#!/usr/bin/env bash
# GemiTerm v2.0.0 installer for Linux/WSL
#
# Usage:
#   curl -fsSL https://github.com/expert-vision-software/GemiTerm/releases/latest/download/install.sh | bash
#   GEMITERM_TAG=v2.0.0-rc.1 bash install.sh
#   GEMITERM_INSTALL_DIR=~/.local/bin bash install.sh
#   bash install.sh --uninstall
#
# v1.4.1 → v2.0.0 upgrades replace the binary in place; the config dir at
# ~/gemiterm/ (POSIX) is NEVER deleted by this installer.

set -euo pipefail

REPO="expert-vision-software/GemiTerm"
INSTALL_DIR="${GEMITERM_INSTALL_DIR:-$HOME/.local/bin}"
BIN_PATH="$INSTALL_DIR/gemiterm"
CONFIG_DIR="$HOME/gemiterm"
ENV_SNIPPET="$CONFIG_DIR/env.sh"
TAG="${GEMITERM_TAG:-latest}"

remove_source_line() {
    local rc_file="$1"
    if [[ -f "$rc_file" ]]; then
        local tmp
        tmp=$(mktemp)
        grep -v 'gemiterm/env.sh' "$rc_file" > "$tmp" || true
        mv "$tmp" "$rc_file"
    fi
}

# --- Detect Python v1.4.1 (task 8.2) ---
if command -v pip >/dev/null 2>&1 && pip show gemiterm >/dev/null 2>&1; then
    echo "WARNING: Python v1.4.1 detected. Your config data at ~/gemiterm/ is safe and will be preserved. Please run 'pip uninstall gemiterm' before re-running this installer to complete the v2.0.0 installation."
    exit 1
fi

# --- Uninstall (task 3.3) ---
if [[ "${1:-}" = "--uninstall" ]]; then
    echo "Removing GemiTerm..."
    rm -f "$BIN_PATH"
    rm -f "$ENV_SNIPPET"
    remove_source_line "$HOME/.bashrc"
    if [[ -f "$HOME/.zshrc" ]]; then
        remove_source_line "$HOME/.zshrc"
    fi
    echo "GemiTerm uninstalled successfully."
    exit 0
fi

# --- Upgrade detection (task 3.4) ---
if [[ -x "$BIN_PATH" ]]; then
    echo "Detected existing install at $BIN_PATH; upgrading in place."
fi

# --- v1.4.1 → v2.0.0 config migration (task 11.1) ---
# v1.4.1 wrote config to $HOME/.config/gemiterm/ on POSIX. v2.0.0 reads from
# $HOME/gemiterm/. If the old path exists and the new one does not, copy the
# tree forward. The v1.4.1 directory is left in place as a safety net.
V14_CONFIG_DIR="$HOME/.config/gemiterm"
if [[ -d "$V14_CONFIG_DIR" && ! -d "$CONFIG_DIR" ]]; then
    echo "Detected v1.4.1 config at $V14_CONFIG_DIR; migrating to $CONFIG_DIR"
    mkdir -p "$CONFIG_DIR"
    cp -R "$V14_CONFIG_DIR/." "$CONFIG_DIR/"
    echo "v1.4.1 config copied to $CONFIG_DIR. The original at $V14_CONFIG_DIR is left in place as a backup."
fi

# Determine package-manager executable (prefer bunx over npx)
if command -v bun >/dev/null 2>&1; then
    PACKAGE_MANAGER_X="bunx"
elif command -v npm >/dev/null 2>&1; then
    PACKAGE_MANAGER_X="npx"
else
    PACKAGE_MANAGER_X="bunx"   # will be bootstrapped below
fi

# --- Package-manager prompt (task 11.2) ---
# If bun or npm is on PATH, recommend installing via the package manager
# (npm: `npm i -g gemiterm`; bun: `bun i -g gemiterm`) instead of this
# binary drop. The prompt is skipped when stdin is not a TTY (e.g. the
# `curl | bash` one-liner flow runs unattended and must not block).
if { command -v bun >/dev/null 2>&1 || command -v npm >/dev/null 2>&1; } && [[ -t 0 ]]; then
    echo ""
    echo "It is recommended to install via bun or npm package manager."
    echo "Are you sure you want to continue with binary install? [y/N]"
    read -r REPLY
    case "$REPLY" in
        [yY]|[yY][eE][sS]) ;;
        *)
            echo "Aborted. Install via: $(command -v bun >/dev/null 2>&1 && echo 'bun i -g gemiterm' || echo 'npm i -g gemiterm')"
            exit 0
            ;;
    esac
fi

# --- Resolve release (task 3.5) ---
API_URL="https://api.github.com/repos/$REPO/releases/latest"
if [[ "$TAG" != "latest" ]]; then
    API_URL="https://api.github.com/repos/$REPO/releases/tags/$TAG"
fi

# --- Network check (task 3.11) ---
if ! curl -fsSI -o /dev/null "$API_URL" 2>/dev/null; then
    echo "Cannot reach GitHub releases. Check your network connection or use the 'build from source' instructions in docs/INSTALL.md."
    exit 1
fi

RELEASE_JSON=$(curl -fsSL "$API_URL")

ASSET_URL=$(echo "$RELEASE_JSON" | grep -oE '"browser_download_url":"[^"]*"' \
    | sed 's/"browser_download_url":"//;s/"$//' \
    | grep -E '/GemiTerm$' \
    | head -n 1)

if [[ -z "$ASSET_URL" ]]; then
    echo "No GemiTerm binary asset found in release."
    echo "Build from source:"
    echo "  git clone https://github.com/$REPO.git && cd GemiTerm && bun install && bun run build"
    exit 1
fi

VERSION=$(echo "$RELEASE_JSON" | grep -oE '"tag_name":"[^"]*"' | head -n 1 | sed 's/"tag_name":"//;s/"$//')

# --- Download (task 3.6) ---
mkdir -p "$INSTALL_DIR"

if ! curl -fSL -o "$BIN_PATH.new" "$ASSET_URL"; then
    rm -f "$BIN_PATH.new"
    echo "Download failed."
    exit 1
fi

mv "$BIN_PATH.new" "$BIN_PATH"
chmod +x "$BIN_PATH"

# --- Bootstrap package manager if needed (task 9.2 + 9.3) ---
if [[ "$PACKAGE_MANAGER_X" = "bunx" ]] && ! command -v bun >/dev/null 2>&1; then
    echo "Installing Bun..."
    if ! curl -fsSL https://bun.sh/install | bash; then
        if command -v npm >/dev/null 2>&1; then
            echo "Bun installation failed, falling back to npx."
            PACKAGE_MANAGER_X="npx"
        else
            echo "Bun installation failed and npm is not available. Install Bun from https://bun.sh or npm from https://nodejs.org and re-run this installer."
            exit 1
        fi
    fi
    if [[ "$PACKAGE_MANAGER_X" = "bunx" ]]; then
        export PATH="$HOME/.bun/bin:$PATH"
        if ! command -v bun >/dev/null 2>&1; then
            if command -v npm >/dev/null 2>&1; then
                echo "Bun installation failed, falling back to npx."
                PACKAGE_MANAGER_X="npx"
            else
                echo "Bun installation failed. Install Bun manually from https://bun.sh and re-run this installer."
                exit 1
            fi
        fi
    fi
fi

# --- Install Chromium (task 3.7) ---
echo "Installing Chromium browser for Playwright..."
if ! $PACKAGE_MANAGER_X @playwright/cli install chromium; then
    echo "Chromium installation failed. Re-run the installer after fixing the issue, or run '${PACKAGE_MANAGER_X} @playwright/cli install chromium' manually."
    exit 1
fi

# --- Verify Chromium (task 3.8) ---
CHROME_PATH=$(find "$HOME/.cache/ms-playwright" -path '*/chromium-*/chrome-linux/chrome' -type f -executable 2>/dev/null | head -n 1)
if [[ -z "$CHROME_PATH" ]]; then
    CHROME_PATH=$(find "$HOME/.cache/ms-playwright" -path '*/chromium-*' -name chrome -type f -executable 2>/dev/null | head -n 1)
fi

if [[ -n "$CHROME_PATH" ]]; then
    echo "Chromium verified at $CHROME_PATH"
else
    echo "Chromium installation verification failed. Re-run the installer after fixing the network, or run '${PACKAGE_MANAGER_X} @playwright/cli install chromium' manually."
    exit 1
fi

# --- PATH augmentation (task 3.9) ---
mkdir -p "$CONFIG_DIR"
cat > "$ENV_SNIPPET" <<'ENVEOF'
export PATH="$HOME/.local/bin:$PATH"
ENVEOF

SOURCE_LINE='[[ -f "$HOME/gemiterm/env.sh" ]] && source "$HOME/gemiterm/env.sh"'

if [[ -f "$HOME/.bashrc" ]] && ! grep -qiF 'gemiterm/env.sh' "$HOME/.bashrc"; then
    echo "$SOURCE_LINE" >> "$HOME/.bashrc"
fi

if [[ -f "$HOME/.zshrc" ]] && ! grep -qiF 'gemiterm/env.sh' "$HOME/.zshrc"; then
    echo "$SOURCE_LINE" >> "$HOME/.zshrc"
fi

export PATH="$INSTALL_DIR:$PATH"

# --- Success (task 3.10) ---
echo "GemiTerm ${VERSION:-unknown} installed to $BIN_PATH. Run 'gemiterm status' to verify, then 'gemiterm auth' to authenticate. Restart your shell (or 'source ~/gemiterm/env.sh') to pick up the new PATH."
