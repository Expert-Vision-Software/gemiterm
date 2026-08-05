---
name: test-baselining
description: Test execution, baseline management, and threshold evaluation for quality gates. Activates when user asks to run tests, evaluate against baseline, or update test baselines. Reads testing-protocol.md from the consumer project for workflow and threshold definitions.
---

# Test Baselining Skill

A generalized skill for executing tests, managing baselines, and evaluating quality gates across projects with threshold-based decision making.

## Purpose

Provides a standardized framework for:
- **Running tests** across backend and frontend layers
- **Capturing baselines** of key metrics (test counts, pass rates, coverage, build times)
- **Evaluating against thresholds** to determine quality gate pass/fail
- **Conditional baseline updates** only when criteria are met

## Consumer Project Files

After `init`, the following files exist at the consumer project root:

| File | Description |
|------|-------------|
| `testing-protocol.md` | Protocol definition with execution workflow, thresholds, and decision logic |
| `testing-baseline.xml` | Baseline metrics and changelog |

If these files are not at the project root, the skill searches upward from the working directory to locate them.

## Commands

### `init` — Initialize Baseline

Creates `testing-protocol.md` and `testing-baseline.xml` at the consumer project root.

**When to use:** When setting up baseline for the first time or regenerating from scratch.

**Workflow:**
```
Copy testing-protocol.md → Build → Test_Backend → Test_Frontend → Capture Metrics → Create Baseline
```

**Actions:**
1. Copy/tailor `testing-protocol.md` from plugin assets to consumer project root
2. Build and run tests to capture current metrics
3. Create `testing-baseline.xml` with initial baseline marker `BL-001`
4. Create initial changelog entry: "Initial baseline created"

### `eval` (default) — Evaluate Against Baseline

Compares current test execution results against the existing baseline using threshold rules.

**When to use:** Default behavior when running tests with quality gate evaluation.

**Workflow:**
```
Build → Test_Backend → Test_Frontend → Evaluate → Decision
```

**Actions:**
1. Locate `testing-protocol.md` and `testing-baseline.xml` in consumer project
2. Read protocol file for workflow, thresholds, and decision logic
3. Execute build and tests
4. Compare metrics against baseline
5. Report pass/fail with threshold deltas

### `update` — Conditional Baseline Update

Updates the baseline only if PASS criteria are met AND thresholds are exceeded.

**When to use:** When user explicitly requests baseline update after confirming new baseline is acceptable.

**Workflow:**
```
Build → Test_Backend → Test_Frontend → Evaluate → (PASS + threshold exceeded?) → Update : No Update
```

**Actions:**
1. Parse current baseline marker (e.g., `BL-001`)
2. Increment marker to next version (e.g., `BL-002`)
3. Auto-generate one-sentence changelog summary based on which thresholds were exceeded
4. Append new changelog entry, prune to last 10 entries (FIFO)
5. Update `LastUpdated` timestamp
6. Save updated `testing-baseline.xml`

## Baseline File Discovery

Files are expected at the consumer project root. If not found:

1. Check working directory for `testing-protocol.md` and `testing-baseline.xml`
2. Search upward to nearest `.git` parent directory
3. If files exist elsewhere in the repo, use them and warn the user
4. If files are missing, prompt user to run `init`

## Pass Criteria

All tests pass (0 failures), no build errors, no linting errors.

## Zero Tolerance Rules

- **No real APIs in tests** — All external dependencies must be mocked
- **Domain isolation** — ZERO external network dependencies in test suite
- **Stop on failure** — Immediately halt execution on test failure

## Execution Workflow

### Stage 1: Build

1. Build backend (compile, lint check)
2. Build frontend (compile, lint check)
3. Abort pipeline if either build fails

### Stage 2: Test Backend

1. Execute backend test suite with coverage collection
2. Record metrics: test count, pass count, fail count, pass rate, coverage %, duration

### Stage 3: Test Frontend

1. Execute frontend unit tests with coverage collection
2. Execute frontend e2e tests
3. Record metrics: test count, pass count, fail count, pass rate, coverage %, duration

### Stage 4: Evaluate

Compare current metrics against baseline and apply threshold matrix.

### Stage 5: Decision

Based on evaluation results, determine next action (see Decision Matrix below).

## Baseline XML Structure

