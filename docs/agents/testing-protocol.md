<critical_rules priority="highest">
<pass_criteria>All tests pass (0 failures), no build errors, no lint errors, typecheck clean, lint:mediation clean, check:auth-gate passes (hard gates)</pass_criteria>
<baseline_update>Update `@testing-baseline.xml` **ONLY** on PASS + threshold exceeded</baseline_update>
<no_real_apis>**NEVER** call real external APIs in tests</no_real_apis>
<domain_isolation>Tests run hermetically via `tests/helpers` per-test config dirs; no real Gemini/Google network calls</domain_isolation>
<stop_on_failure>STOP immediately on test failure → REPORT → PLAN → APPROVAL → FIX</stop_on_failure>
</critical_rules>

<metadata>
<updated>2026-09-14</updated>
<baseline>@testing-baseline.xml</baseline>
</metadata>

<context_hierarchy>
<system_context>Test baselining and quality gates</system_context>
<domain_context>GemiTerm — Bun + TypeScript CLI for the Gemini web app (Playwright-driven auth)</domain_context>
<task_context>Write/modify tests, execute test runs, update baselines</task_context>
<execution_context>Commands, thresholds, architecture compliance</execution_context>
</context_hierarchy>

<role>
<identity>Test Execution Agent</identity>
<capabilities>Run tests, collect coverage (bun builtin), validate against thresholds</capabilities>
<scope>Unit, integration, smoke test tiers; linux + windows compiled-binary builds; typecheck + mediation lint + auth gate</scope>
<constraints>No real API calls, hermetic tests, baseline thresholds</constraints>
</role>

<execution_workflow>
<stage name="Build">
```bash
bun run build:linux     # -> dist/gemiterm (bun-linux-x64)
bun run build:windows   # -> dist/gemiterm.exe (bun-windows-x64)
```
Record `BuildTime` per profile (elapsed of each command).

**Mandatory build-artifact capture** (every eval, no exceptions):
- `OutputDirectory`: `dist/` (shared by both profiles; capture after BOTH builds)
- `FileCount` (whole dist/, excluding nothing — the two binaries are the entire dir)
- `TotalSizeMB` (uncompressed sum)
- Per-critical-file fingerprints — BOTH platform binaries (protocol decision 6: baseline captures both platforms):
  - `dist/gemiterm` (linux) — raw `SizeKB` + gzipped `SizeGzippedKB`
  - `dist/gemiterm.exe` (windows) — raw `SizeKB` + gzipped `SizeGzippedKB`
- `LintWarnings` count, grouped by family: `mediation-violations: 0`, `typecheck: 0` — these are hard gates, so any nonzero count is a FAIL, not a warning
</stage>

<stage name="Test_Unit">
```bash
bun test tests/unit --coverage
```
Parse pass/fail counts and line coverage from bun's builtin coverage output.
</stage>

<stage name="Test_Integration">
```bash
bun test tests/integration --coverage
```
Hermetic; no network. `tests/auth-regression/` invariants are exercised by the full suite (`bun test --isolate`); run it instead of the tier commands when auth-sensitive paths changed.
</stage>

<stage name="Test_Smoke">
```bash
bun test tests/smoke --coverage
```
Exercises the compiled CLI binary — requires the Build stage first (dist/ present).
</stage>

<stage name="Gates">
```bash
bun run typecheck         # tsc --noEmit (src/ only)
bun run lint:mediation    # bash form, via Git Bash on Windows
bun run check:auth-gate   # bash form
```
ALL must pass. Zero tolerance — these are FAIL conditions, not warnings.
</stage>

<stage name="Evaluate">
**PASS:** All tests pass, no build errors, no lint errors, typecheck clean, all gates pass
**FAIL:** Any test failure, build error, lint error, or gate failure → STOP
</stage>

<stage name="Baseline">
If PASS + threshold exceeded → update `@testing-baseline.xml` (increment `BL-NNN`, append changelog, refresh artifact blocks for BOTH platforms)
**Do NOT modify this protocol file with results**
</stage>
</execution_workflow>

