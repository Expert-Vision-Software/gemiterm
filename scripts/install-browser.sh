#!/bin/bash
set -e
echo "Running: bunx @playwright/cli install-browser chrome-for-testing"
output=$(bunx @playwright/cli install-browser chrome-for-testing 2>&1)
echo "$output"
echo "Browser installation complete."