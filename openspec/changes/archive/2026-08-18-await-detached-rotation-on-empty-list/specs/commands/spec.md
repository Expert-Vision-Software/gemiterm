## MODIFIED Requirements

### Requirement: ListCommand reactive phantom detection
The single-profile list flow MUST, when `listChats` resolves zero conversations, first consult the auth facade's rotation state: when `rotationInFlight(profile)` reports a detached rotation in flight, the command MUST print a notice to stderr, await the rotation via the facade's bounded `waitForRotation(profile)`, and — when a refreshed session is resolved — retry the list query exactly once, rendering the retried result when it is non-empty. When the wait resolves `null` while a rotation is still in flight, the command MUST print a stderr hint that a session refresh is still running and the command can be re-run shortly. The rotation-await stage MUST also cover the aggregate default listing (no `--profile`, multiple configured profiles): every configured profile was armed by the fan-out, so the stage awaits every profile whose rotation is in flight (in parallel, each bounded), retries the aggregate query once when any refresh resolves, and names the still-in-flight profiles in the timeout hint. After the rotation-await stage (or when no rotation is in flight), the command MUST invoke the auth facade's read-only session classifier exactly once for that profile — classification remains single-profile-only (explicit `--profile` or exactly one configured profile). When the classification is `live`, the command MUST proceed with the normal empty output and no further auth interaction. When the classification is `phantom` or `dead`, the command MUST offer recovery on a TTY (confirm prompt through the prompt-layer facade, then the auth recovery rung, then retrying the list query exactly once) and MUST print a diagnostic to stderr in non-interactive mode naming the profile, the classified state, and the `gemiterm auth` remedy. The stdout bytes of the non-interactive list output MUST NOT change under any classification or rotation-await outcome — every notice and hint the stage produces goes to stderr. Multi-profile queries MUST NOT invoke the classifier.

#### Scenario: In-flight rotation is awaited and the retry renders

- **WHEN** a single-profile list returns zero chats, the facade reports a rotation in flight, and `waitForRotation` resolves a refreshed session after which the retried list query returns chats
- **THEN** the retried result is rendered and the classifier is never invoked

#### Scenario: Aggregate empty listing awaits every in-flight rotation

- **WHEN** a default aggregate list across configured profiles returns zero chats and one profile's rotation is in flight
- **THEN** only that profile's rotation is awaited, the aggregate query is retried once when the refresh resolves, the retried non-empty result is rendered, and the classifier is never invoked

#### Scenario: Rotation wait timeout falls through with a hint

- **WHEN** a single-profile or aggregate list returns zero chats and `waitForRotation` resolves `null` with the rotation still in flight
- **THEN** a stderr hint naming the still-in-flight profile(s) is printed and the flow proceeds to the classification stage unchanged (single-profile) or the empty output (aggregate)

#### Scenario: No rotation in flight keeps the stage free

- **WHEN** a single-profile list returns zero chats and the facade reports no rotation in flight
- **THEN** no wait notice is printed, `waitForRotation` is not awaited for the common path, and the classification stage runs exactly as before

#### Scenario: Phantom result triggers one classification and one recovery retry

- **WHEN** a single-profile list returns zero chats, the rotation-await stage yields no refreshed retry, the classifier reports `phantom`, and the user accepts the recovery prompt
- **THEN** exactly one classification, one recovery rung, and one list retry occur, and the retried result is rendered

#### Scenario: Genuinely empty account does not recover

- **WHEN** a single-profile list returns zero chats and the classifier reports `live`
- **THEN** the normal empty output is printed with no recovery prompt

#### Scenario: Non-interactive stdout stays byte-identical

- **WHEN** a single-profile list returns zero chats with the classifier reporting `phantom` in a non-TTY run
- **THEN** stdout matches the pre-existing empty-list output byte-for-byte and every diagnostic (rotation notices, hints, classification) appears on stderr only

#### Scenario: Multi-profile queries never classify

- **WHEN** an aggregate list runs across profiles and one profile returns zero chats
- **THEN** the classifier is not invoked for any profile
