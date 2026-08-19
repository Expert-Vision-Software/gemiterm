## MODIFIED Requirements

### Requirement: FetchCommand

The system MUST provide a `fetch` command implemented by `FetchCommand` in `src/cli/commands/fetch-command.ts`. The command MUST accept a single optional positional `<conversation_id>` argument and MUST support `--format/-f <text|json>` (default `text`), `--out/-o <path>`, and `--profile/-p <name>` (profile that owns the conversation; default: auto-discover). When a conversation id is provided, the command MUST fetch the conversation via the shared fetch helper (with `resolveProfile` for profile routing). When an explicit `--profile <name>` is supplied, the profile MUST be validated as configured, armed (`ensureSession`), and — when its jar armed stale — the in-flight detached rotation MUST be awaited (bounded, stderr notice only) and the classification re-checked once before proceeding; a profile that is still not `live` after the wait MUST surface failure handling instead of an instant pre-arm rejection: interactively, a recovery confirm mirroring the `list` command's; non-interactively, a typed `AuthenticationError` naming the profile's state and remediation. When no conversation id is provided, the command MUST invoke the `list` command via the shared command invoker and return without fetching. All output rendering MUST be delegated to `ChatOutput.render` — the command MUST NOT define its own output helpers or `writeOutput` method. Text output MUST include a header line `Conversation: <id>` and label each message with `User:` or `Model:` depending on role. JSON output MUST be `{ conversationId, messages }`. When `--out <path>` is supplied, the rendered output MUST be written to that file via `infrastructure/io.ts:writeTextFile` and the command MUST print `Output written to: <path>`; otherwise the output MUST be printed to stdout. The command MUST NOT recognize `--path` as an output flag. Fresh/live profiles MUST NOT observe added latency or changed stdout bytes.

#### Scenario: Fetch with conversation id renders the conversation
- **WHEN** the user runs `gemiterm fetch conv-abc123`
- **THEN** the conversation is fetched and rendered via `ChatOutput.render` with the `Conversation: conv-abc123` header

#### Scenario: Fetch with explicit stale profile awaits rotation and retries
- **WHEN** the user runs `gemiterm fetch conv-abc123 -p stale` where `stale`'s jar is stale, a detached rotation is in flight, and it lands within the wait ceiling
- **THEN** a stderr-only `Session refresh in progress` notice is printed, the rotation is awaited, the read is retried once on the refreshed jar, and the conversation renders (stdout bytes identical to a live-profile fetch of the same conversation)

#### Scenario: Fetch with explicit profile still not live after the wait fails typed
- **WHEN** the user runs `gemiterm fetch conv-abc123 -p stale` in a non-interactive context and `stale` classifies non-live after the rotation wait
- **THEN** the command throws `AuthenticationError` naming profile `stale`'s state and the `gemiterm auth` remediation, and exits non-zero — it MUST NOT silently route to another profile

#### Scenario: Fetch with no id invokes list
- **WHEN** the user runs `gemiterm fetch` with no positional argument
- **THEN** no conversation is fetched and the `list` command is executed against the same context (after printing a "No conversation ID specified" notice)

#### Scenario: Fetch with --format json
- **WHEN** the user runs `gemiterm fetch conv-abc123 --format json`
- **THEN** the output is a JSON document with shape `{ conversationId: "conv-abc123", messages: Message[] }`

#### Scenario: Fetch with --out writes the rendered output to the given file
- **WHEN** the user runs `gemiterm fetch conv-abc123 --out ./out.txt`
- **THEN** the rendered text or JSON content is written to `./out.txt` and a confirmation line `Output written to: <resolved>` is printed

#### Scenario: Fetch with empty messages prints "No messages found"
- **WHEN** the fetched conversation has `messages: []`
- **THEN** the rendered text output contains `No messages found.`

#### Scenario: Fetch --help shows usage
- **WHEN** the user runs `gemiterm fetch --help`
- **THEN** the output contains `Usage: gemiterm fetch [conversation_id] [options]` and documents `--format`, `--out`, `--profile`, and `--help`

#### Scenario: Fetch rendering goes through ChatOutput
- **WHEN** `FetchCommand.execute` runs
- **THEN** output is produced via `ChatOutput.render` and the command file defines no `writeOutput` or output-helper methods

## MODIFIED Requirements

