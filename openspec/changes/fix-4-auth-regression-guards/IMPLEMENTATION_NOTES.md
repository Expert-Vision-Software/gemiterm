# Fix-4: Auth Regression Guards

This change implements a comprehensive auth regression guard system to prevent the recurrence of historical authentication bugs that plagued the project during the "phantom-auth saga."

## Test Suite Structure

- `tests/auth-regression/fixtures.ts` - Cookie jar builders for different session shapes
- `tests/auth-regression/invariant-*.test.ts` - Tests for each historical bug class invariant
- `scripts/check-auth-gate.{sh,ps1}` - Auth-sensitive change detection scripts

## Auth-Sensitive Paths

The following paths are protected by the auth-regression gate:

- All files under `src/auth/**`
- `src/infrastructure/storage.ts`
- `src/infrastructure/io.ts` 
- `src/services/playwright-cli-driver.ts`
- `src/services/gemini-client-wrapper.ts`
- `src/services/profile-lifecycle.ts`
- Files matching content regex: `cookie|PSID|storage_state|CookieSession|silentRefresh|rotate`

## Running the Gate Locally

```bash
# Bash/Unix
bun run check:auth-gate

# PowerShell
.\scripts\check-auth-gate.ps1

# With opt-out (requires documented reason)
SKIP_AUTH_REGRESSION_GATE=1 bun run check:auth-gate
$env:SKIP_AUTH_REGRESSION_GATE=1; .\scripts\check-auth-gate.ps1
```

## Invariant Tests Covered

1. **Full-jar capture integrity** - Ensures all offered cookies are persisted without name filtering
2. **PSIDTS rotation propagation** - Validates rotation through all persist paths
3. **Signed-out capture safety** - Prevents writes for anonymous cookies
4. **CAS semantics** - Prevents stale in-memory jars from clobbering fresher disk state
5. **Validator contract** - Tier-1 raises on missing/invalid cookies, tier-2 warns on missing companions
6. **Classifier truth table** - Deterministic live/phantom/dead classification
7. **Probe purity** - Read-only probes don't write or trigger rotation

## Bug Fixes

Fixed `src/infrastructure/io.ts` where `writeFileExclusive` was missing `ensureDir` call, causing ENOENT errors when creating lock files in non-existent directories.