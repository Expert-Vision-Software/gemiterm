#!/usr/bin/env bash
# Auth-regression gate check (fix-4, task 3.2)
#
# Fails when a diff touches an auth-sensitive path without also touching
# tests/auth-regression/. Diff base resolution order:
#   1. $GATE_BASE (explicit sha — used by CI)
#   2. merge-base with the upstream branch
#   3. HEAD~1 (local fallback)
#
# Opt-out: SKIP_AUTH_REGRESSION_GATE=1 with a stated reason in the PR body.
# Auth-sensitive paths are declared in AUTH_SENSITIVE_PATHS; known-benign
# paths for the content regex live in scripts/auth-gate-allowlist (one path
# per line, # comments allowed).

set -u

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'

if [ "${SKIP_AUTH_REGRESSION_GATE:-}" = "1" ]; then
  echo -e "${YELLOW}Auth regression gate SKIPPED via SKIP_AUTH_REGRESSION_GATE=1${NC}"
  echo "Opt-outs are audited: state the reason in the PR body / commit message."
  exit 0
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

ALLOWLIST="$(cat scripts/auth-gate-allowlist 2>/dev/null | grep -v '^#' | grep -v '^$' || true)"

BASE_COMMIT="${GATE_BASE:-}"
if [ -z "$BASE_COMMIT" ]; then
  BASE_COMMIT="$(git merge-base '@{u}' HEAD 2>/dev/null || true)"
fi
if [ -z "$BASE_COMMIT" ]; then
  BASE_COMMIT="HEAD~1"
fi

if ! git rev-parse --verify -q "$BASE_COMMIT^{commit}" >/dev/null 2>&1; then
  echo -e "${RED}Auth regression gate: cannot resolve base commit '${BASE_COMMIT}'${NC}"
  echo "Set GATE_BASE=<sha> or run on a branch with an upstream."
  exit 1
fi

PATH_SPECS=()
while IFS= read -r line; do
  case "$line" in
    ""|\#*) continue ;;
  esac
  PATH_SPECS+=("$line")
done < AUTH_SENSITIVE_PATHS

if [ "${#PATH_SPECS[@]}" -eq 0 ]; then
  echo -e "${RED}Auth regression gate: AUTH_SENSITIVE_PATHS is empty — refusing to run${NC}"
  exit 1
fi

CHANGED_AUTH_FILES="$(git diff --name-only "$BASE_COMMIT" HEAD -- "${PATH_SPECS[@]}" 2>/dev/null || true)"
CHANGED_TEST_FILES="$(git diff --name-only "$BASE_COMMIT" HEAD -- 'tests/auth-regression/**' 2>/dev/null || true)"

CONTENT_REGEX='cookie|PSID|storage_state|CookieSession|silentRefresh|rotate'
OTHER_AUTH_CHANGES=""
for f in $(git diff --name-only "$BASE_COMMIT" HEAD 2>/dev/null || true); do
  [ -f "$f" ] || continue
  case "$f" in src/auth/*|tests/*|openspec/*|docs/archive/*|*.md) continue ;; esac
  printf '%s\n' "$ALLOWLIST" | grep -qxF "$f" && continue
  if grep -qEi "$CONTENT_REGEX" "$f" 2>/dev/null; then
    OTHER_AUTH_CHANGES="$OTHER_AUTH_CHANGES$f\n"
  fi
done

if [ -z "$CHANGED_AUTH_FILES" ] && [ -z "$OTHER_AUTH_CHANGES" ]; then
  echo -e "${GREEN}Auth regression gate: PASS${NC} (no auth-sensitive changes)"
  exit 0
fi

if [ -n "$CHANGED_TEST_FILES" ]; then
  echo -e "${GREEN}Auth regression gate: PASS${NC}"
  echo "Auth-sensitive changes covered by tests/auth-regression/ updates."
  exit 0
fi

echo -e "${RED}Auth regression gate: FAIL${NC}"
echo "Auth-sensitive paths changed without any tests/auth-regression/ change:"
[ -n "$CHANGED_AUTH_FILES" ] && printf '  - %s\n' $CHANGED_AUTH_FILES
[ -n "$OTHER_AUTH_CHANGES" ] && printf '  - %s (content match)' "$(printf "$OTHER_AUTH_CHANGES" | sed '/^$/d' | tr '\n' ' ')"
echo ""
echo "Fix: add/update tests under tests/auth-regression/ in the same change."
echo "Opt-out: SKIP_AUTH_REGRESSION_GATE=1 with a stated reason (audited)."
echo "Path list: AUTH_SENSITIVE_PATHS; allowlist: scripts/auth-gate-allowlist."
exit 1