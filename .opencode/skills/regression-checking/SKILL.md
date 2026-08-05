---
name: regression-checking
description: Quality regression detection for autonomous agents and human reviewers. Answers "did we break anything?", "should I proceed or stop?", "is it safe to commit?" by analyzing test results against baseline. Activates proactively after agent changes or reactively when quality questions are asked.
---

# Regression Checking Skill

A decision-support skill that interprets test-baselining results to answer quality regression questions for both humans and autonomous agents.

## Purpose

Provides quality regression intelligence on top of test-baselining:

- **Answer quality questions** in plain language: "Did we break anything?", "Is it safe to proceed?", "Should I commit?"
- **Guide autonomous agents** with structured decision signals: PROCEED / STOP / REVIEW
- **Translate metrics into risk**: Convert threshold deltas into human-readable risk assessments
- **Enable self-evaluation**: Agents can check themselves before declaring task completion

## Context Reuse

Loads the `test-baselining` skill to reuse its operational details without duplication:

```
!`tool loadSkill({ name: "test-baselining" })`
```

This skill focuses on **interpretation and decision**, while `test-baselining` handles **execution and comparison**.

## Activation Triggers

### Proactive

- **After agent task completion**: Run regression check before reporting done
- **Before commit/push**: Verify quality before proposing changes
- **On large change detection**: When git diff exceeds certain threshold

### Reactive

These question patterns activate the skill:

| Question Pattern | Intent |
|-----------------|--------|
| "Did we break anything?" | Detect regressions |
| "Should I proceed or stop?" | Agent decision guidance |
| "Is it safe to commit?" | Pre-commit quality check |
| "Should I accept these changes?" | Human review support |
| "Has quality improved or degraded?" | Trend analysis |
| "Is the quality decrease worth keeping the latest changes?" | Trade-off evaluation |
| "Should I tell the agent to continue?" | Agent oversight |
| "Should I continue or fix regressions first?" | Decision routing |

## Execution Flow

```
1. Determine if fresh eval needed
   ├─ Check git diff since last eval
   ├─ If no changes → use cached results
   └─ If changes exist → run test-baselining eval

2. Load test-baselining skill and run eval

3. Read testing-protocol.md for thresholds and pass/fail criteria

4. Interpret results through risk lens:
   ├─ Parse PASS/FAIL status using pass_fail_criteria
   ├─ Analyze threshold deltas against baseline_thresholds
   ├─ Map deltas to risk levels
   └─ Identify specific violations

5. Generate outputs:
   ├─ Human-readable quality narrative
   └─ Structured agent decision signal
```

## Caching Logic

To avoid unnecessary test runs:

| Scenario | Action |
|----------|--------|
| No git changes since last eval | Reuse last eval results |
| Untracked/changed files exist | Run fresh eval |
| Baseline file missing | Prompt to run `test-baselining init` |
| Eval older than 1 hour | Run fresh eval (staleness check) |

## Decision Output

### Human-Readable Narrative

When answering quality questions, output a structured report:

```
Regression Check: PASS (with caveats) / FAIL / PASS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Test Results: 147 passed, 3 failed
Coverage: 78% (baseline: 82%) — -4% ▼
Build time: 45s (baseline: 38s) — +18% ▲▲

Threshold Violations:
• Frontend coverage dropped 5% (threshold: 5%) — AT LIMIT
• Build time increased 18% (threshold: 10%) — EXCEEDED

Risk Assessment: MEDIUM
Some metrics exceeded threshold. Review recommended before proceeding.

Recommendation: REVIEW — Fix test failures and address coverage drop.
Do not commit until status is PASS.
```

### Structured Agent Signal

For autonomous agent decision-making, output a machine-parseable signal:

```
{
  decision: "REVIEW",     // PROCEED | STOP | REVIEW
  status: "FAIL",        // PASS | FAIL
  summary: "3 tests failed, coverage dropped 4%, build time +18%",
  violations: [
    { metric: "coverage", current: "78%", baseline: "82%", delta: "-4%", threshold: "5%", severity: "medium" },
    { metric: "build_time", current: "45s", baseline: "38s", delta: "+18%", threshold: "10%", severity: "high" }
  ],
  risk_level: "medium",   // low | medium | high | critical
  approval_required: true,
  next_actions: [
    "Fix failing tests",
    "Investigate coverage drop",
    "Re-run regression check after fixes"
  ]
}
```

### Decision Definitions

| Decision | Trigger Condition | Agent Behavior |
|----------|------------------|----------------|
| **PROCEED** | PASS + no violations + low risk | Continue to next task or commit |
| **STOP** | FAIL + critical/high violations | Halt, report, await human approval |
| **REVIEW** | FAIL + medium/low violations, OR PASS + violations | Report and recommend specific fixes |

### Risk Level Mapping

| Condition | Risk Level |
|-----------|------------|
| PASS + no violations | **low** |
| PASS + minor violations | **medium** |
| FAIL + test failures | **high** |
| FAIL + test failures + multiple violations | **critical** |

## Quality Narrative Format

For human reviewers, present information in this order:

1. **Status badge**: PASS / FAIL / REVIEW
2. **Test summary**: counts, pass rate
3. **Key metric deltas**: coverage, build time, duration
4. **Threshold violations**: specific metrics that exceeded limits
5. **Risk assessment**: one-line summary
6. **Recommendation**: clear action statement

Keep it scannable. Use visual indicators:
- ✓ for improvements within threshold
- ▼/▲ for negative/positive deltas
- ▲▲ for exceeded thresholds

## Protocol File Reference

The `testing-protocol.md` at the consumer project root contains threshold and pass/fail criteria that drive regression decisions.

**Read these sections from `testing-protocol.md`:**

| Section | Usage |
|---------|-------|
| `pass_fail_criteria` | Determine what constitutes PASS vs FAIL for backend and frontend |
| `baseline_thresholds` | Map metric deltas to threshold violations |
| `decision_matrix` | Map baseline state transitions to update decisions |

**Threshold format from protocol:**
```
| Metric | Threshold | Direction |
|--------|-----------|-----------|
| Test count | > 10% change | Any |
| Coverage | > 5% change | Any |
| Build time | > 10% increase | Up only |
```

## Integration Notes

This skill does not run tests directly — it delegates to `test-baselining` and interprets the results.

The skill is project-type agnostic and works with any stack supported by `test-baselining` (.NET, Node, Python, etc.).

For agents: emit the structured signal at the end of every regression check so parent agents can make decisions without parsing the narrative.