#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMPARE_SCRIPT="$PROJECT_ROOT/tests/parity/compare-outputs.ts"
REPORT_DIR="${REPORT_DIR:-$SCRIPT_DIR/../../reports/parity}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
PYTHON_CLI="${GEMITERM_PYTHON_CLI:-gemiterm}"

if ! command -v bun &>/dev/null; then
  echo "ERROR: bun is not installed or not on PATH"
  exit 1
fi

COMMANDS=(
  "--help"
  "--version"
  "auth --help"
  "status --help"
  "list --help"
  "fetch --help"
  "continue --help"
  "new --help"
  "delete --help"
  "export --help"
  "export-all --help"
  "profile --help"
  "status"
  "list"
  "list --limit 5"
  "list --format json"
  "auth"
)

if [[ $# -gt 0 ]]; then
  COMMANDS=("$@")
fi

echo "=== GemiTerm Parity Test Suite ==="
echo "Python CLI : $PYTHON_CLI"
echo "Bun CLI    : bun run $COMPARE_SCRIPT"
echo "Commands   : ${#COMMANDS[@]}"
echo ""

mkdir -p "$REPORT_DIR"

COMMA_SEPARATED=$(IFS=,; echo "${COMMANDS[*]}")
REPORT_FILE="$REPORT_DIR/parity-$TIMESTAMP.txt"

echo "Running parity comparison..."
if GEMITERM_PYTHON_CLI="$PYTHON_CLI" bun "$COMPARE_SCRIPT" --commands "$COMMA_SEPARATED" | tee "$REPORT_FILE"; then
  echo ""
  echo "Parity report saved to: $REPORT_FILE"
  exit 0
else
  echo ""
  echo "Parity report saved to: $REPORT_FILE"
  echo "Some tests FAILED. Review the report above."
  exit 1
fi
