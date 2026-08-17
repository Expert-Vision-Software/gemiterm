## 0. Gate (blocking)

- [ ] 0.1 Predecessor field verification passed: `await-detached-rotation-on-empty-list` task 5.1 green on a real session (idle ≥ 1h15m → single `list` waits then renders); record the observed failure shape for reads (typed error vs. empty) in this change's design.md Open Questions before any implementation

## 1. Per-command seams

- [ ] 1.1 `fetch`: wire the wait-then-retry at the failed/empty `fetchChat` seam per the recorded predicate; integration tests for retry-renders, timeout-fall-through, happy-path-untouched
- [ ] 1.2 `export` / `export-all`: wire at the per-conversation fetch-failure seam (per-consequence, matching existing partial-failure tolerance); integration tests as above
- [ ] 1.3 `continue`: wire at the initial-read/send failure seam; integration tests as above

## 2. Verification

- [ ] 2.1 `bun test --isolate` + `bun run typecheck` + `bun run lint:mediation` + `bun run check:auth-gate`; per-command stdout contracts re-asserted byte-identical
- [ ] 2.2 Field spot-check on a stale session: one read command recovers in a single invocation