### Requirement: Read commands await an in-flight detached rotation before surfacing auth failure
The single-profile read commands (`fetch`, `export`, `export-all`, `continue`) MUST, when their read operation has already failed for the resolved profile (typed authentication error or empty read — the exact predicate per command MUST be justified against the observed field failure shape recorded in `await-detached-rotation-on-empty-list` task 5.1, whose gate passed 2026-08-18; field data so far: `listChats` on a phantom jar resolves an empty array without error) and the auth facade reports a rotation in flight, print a notice to stderr, await the rotation via the facade's bounded `waitForRotation(profile)` (90 s default, at or above the runner's 60 s rotate budget), and retry the failed operation exactly once when a refreshed session resolves. The retry MUST execute against the refreshed credentials: when the armed `__Secure-1PSIDTS` differs from the value the process-cached default client was constructed with, the client MUST be re-armed (reconstructed from the refreshed jar) before the retry runs — a retry that reuses a client baked with the superseded pre-rotation `__Secure-1PSIDTS` does not satisfy this requirement. On wait timeout — the rotation remains in flight — the command MUST print the stderr hint that a session refresh is still running and then proceed with its existing failure handling unchanged; a still-failing retry after a landed rotation proceeds to the existing failure handling without the hint (the rotation has landed, so a "still running" message would be false). The happy path MUST NOT consult the rotation state, and every notice and hint MUST go to stderr only — each command's stdout/output contract is unchanged.

#### Scenario: Failed fetch awaits the rotation and retries once
- **WHEN** `fetch <id>` fails for the resolved profile with the facade reporting a rotation in flight, and the retried fetch after `waitForRotation` succeeds
- **THEN** the conversation renders and no authentication error surfaces

#### Scenario: Retry executes on the refreshed jar, not the cached stale client
- **WHEN** `fetch <id>` fails empty on a phantom jar, the rotation lands (armed `__Secure-1PSIDTS` changes), and the retry runs in the same process
- **THEN** the retry is issued through a client armed with the refreshed `__Secure-1PSIDTS` (the process-cached default client is invalidated on the PSIDTS change), and the conversation renders on the first process — no second invocation required

#### Scenario: Wait timeout falls through to the existing failure handling
- **WHEN** a read command's operation fails, the rotation await times out, and the retry is not attempted
- **THEN** the stderr hint is printed and the command's pre-existing failure output and exit code are unchanged

#### Scenario: Happy path never consults the rotation state
- **WHEN** a read command succeeds on its first attempt
- **THEN** `rotationInFlight` is never called and no wait occurs

#### Scenario: Unchanged jar keeps the cached client
- **WHEN** `getGeminiClient` is called repeatedly with the armed `__Secure-1PSIDTS` unchanged
- **THEN** the same client instance is returned (no reconstruction, no extra init) and the happy path observes zero added latency

## ADDED Requirements

### Requirement: ContinueCommand explicit-profile routing reaches stale profiles
The `continue` command MUST route its optional `--profile/-p <name>` through the same explicit-profile ladder as `fetch`: configured-profile validation, arm (`ensureSession`), bounded await of an in-flight detached rotation when the jar armed stale (stderr notice only), one reclassification, then proceed when live. Still not live: interactively, a recovery confirm mirroring the `list` command's; non-interactively, a typed `AuthenticationError` naming the profile's state and remediation — never a silent fallback to the default profile. Auto-discovered routing (no `-p`) uses `findProfileForConversation` (stale-aware second pass per the auth capability); single-profile setups are unchanged.

#### Scenario: Continue on a stale explicit profile awaits rotation
- **WHEN** the user runs `gemiterm continue conv-abc123 "hello" -p stale` and `stale`'s in-flight rotation lands within the wait ceiling
- **THEN** the message is sent via the `stale` profile's client on the refreshed jar

#### Scenario: Continue never silently falls back to the default profile
- **WHEN** the user runs `gemiterm continue conv-abc123 -p stale` in a non-interactive context and `stale` classifies non-live after the wait
- **THEN** the command throws `AuthenticationError` naming `stale` and exits non-zero; the default profile's client is NOT invoked

### Requirement: ListCommand awaits stale profiles even when live siblings return chats
The aggregate `list` fan-out MUST evaluate per-profile outcomes (chats or error per profile). When any profile yields zero chats or a rejected query while its detached rotation is in flight, the command MUST print the stderr-only `Session refresh in progress` notice, await those profiles' rotations (bounded), and re-query only those profiles, merging the results. Live profiles MUST NOT be re-queried and MUST NOT observe added latency. Stdout bytes for scenarios where no stale profile exists MUST remain byte-identical to the pinned contract (`tests/integration/commands/list.test.ts`).

#### Scenario: One live profile masks no longer — stale sibling's chats appear after its rotation lands
- **WHEN** profiles `live` (returns 14 chats) and `stale` (armed stale, rotation in flight, would return 0 chats pre-rotation) are both configured and the user runs `gemiterm list`
- **THEN** a stderr notice is printed, `stale`'s rotation is awaited, `stale` alone is re-queried, and the merged table includes both profiles' chats

#### Scenario: All-fresh fan-out is byte-identical
- **WHEN** every configured profile armed fresh (no rotation in flight) and the user runs `gemiterm list`
- **THEN** no stderr rotation notice is printed, no re-query occurs, and stdout bytes match the pinned non-interactive output exactly

#### Scenario: Stale profile whose rotation does not land gets the still-in-flight hint
- **WHEN** a stale-armed profile's rotation exceeds the wait ceiling during `gemiterm list`
- **THEN** the existing still-in-progress stderr hint names that profile, the merged (partial) results render, and the command exits without error
