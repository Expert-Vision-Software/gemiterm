#!/bin/bash
# Usage Examples for gemiterm
# This script demonstrates common workflows and commands

set -e

echo "========================================"
echo "gemiterm Usage Examples"
echo "========================================"

#------------------------------------------
# SECTION 1: First-Time Setup
#------------------------------------------
section1() {
    echo ""
    echo "=== Section 1: First-Time Setup ==="
    echo ""

    # Install the CLI
    echo "1. Install gemiterm:"
    echo "   pip install -e ."
    echo ""

    # Install browser dependencies
    echo "2. Install Chromium for Playwright:"
    echo "   playwright install chromium"
    echo ""

    # Authenticate
    echo "3. Authenticate with Google:"
    echo "   gemiterm auth"
    echo "   # Opens browser window for login"
    echo ""

    # Verify authentication
    echo "4. Verify authentication status:"
    echo "   gemiterm status"
    echo "   # Shows: Authenticated: True"
    echo ""
}

#------------------------------------------
# SECTION 2: Daily Usage Workflows
#------------------------------------------
section2() {
    echo ""
    echo "=== Section 2: Daily Usage ==="
    echo ""

    # Check status
    echo "1. Check authentication status:"
    echo "   gemiterm status"
    echo ""

    # List recent chats
    echo "2. List your recent chats:"
    echo "   gemiterm list"
    echo "   # Shows table of conversations"
    echo ""

    # List with limit
    echo "3. List specific number of chats:"
    echo "   gemiterm list -n 5"
    echo "   # Shows 5 most recent chats"
    echo ""

    # Fetch a specific chat
    echo "4. View a conversation's history:"
    echo "   gemiterm fetch <conversation_id>"
    echo "   # Example:"
    echo "   gemiterm fetch abc123xyz"
    echo ""

    # Continue a conversation
    echo "5. Send a message to existing chat:"
    echo "   gemiterm continue <conversation_id> <message>"
    echo "   # Example:"
    echo "   gemiterm continue abc123xyz \"Continue my previous thought\""
    echo ""
}

#------------------------------------------
# SECTION 3: Export for Backup
#------------------------------------------
section3() {
    echo ""
    echo "=== Section 3: Export for Backup ==="
    echo ""

    # Export single chat
    echo "1. Export a single conversation to Markdown:"
    echo "   gemiterm export <conversation_id>"
    echo "   # Creates: gemini-chat-{id}-{date}.md"
    echo ""

    # Export with custom output
    echo "2. Export with custom output path:"
    echo "   gemiterm export <conversation_id> -o my-chat.md"
    echo ""

    # Export as JSON
    echo "3. Export as JSON format:"
    echo "   gemiterm export <conversation_id> -f json"
    echo ""

    # Export with metadata
    echo "4. Export with full metadata:"
    echo "   gemiterm export <conversation_id> --include-metadata"
    echo ""

    # Batch export all
    echo "5. Export all conversations:"
    echo "   gemiterm export-all"
    echo "   # Creates ./exports/ with all chats"
    echo ""

    # Export to specific directory
    echo "6. Export to custom directory:"
    echo "   gemiterm export-all -o ./my-backups/"
    echo ""

    # Export recent only
    echo "7. Export only recent conversations:"
    echo "   gemiterm export-all --since 2026-03-01"
    echo ""
}

#------------------------------------------
# SECTION 4: Error Scenarios
#------------------------------------------
section4() {
    echo ""
    echo "=== Section 4: Error Handling ==="
    echo ""

    # Not authenticated
    echo "1. If not authenticated:"
    echo "   $ gemiterm list"
    echo "   Error: Not authenticated. Run 'gemiterm auth' first."
    echo "   $ gemiterm auth"
    echo ""

    # Session expired
    echo "2. If session expired:"
    echo "   $ gemiterm status"
    echo "   Error: Session expired. Please re-authenticate."
    echo "   $ gemiterm auth"
    echo ""

    # Conversation not found
    echo "3. If conversation doesn't exist:"
    echo "   $ gemiterm fetch nonexistent-id"
    echo "   Error: Conversation 'nonexistent-id' not found."
    echo "   Run 'gemiterm list' to see available conversations."
    echo ""

    # Verbose debugging
    echo "4. Debug with verbose output:"
    echo "   gemiterm -v status"
    echo "   # Shows detailed logs"
    echo ""
}

#------------------------------------------
# SECTION 5: Configuration
#------------------------------------------
section5() {
    echo ""
    echo "=== Section 5: Configuration ==="
    echo ""

    # Custom config directory
    echo "1. Use custom config directory:"
    echo "   export GEMITERM_CONFIG_DIR=/path/to/config"
    echo "   gemiterm auth"
    echo ""

    # Verbose mode
    echo "2. Enable verbose logging:"
    echo "   export GEMITERM_VERBOSE=true"
    echo "   gemiterm list"
    echo ""

    # View config location
    echo "3. Default config location:"
    echo "   ~/gemiterm/"
    echo "   Contains:"
    echo "   - storage_state.json (cookies)"
    echo "   - config (future use)"
    echo ""
}

#------------------------------------------
# SECTION 6: Demo Script
#------------------------------------------
section6() {
    echo ""
    echo "=== Section 6: Using the Demo Script ==="
    echo ""

    echo "Run the demo script to see a complete workflow:"
    echo "   python scripts/demo.py"
    echo ""
    echo "Demo script:"
    echo "1. Loads cookies"
    echo "2. Fetches chat list"
    echo "3. Shows 5 most recent chats"
    echo "4. Appends message to most recent chat"
    echo ""
}

# Run all sections
section1
section2
section3
section4
section5
section6

echo "========================================"
echo "For more help: gemiterm --help"
echo "========================================"