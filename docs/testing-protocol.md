<critical_rules priority="highest">
<pass_criteria>All tests pass (0 failures), no build errors, no linting errors</pass_criteria>
<baseline_update>Update `@testing-baseline.xml` **ONLY** on PASS + threshold exceeded</baseline_update>
<no_real_apis>**NEVER** call real external APIs in tests</no_real_apis>
<domain_isolation>Domain tests: **ZERO** external dependencies, no mocks</domain_isolation>
<stop_on_failure>STOP immediately on test failure → REPORT → PLAN → APPROVAL → FIX</stop_on_failure>
</critical_rules>

<metadata>
<updated>2026-08-02</updated>
<baseline>@testing-baseline.xml</baseline>
</metadata>

<reporting_schema>
<Solution>
  <UnitTests>
    <!-- from: bun test (full suite) -->
    <TestFiles>int</TestFiles>
    <Total>int</Total>
    <Passed>int</Passed>
    <Failed>int</Failed>
    <Skipped>int</Skipped>
    <Duration>float (seconds)</Duration>
    <ExpectCalls>int</ExpectCalls>
  </UnitTests>

  <IntegrationTests>
    <!-- from: bun run test:integration -->
    <Status>Active | Inactive</Status>
    <Total>int</Total>
    <Passed>int</Passed>
    <Failed>int</Failed>
    <Duration>float (seconds)</Duration>
  </IntegrationTests>

  <SmokeTests>
    <!-- from: bun run test:smoke -->
    <Status>Active | Inactive</Status>
    <Total>int</Total>
    <Passed>int</Passed>
    <Failed>int</Failed>
    <Duration>float (seconds)</Duration>
  </SmokeTests>

  <Build>
    <Windows>
      <!-- from: bun run build:windows -->
      <Status>Success | Failed</Status>
      <BuildTime>float (seconds)</BuildTime>
      <TypeCheckStatus>Success | Failed</TypeCheckStatus>
      <TotalSizeMB>float</TotalSizeMB>
      <FileCount>int</FileCount>
    </Windows>
    <Linux>
      <!-- from: bun run build:linux -->
      <Status>Success | Failed</Status>
      <BuildTime>float (seconds)</BuildTime>
      <TypeCheckStatus>Success | Failed</TypeCheckStatus>
      <TotalSizeMB>float</TotalSizeMB>
      <FileCount>int</FileCount>
    </Linux>
  </Build>
</Solution>
</reporting_schema>

<context_hierarchy>
<system_context>Test baselining and quality gates</system_context>
<domain_context>Bun + TypeScript CLI project (gemiterm)</domain_context>
<task_context>Write/modify tests, execute test runs, update baselines</task_context>
<execution_context>Commands, thresholds, architecture compliance</execution_context>
</context_hierarchy>

<role>
<identity>Test Execution Agent</identity>
<capabilities>Run tests, collect metrics, validate against thresholds</capabilities>
<scope>CLI unit/integration/smoke tests via bun test</scope>
<constraints>No real API calls, domain isolation, baseline thresholds</constraints>
</role>

<execution_workflow>
<stage name="Build">
 Execute build and capture artifact metrics:
  1. bun run typecheck (tsc --noEmit) — verify type safety
  2. bun run build:windows — produce dist/windows/gemiterm.exe
  4. bun run build:linux — produce dist/linux/gemiterm
  5. Capture artifact stats per platform:
     - dist/{platform}/gemiterm(.exe) size bytes
     - Number of output files
     - Total output directory size
  Record: build success/fail, build time, artifact size, file count per platform
 </stage>

<stage name="Test">
 Execute test suite and capture metrics:
 1. bun test — full suite (unit + integration + smoke)
 2. Parse output for: pass count, fail count, skip count, duration, expect() calls
 3. Optional targeted runs:
    - bun run test:unit — unit tests only
    - bun run test:integration — integration tests only
    - bun run test:smoke — smoke tests only
 Record: total tests, passed, failed, skipped, duration, expect() calls
