## Why

Every prior phantom-auth fix shipped green but burned live. Without a journaling rule that requires each new fix or refactor to append an entry to the bug ledger, knowledge of past regressions fades and the same mistakes repeat.

## What Changes

- Formalize the write-once ledger convention for `docs/phantom-bug-synthesis.md` as an OpenSpec change.
- The rename (`docs/phantom-auth-synthesis-2026-08-06.md` → `docs/phantom-bug-synthesis.md`), convention header, and empty Appendix section were completed in a prior session. This change records the commitment as an OpenSpec artifact.

## Capabilities

No spec delta. Doc-only.

## Impact

- Code touched: none (doc-only).
- No production code, no test code, no spec delta.
- `docs/phantom-bug-synthesis.md` is the write-once ledger for all phantom-auth bug history.
