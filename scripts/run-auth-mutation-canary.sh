#!/usr/bin/env bash
# Auth mutation canary (fix-4, task 4.2)
#
# Verifies the auth-regression suite actually bites: applies each historical
# bug shape from tests/auth-regression/mutations/*.patch, runs the suite, and
# asserts it goes RED every time. A patch that no longer applies (production
# code moved) is gate rot: the canary fails LOUDLY rather than skipping.
#
# Requires a clean worktree (mutations are applied and reverted in place).

set -u

RED='\033[0;31m'; GREEN='\033[0;32m'; NC='\033[0m'

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

MUTATIONS_DIR="tests/auth-regression/mutations"
PATCHES="$(ls "$MUTATIONS_DIR"/*.patch 2>/dev/null || true)"

if [ -z "$PATCHES" ]; then
  echo -e "${RED}canary: no mutation patches found in ${MUTATIONS_DIR}${NC}"
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo -e "${RED}canary: worktree is not clean — refusing to mutate${NC}"
  git status --short
  exit 1
fi

CURRENT_PATCH=""
revert_current() {
  if [ -n "$CURRENT_PATCH" ]; then
    git apply -R "$CURRENT_PATCH" >/dev/null 2>&1 || true
    CURRENT_PATCH=""
  fi
}
trap revert_current EXIT INT TERM

failures=0
for patch in $PATCHES; do
  echo "=== mutation: $patch"

  if ! git apply --check "$patch" 2>/dev/null; then
    echo -e "${RED}  ROT: patch no longer applies (production code moved)${NC}"
    echo "  Update the mutation deliberately and re-review — see design.md D4."
    failures=$((failures + 1))
    continue
  fi

  CURRENT_PATCH="$patch"
  git apply "$patch" || { echo -e "${RED}  failed to apply${NC}"; failures=$((failures + 1)); continue; }

  if bun test tests/auth-regression >/dev/null 2>&1; then
    echo -e "${RED}  SURVIVED: suite stayed GREEN under the mutation${NC}"
    failures=$((failures + 1))
  else
    echo -e "${GREEN}  detected: suite RED as expected${NC}"
  fi

  revert_current
done

if [ "$failures" -gt 0 ]; then
  echo -e "${RED}canary: FAIL — ${failures} mutation(s) survived or rotted${NC}"
  exit 1
fi

echo -e "${GREEN}canary: PASS — every mutation detected${NC}"
exit 0