```xml
<?xml version="1.0" encoding="utf-8"?>
<TestingBaseline>
  <Metadata>
    <LastUpdated>YYYY-MM-DDTHH:MM:SSZ</LastUpdated>
    <BaselineId>BL-001</BaselineId>
    <Framework>Generic Multi-Stack</Framework>
  </Metadata>
  <Backend>
    <!-- backend metrics -->
  </Backend>
  <Frontend>
    <!-- frontend metrics -->
  </Frontend>
  <Changelog>
    <Entry>
      <BaselineId>BL-001</BaselineId>
      <Date>YYYY-MM-DD</Date>
      <ChangeSummary>Initial baseline created</ChangeSummary>
    </Entry>
  </Changelog>
</TestingBaseline>
```

## Baseline Marker & Changelog

### Marker Format
- Pattern: `BL-NNN` (3-digit, zero-padded: `BL-001`, `BL-002`, ... `BL-999`)
- Set on `init` to `BL-001`
- Incremented on each `update` command

### Changelog Entry Structure
- `<BaselineId>`: The marker for this baseline version
- `<Date>`: ISO date when baseline was created
- `<ChangeSummary>`: Auto-generated one-sentence summary of reason for new baseline

### Changelog Summary Generation
The skill auto-generates the summary based on which thresholds were exceeded:

| Scenario | Example Summary |
|----------|-----------------|
| User requested | "User requested baseline update" |
| Test count change | "Test count increased by X%, thresholds exceeded" |
| Coverage change | "Coverage improved by X%, thresholds exceeded" |
| Multiple thresholds | "Test count +X%, coverage +Y%, build time +Z%, thresholds exceeded" |

### Changelog Pruning
- Maximum 10 entries retained
- When limit is exceeded, oldest entry is removed (FIFO)

## Threshold Matrix

| Metric | Threshold | Direction |
|--------|-----------|-----------|
| Test count | > 10% change | Any |
| Pass rate | > 10% change | Any |
| Build time | > 10% increase | Up only |
| Coverage (backend) | > 5% change | Any |
| Coverage (frontend) | > 5% drop | Down only |
| Test duration (frontend) | > 20% increase | Up only |
| Artifact size | > 10% change | Any |

## Decision Matrix

| Test Result | Threshold Exceeded | Action |
|-------------|---------------------|--------|
| PASS | Yes | Update baseline |
| PASS | No | No update (acceptable) |
| FAIL | Yes | No update (report first) |
| FAIL | No | No update (report first) |

### Decision Logic

```
IF test_result == PASS AND threshold_exceeded == TRUE:
    → UPDATE baseline
    → Report metrics with delta

ELIF test_result == PASS AND threshold_exceeded == FALSE:
    → NO UPDATE needed
    → Report "within threshold"

ELIF test_result == FAIL:
    → STOP immediately
    → REPORT failure details
    → PLAN fix approach
    → Obtain APPROVAL before proceeding
    → FIX identified issues
    → Re-run evaluation
```

## Stop-Failure Protocol

When tests fail:

1. **STOP** — Immediately halt further test execution
2. **REPORT** — Provide detailed failure output (test name, message, stack trace)
3. **PLAN** — Outline approach to fix failures
4. **APPROVAL** — Wait for user confirmation before proceeding with fixes
5. **FIX** — Implement corrections

## Error Handling

| Scenario | Response |
|----------|----------|
| Protocol file missing | Prompt user to run `init` command |
| Baseline file missing | Prompt user to run `init` command |
| Build failure | Report build errors, do not proceed to tests |
| Test framework unavailable | Report error, do not proceed |
| Invalid baseline XML | Warn user, offer to regenerate |
| Files in non-standard location | Warn user, proceed with located files |

## Output Format

Report should include:

- **Status**: PASS / FAIL
- **Test summary**: counts, pass rate, duration per layer
- **Threshold evaluation**: which metrics exceeded (if any)
- **Delta from baseline**: +/- change for each metric
- **Recommendation**: update baseline (if applicable) or fix required

## Template Files

The `templates/` directory contains the baseline and protocol templates used during `init`:

| Template | Purpose |
|----------|---------|
| `templates/testing-baseline.xml` | Baseline XML structure for metrics and changelog |
| `templates/testing-protocol.md` | Protocol definition with workflow and thresholds |

These templates are copied to the consumer project root during the `init` command.

## Integration Notes

This skill is backend/frontend agnostic. Implementation should:
- Adapt build commands to project type (dotnet, npm, maven, gradle, etc.)
- Adapt test commands to test framework (xunit, jest, vitest, pytest, etc.)
- Adapt coverage tools to language/platform
- Preserve the threshold rules and decision matrix exactly
- Maintain the baseline XML schema structure for portability
- Read `testing-protocol.md` from consumer project for workflow definitions
