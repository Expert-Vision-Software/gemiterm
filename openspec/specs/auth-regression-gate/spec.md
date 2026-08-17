## Purpose

The auth-regression-gate capability provides a comprehensive test suite and CI gating mechanism to prevent regression of historical phantom-auth bug classes. It enforces that any change touching auth-sensitive paths must also update the auth-regression test suite and documentation, and includes a mutation canary to verify the gate remains effective.

## Requirements

### Requirement: Auth regression suite

The system SHALL provide a dedicated test suite at `tests/auth-regression/` that pins the invariants violated by every historical phantom-auth bug class, executing real `CookieSession`/`CookieStore`/classifier/recovery code against injected fakes at the driver and wire seams, and asserting against the on-disk `storage_state.json` artifact and PSIDTS values rather than return values alone.

#### Scenario: full-jar capture integrity
- **WHEN** the fake driver completes a login capture offering a full multi-cookie jar
- **THEN** the persisted on-disk jar contains every offered cookie (grouped by name) and no name-subset filter anywhere in the pipeline can reduce it

#### Scenario: PSIDTS rotation propagates through every persist path
- **WHEN** the browser refresh path (detached refresh or recovery rung) observes a PSIDTS value differing from the on-disk baseline
- **THEN** each persist path saves the new PSIDTS value to disk, and a test that discards the rotation (keeps the stale value) fails

#### Scenario: no anonymous-cookie persistence on signed-out capture
- **WHEN** a capture ends on a signed-out state (no init tokens; only anonymous cookies offered)
- **THEN** no cookie file is written, and any pre-existing jar on disk is left byte-unchanged

#### Scenario: stale in-memory jar cannot clobber fresher disk jar
- **WHEN** a process holding a snapshot-loaded jar saves while a sibling has already written a newer PSIDTS to disk
- **THEN** the CAS save preserves the disk value for cookies the process did not itself observe changing

#### Scenario: present-but-unroutable PSIDTS fails tier-1 validation
- **WHEN** a jar contains `__Secure-1PSIDTS` that is expired or scoped such that RFC 6265 routing would not deliver it to the app host
- **THEN** tier-1 validation raises (or the classifier reports non-live) rather than passing on name presence

#### Scenario: classifier truth table
- **WHEN** the classifier probes jars shaped as live (tokens present, listChats ≥ 1), phantom (tokens present, listChats 0), and dead (no tokens)
- **THEN** it reports `live`, `phantom`, and `dead` respectively, deterministically across repeated runs

#### Scenario: probe has no side effects
- **WHEN** the read-only classifier probe runs against any jar shape
- **THEN** no file is written, no rotation fires, and the on-disk jar is byte-unchanged

### Requirement: Auth-sensitive change gating

The system SHALL enforce that any change touching an auth-sensitive path (the owned glob/regex list, including `src/auth/**`, the playwright driver, the client-wrapper cookie plumbing, the profile-lifecycle login action, cookie storage infrastructure, and the auth lifecycle documentation) also modifies `tests/auth-regression/` in the same change, enforced as a failing CI check (`scripts/check-auth-gate`, exposed locally as `bun run check:auth-gate`) with an explicit documented opt-out (`SKIP_AUTH_REGRESSION_GATE=1` plus a stated reason).

#### Scenario: auth code change without gate coverage fails CI
- **WHEN** a diff modifies a file under `src/auth/` and no file under `tests/auth-regression/`
- **THEN** `check-auth-gate` exits non-zero with a message naming the opt-out and its reason requirement

#### Scenario: non-auth change passes unaffected
- **WHEN** a diff touches only files outside the auth-sensitive list and content regex
- **THEN** `check-auth-gate` exits zero

#### Scenario: opt-out is honored and auditable
- **WHEN** `SKIP_AUTH_REGRESSION_GATE=1` is set with a reason recorded in the change description
- **THEN** the check exits zero and the opt-out is reported in the check output

### Requirement: Mutation canary verifies the gate

The system SHALL provide a nightly CI canary that applies each historical bug shape (capture name-filter, persist discards PSIDTS rotation, stale-clobber save) as a temporary patch from `tests/auth-regression/mutations/`, runs the auth-regression suite, and asserts the suite goes RED for each mutation.

#### Scenario: reintroduced name-filter bug turns suite red
- **WHEN** the capture name-filter mutation patch is applied and the suite runs
- **THEN** at least one auth-regression test fails

#### Scenario: canary detects gate rot
- **WHEN** a mutation patch no longer applies because production code moved
- **THEN** the canary fails loudly rather than silently skipping