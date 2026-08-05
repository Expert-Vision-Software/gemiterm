---
description: Test baselining workflow (init|eval|update)
agent: explore
subtask: true
---

Load the test-baselining skill and execute the specified command:
!`tool loadSkill({ name: "test-baselining" })`

Command: $ARGUMENTS (defaults to "eval" if not specified)

Available commands:
- init:   Initialize a new baseline from current test results
- eval:   Evaluate current tests against existing baseline (DEFAULT)
- update: Update baseline if current results PASS and thresholds exceeded

Usage:
  /test-baseline eval     # Default - evaluate against baseline
  /test-baseline init     # Create new baseline
  /test-baseline update   # Conditionally update baseline
