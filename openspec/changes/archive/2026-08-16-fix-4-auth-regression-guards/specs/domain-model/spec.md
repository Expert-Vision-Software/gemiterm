# domain-model Delta

## ADDED Requirements

### Requirement: Documentation authority order

The repository SHALL declare, in `docs/README.md` and `AGENTS.md`, a binding authority order for auth documentation: (1) `docs/auth-cookie-lifecycle.md` is canonical and normative; (2) `docs/cookie-ablation-findings.md` is the empirical record; (3) `docs/archive/**` is historical and non-normative; (4) all other documents MUST NOT contradict (1). Archived documents SHALL carry a top banner naming their superseding document.

#### Scenario: agent resolves a doc conflict by rule
- **WHEN** any document other than the lifecycle doc contradicts it on an auth fact
- **THEN** the lifecycle doc governs, per the declared authority order in `docs/README.md`

#### Scenario: archived doc is self-describing
- **WHEN** a reader opens any file under `docs/archive/`
- **THEN** the file's header names it as archived and points to `docs/auth-cookie-lifecycle.md`

### Requirement: Auth documentation change coupling

Any change that modifies auth behavior SHALL, in the same change, update the changelog section of `docs/auth-cookie-lifecycle.md`, and the auth lifecycle doc itself SHALL be listed among the auth-sensitive paths gated by the auth-regression check.

#### Scenario: auth behavior change without doc update fails the gate
- **WHEN** a diff alters `src/auth/**` behavior and touches neither `tests/auth-regression/` nor `docs/auth-cookie-lifecycle.md`
- **THEN** `check-auth-gate` exits non-zero

### Requirement: Ledger closure and archival

Upon this change's implementation, `docs/phantom-bug-synthesis.md` SHALL receive a closing entry recording that fix-1..3 landed the validated replacement and that the ledger is closed, and SHALL then reside under `docs/archive/` with the archive banner.

#### Scenario: ledger closed and archived
- **WHEN** this change is implemented
- **THEN** `docs/archive/phantom-bug-synthesis.md` exists with a closing entry and banner, and no un-archived copy remains in `docs/`
