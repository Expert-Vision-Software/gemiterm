#!/bin/bash
set -e
echo "Running: bunx @playwright/cli install chromium"
output=$(bunx @playwright/cli install chromium 2>&1)
echo "$output"
echo "Browser installation complete."