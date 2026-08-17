# Delta: auth (fix-3-session-keepalive)

Adds background session-keepalive scheduling on top of the fix-1 rotation engine. The facade, capture, store, validation, classifier, and recovery contracts from fix-1 `cookie-session-core` are unchanged.

## ADDED Requirements

### Requirement: Session keepalive rotates PSIDTS on an interval
The auth module MUST provide a session-keepalive loop for the active profile that, while running, triggers the synchronous headless PSIDTS rotation every 10 minutes (600 s), reusing the fix-1 refresher and CAS persistence unchanged. A 60-second in-process floor MUST suppress any second rotation within the same window (including one initiated manually through the facade's `refresh`). Each tick MUST first compare the on-disk `__Secure-1PSIDTS` against the loop's last-observed baseline and skip the browser entirely when the value is already current; a rotation MUST only spawn when genuinely due. A failed tick (browser unavailable, timeout, or `rotated: false`) MUST log without prompting or throwing into any active session and MUST reschedule.

#### Scenario: Current PSIDTS skips the browser
- **WHEN** a keepalive tick runs and the on-disk `__Secure-1PSIDTS` matches the loop's last-observed baseline with a successful rotation younger than the interval
- **THEN** no browser session is opened and no write occurs

#### Scenario: Due rotation runs and persists
- **WHEN** a tick finds the baseline older than the interval
- **THEN** the synchronous headless rotation runs exactly once and any rotated jar persists through the CAS store

#### Scenario: The 60-second floor prevents double rotation
- **WHEN** a scheduled rotation completes and a manual `refresh` is invoked 30 seconds later
- **THEN** the manual call is suppressed by the floor within the same process

#### Scenario: Failed tick never surfaces into the session
- **WHEN** a rotation tick fails or reports `rotated: false`
- **THEN** no error or prompt reaches the caller, a diagnostic is logged, and the next tick is scheduled