<test_strategies>
| Tier | Framework | Scope | Mocks |
|------|-----------|-------|-------|
| unit | `bun test` | Commands, services, auth store/validator/classifier, infrastructure | Collaborators mocked/stubbed |
| integration | `bun test` | Command handlers with real (temp-dir) storage, auth-regression invariants | Network mocked; filesystem real via per-test config dirs |
| smoke | `bun test` | Compiled binary (`dist/gemiterm`) invocation (`--help`, `--version`, basic commands) | Full stack, hermetic config dir |

**Critical:** No test ever hits gemini.google.com or any real external service.
</test_strategies>

<pass_fail_criteria>
<all_pass>
- Test pass rate: 100% (any single failure = FAIL)
- Build: no errors (both linux + windows profiles)
- Gates: typecheck, lint:mediation, check:auth-gate all exit 0
</all_pass>

<all_fail>
- Any test failure in any tier
- Any build error for either target
- Any gate failure
- Coverage dropping below the threshold delta below (investigate, not auto-fail)
</all_fail>
</pass_fail_criteria>

<baseline_thresholds>
| Metric | Threshold | Direction |
|--------|-----------|-----------|
| Test count | > 10% change | Any |
| Pass rate | > 1% change | Any |
| Build time | > 10% increase | Up only |
| Coverage | > 5% change | Any |
| Test duration | > 20% increase | Up only |
| Artifact size | > 10% change | Any (compared per critical file: dist/gemiterm AND dist/gemiterm.exe) |

<decision_matrix>
| Current | New | Result | Update? |
|---------|-----|--------|---------|
| PASS | PASS | PASS | Yes, if threshold met |
| PASS | FAIL | FAIL | No |
| FAIL | PASS | PASS | Yes (recovery) |
| FAIL | FAIL | FAIL | No |
</decision_matrix>
</baseline_thresholds>

<architecture_compliance>
- `src/` path/file mediation: only `path-utils.ts`, `io.ts`, `chat-metadata-storage.ts` may import `node:fs`/`node:path`/`node:os` (enforced by lint:mediation gate)
- Auth: only `src/auth/cookie-session.ts` is the auth surface; auth-sensitive diffs must touch `tests/auth-regression/` (enforced by check:auth-gate)
- No cookie-name filtering anywhere
- Prompt facade: only `src/cli/utils/prompts.ts` imports `@inquirer/*`
</architecture_compliance>

<quick_commands>
| Command | Purpose |
|---------|---------|
| `bun run build:linux && bun run build:windows` | Build both binaries |
| `bun test tests/unit --coverage` | Unit tier |
| `bun test tests/integration --coverage` | Integration tier (incl. auth-regression) |
| `bun test tests/smoke --coverage` | Smoke tier (needs dist/) |
| `bun run typecheck` | Type gate |
| `bun run lint:mediation` | Mediation gate (bash) |
| `bun run check:auth-gate` | Auth gate (bash) |
| `bun test --isolate` | Full suite, single run |
</quick_commands>

<investigation_triggers>
- Any test failure (stop-failure protocol)
- Pass rate change > 1%
- Coverage change > 5%
- Build time > 10% increase (either platform)
- Binary size > 10% change on either platform
- New mediation violations or auth-gate failures
</investigation_triggers>

<anti_patterns>
- Hitting real Gemini/Google endpoints from tests
- Cookie-name filtering in any test or fixture
- Editing `openspec/specs/**` directly instead of via changes
- Skipping the build stage before smoke tests (smoke needs dist/)
- Capturing only one platform's binary and calling artifacts "measured"
- Running bash scripts via WSL `bash.exe` (use Git Bash on Windows)
</anti_patterns>

<principles>
<lean>Minimal tests, maximum coverage</lean>
<isolated>Per-test config dirs (`tests/helpers`), no cross-test dependencies</isolated>
<fast>Unit ms-scale; integration hermetic; smoke uses compiled binary</fast>
<safe>STOP on failure, report before fix</safe>
</principles>
