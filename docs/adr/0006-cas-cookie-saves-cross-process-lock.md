# CAS snapshot/delta cookie saves with a cross-process lock

Concurrent writers to one profile's jar are real (detached rotation runner, recovery, keepalive, sibling CLI invocations). Last-writer-wins full-jar saves from stale in-memory jars clobbered fresher rotations (our ledger's L2-corruption entries; notebooklm #361 in the same SDK family). The store therefore loads a `(name, domain, path) → value` snapshot and saves only entries this process changed and only where disk still matches (compare-and-swap), behind a per-profile lock file with a 120 s steal window.

## Consequences

- Lock failure policy is asymmetric on purpose: CAS saves are **fail-open** (the CAS guard itself prevents lost updates, so availability wins) while full-jar writers are **fail-closed** (`LockUnavailableError` — a full replace must not race).
- Writes are atomic (temp file + rename) through the mediated io surface; on-disk format stays Playwright storage-state JSON.