</stage>

<stage name="Evaluate">
 Compare current metrics against baseline:
  - Test count vs baseline (threshold: > 10% change)
  - Pass rate vs baseline (threshold: > 10% change)
  - Build time vs baseline (threshold: > 10% increase)
  - Artifact size vs baseline (threshold: > 10% change)
  - Test duration vs baseline (threshold: > 20% increase)
 **PASS:** All tests pass, no build/lint errors
 **FAIL:** Any test failure, build error, or linting error
</stage>

<stage name="Baseline">
 If PASS + threshold met → Update `@testing-baseline.xml`
 If PASS + threshold NOT met → No update needed (within tolerance)
 If FAIL → STOP, report, plan, await approval before fixing
 **Do NOT modify this protocol file with results**
</stage>
</execution_workflow>

<test_strategies>
<solution>
| Layer | Scope | Mocks |
|-------|-------|-------|
| Unit | CLI commands, services, core logic | Mocks allowed for external deps |
| Integration | File I/O, config, auth flow | Mocked Playwright CLI |
| Smoke | End-to-end CLI invocations | Real execution |

**Critical:** Tests run via bun test with mocked external dependencies
</solution>
</test_strategies>

<pass_fail_criteria>
<solution_pass>
 - Test pass rate = 100% (0 failures)
 - bun test returns 0 exit code
 - bun run typecheck returns 0 exit code
 - Build produces valid dist/linux/gemiterm and dist/windows/gemiterm.exe
</solution_pass>

<solution_fail>
 - Any test failure
 - TypeScript errors
 - Linting errors
 - Mediation errors (path imports outside infrastructure/)
 - Build failure
</solution_fail>
</pass_fail_criteria>

<baseline_thresholds>
| Metric | Threshold | Direction |
|--------|-----------|-----------|
| Test count | > 10% change | Any |
| Pass rate | > 10% change | Any |
| Build time | > 10% increase | Up only |
| Test duration | > 20% increase | Up only |
| Artifact size | > 10% change | Any |

<decision_matrix>
| Current | New | Result | Update? |
|---------|-----|--------|---------|
| PASS | PASS | PASS | Yes, if threshold met |
| PASS | FAIL | FAIL | No |
| FAIL | PASS | PASS | Yes (recovery) |
| FAIL | FAIL | FAIL | No |
</decision_matrix>
</baseline_thresholds>

<quick_commands>
| bun | Purpose |
|-----|---------|
| bun test | Full test suite |
| bun run test:unit | Unit tests only |
| bun run test:integration | Integration tests only |
| bun run test:smoke | Smoke tests only |
| bun run test:parity | Parity tests (requires Python CLI v1.4.1) |
| bun run typecheck | TypeScript type checking |
| bun run build:windows | Windows production build |
| bun run build:linux | Linux production build |
</quick_commands>

<investigation_triggers>
<solution>
 - Test failures increase
 - Pass rate drops below 100%
 - Build time > 10% increase
 - Test duration > 20% increase
 - Artifact size > 10% change
 - New unhandled errors
</solution>
</investigation_triggers>

<anti_patterns>
<solution>
 - Anemic tests (only getters/setters)
 - Testing private methods
 - Missing critical path coverage
 - Using node:fs/path/os directly (must use infrastructure/ mediation)
</solution>
</anti_patterns>

<best_practices>
<solution>
 - AAA Pattern (Arrange-Act-Assert)
 - One assertion per test
 - Descriptive names (what + why)
 - Test edge cases (nulls, empty, boundaries)
 - Mock external dependencies (Playwright CLI, file system)
</solution>
</best_practices>

<principles>
<lean>Minimal tests, maximum coverage</lean>
<isolated>No cross-test dependencies</isolated>
<fast>Unit &lt; 100ms per test</fast>
<safe>STOP on failure, report before fix</safe>
</principles>
