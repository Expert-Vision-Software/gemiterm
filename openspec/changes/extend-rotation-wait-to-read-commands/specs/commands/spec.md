## ADDED Requirements

### Requirement: Read commands await an in-flight detached rotation before surfacing auth failure
The single-profile read commands (`fetch`, `export`, `export-all`, `continue`) MUST, when their read operation has already failed for the resolved profile (typed authentication error or empty read — the exact predicate per command MUST be justified against the observed field failure shape recorded in `await-detached-rotation-on-empty-list` task 5.1, whose gate passed 2026-08-18; field data so far: `listChats` on a phantom jar resolves an empty array without error) and the auth facade reports a rotation in flight, print a notice to stderr, await the rotation via the facade's bounded `waitForRotation(profile)` (90 s default, at or above the runner's 60 s rotate budget), and retry the failed operation exactly once when a refreshed session resolves. On wait timeout or a still-failing retry, the command MUST print the stderr hint that a session refresh is still running and then proceed with its existing failure handling unchanged. The happy path MUST NOT consult the rotation state, and every notice and hint MUST go to stderr only — each command's stdout/output contract is unchanged.

#### Scenario: Failed fetch awaits the rotation and retries once
- **WHEN** `fetch <id>` fails for the resolved profile with the facade reporting a rotation in flight, and the retried fetch after `waitForRotation` succeeds
- **THEN** the conversation renders and no authentication error surfaces

#### Scenario: Wait timeout falls through to the existing failure handling
- **WHEN** a read command's operation fails, the rotation await times out, and the retry is not attempted
- **THEN** the stderr hint is printed and the command's pre-existing failure output and exit code are unchanged

#### Scenario: Happy path never consults the rotation state
- **WHEN** a read command succeeds on its first attempt
- **THEN** `rotationInFlight` is never called and no wait occurs
