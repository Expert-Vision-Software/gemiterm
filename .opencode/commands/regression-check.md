---
description: Regression checking workflow
agent: explore
subtask: true
---

Load the regression-checking skill to perform a quality regression check:

```
!`tool loadSkill({ name: "regression-checking" })`
```

This skill answers:
- "Did we break anything?"
- "Should I proceed or stop?"
- "Is it safe to commit?"
- "Has quality improved or degraded?"

Usage:
  /regression-check         # Run check (proactive or reactive based on context)
  /regression-check status  # Quick status without full eval