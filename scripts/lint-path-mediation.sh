#!/usr/bin/env bash
# scripts/lint-path-mediation.sh
#
# Enforce the path-and-file mediation rule: no file in src/ outside the
# allowed exemptions may import from node:fs, node:path, or node:os.
#
# Allowed exemptions:
#   - src/infrastructure/path-utils.ts (canonical home for paths)
#   - src/infrastructure/io.ts (canonical home for file ops)
#   - src/services/chat-metadata-storage.ts (consumes infrastructure/io.ts; no direct node:fs)
#
# Exit 0 when the rule is satisfied, non-zero with a clear message otherwise.
# This script is called by the CI test.yml workflow as the last step.

set -euo pipefail

FORBIDDEN=$(grep -rn --include='*.ts' "from \"node:" src/ \
  | grep -E "from \"node:(fs|path|os)\"" \
  | grep -v "src/infrastructure/path-utils.ts" \
  | grep -v "src/infrastructure/io.ts" \
  | grep -v "src/services/chat-metadata-storage.ts" \
  || true)

if [ -n "$FORBIDDEN" ]; then
  echo "ERROR: forbidden direct imports of node:fs / node:path / node:os in src/." >&2
  echo "" >&2
  echo "All file-system and path operations must route through:" >&2
  echo "  - src/infrastructure/path-utils.ts (path values)" >&2
  echo "  - src/infrastructure/io.ts (file-system side effects)" >&2
  echo "" >&2
  echo "Offending imports:" >&2
  echo "$FORBIDDEN" >&2
  echo "" >&2
  echo "If you have a legitimate need for a direct import, add the file to" >&2
  echo "the exemption list in this script and the CI workflow with a comment" >&2
  echo "explaining why." >&2
  exit 1
fi

echo "OK: no forbidden node:fs / node:path / node:os imports in src/"
