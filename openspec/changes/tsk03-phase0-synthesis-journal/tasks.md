## 1. Documentation commitment

- [ ] 1.1 Verify `docs/phantom-bug-synthesis.md` exists with the write-once ledger convention header and empty Appendix section
- [ ] 1.2 Verify the `git mv` from `docs/phantom-auth-synthesis-2026-08-06.md` preserved history
- [ ] 1.3 Confirm the entry template is present in the Appendix section

## 2. OpenSpec artifact

- [ ] 2.1 Create OpenSpec change dir `tsk03-phase0-synthesis-journal/` with proposal, design, tasks
- [ ] 2.2 Run `bun run typecheck` — doc-only, should be clean
- [ ] 2.3 Commit

## 3. Verification

- [ ] 3.1 `bun test` — no test count change (doc-only)
- [ ] 3.2 `bun run typecheck` — clean
