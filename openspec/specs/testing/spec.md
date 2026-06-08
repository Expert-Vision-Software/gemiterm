## Purpose

The test infrastructure that supports the `gemiterm` test suite. It provides a global setup module for creating and tearing down per-test config directories, fixture factories for cookies, storage states, and chat histories, parity-comparison infrastructure that diffs the Python and Bun CLI outputs, smoke tests that exercise the compiled CLI binary, and the `package.json` test scripts that run the unit, integration, parity, and smoke test suites. Together this infrastructure lets the test suite run hermetically against temporary directories and verifies that the Bun rewrite matches the Python reference behavior.

## Requirements

### Requirement: Global Test Setup

The system MUST provide `tests/setup.ts` as a global test-setup module. The module MUST expose `createTestConfigDir(prefix?)`, `createTestConfigDirAsync(prefix?)`, `cleanupTestConfigDir()`, `getTestConfigDir()`, `setupTestConfig(prefix?)`, `teardownTestConfig(originalEnv?)`, and `createMockStorageStateFile(profileName, cookies, configDir?)`. The default `prefix` MUST be `"gemiterm-test"`. `createTestConfigDir` and `createTestConfigDirAsync` MUST create a unique directory under `os.tmpdir()` whose name combines the prefix, a millisecond timestamp, and a random suffix. `cleanupTestConfigDir` MUST recursively remove the current test config directory (best-effort) and reset the cached value to `null`. `getTestConfigDir` MUST throw `Test config dir not initialized. Call createTestConfigDir() first.` when no directory has been created. `setupTestConfig` MUST create a test directory and MUST set `process.env.GEMITERM_CONFIG_DIR` to its path. `teardownTestConfig` MUST clean up the directory and MUST restore the previous value of `GEMITERM_CONFIG_DIR` from the `originalEnv` argument (deleting it entirely if it was unset, restoring it if it was set). `createMockStorageStateFile(profileName, cookies, configDir?)` MUST create a profile directory `<dir>/profiles/<profileName>`, MUST write a `storage_state.json` file inside it containing `{ cookies: Cookie[] }` where each cookie has `domain = ".google.com"`, `path = "/"`, `expires = -1`, `httpOnly = true`, `secure = true`, `sameSite = "None"` as defaults, and MUST return the file path.

#### Scenario: createTestConfigDir creates a unique directory under tmpdir
- **WHEN** `createTestConfigDir()` is called twice in succession
- **THEN** the second call returns a different path from the first and both directories exist on disk

#### Scenario: createTestConfigDir uses the provided prefix
- **WHEN** `createTestConfigDir("my-prefix")` is called
- **THEN** the resulting directory's basename starts with `my-prefix-`

#### Scenario: cleanupTestConfigDir removes the directory and resets state
- **WHEN** `createTestConfigDir()` is called and then `cleanupTestConfigDir()` is called
- **THEN** the directory no longer exists on disk and a subsequent `getTestConfigDir()` throws `Test config dir not initialized.`

#### Scenario: getTestConfigDir throws when uninitialized
- **WHEN** `getTestConfigDir()` is called before `createTestConfigDir()` (or after cleanup)
- **THEN** it throws an `Error` whose message contains `Test config dir not initialized.`

#### Scenario: setupTestConfig sets GEMITERM_CONFIG_DIR
- **WHEN** `setupTestConfig()` is called
- **THEN** `process.env.GEMITERM_CONFIG_DIR` equals the returned directory path

#### Scenario: teardownTestConfig restores the original env
- **WHEN** `teardownTestConfig({ GEMITERM_CONFIG_DIR: "/old/path" })` is called after `setupTestConfig()`
- **THEN** `process.env.GEMITERM_CONFIG_DIR` equals `"/old/path"` and the test directory is removed

#### Scenario: teardownTestConfig deletes the env var when it was originally unset
- **WHEN** `teardownTestConfig({ GEMITERM_CONFIG_DIR: undefined })` is called after `setupTestConfig()`
- **THEN** `process.env.GEMITERM_CONFIG_DIR` is deleted from the environment

#### Scenario: createMockStorageStateFile writes a valid storage_state.json
- **WHEN** `createMockStorageStateFile("p1", [{ name: "NID", value: "v" }], dir)` is called
- **THEN** the file `<dir>/profiles/p1/storage_state.json` exists, contains a JSON object with a `cookies` array, and the first cookie has `name === "NID"`, `domain === ".google.com"`, `path === "/"`, `expires === -1`, `httpOnly === true`, `secure === true`, `sameSite === "None"`

#### Scenario: createMockStorageStateFile uses getTestConfigDir by default
- **WHEN** `createMockStorageStateFile("p1", cookies)` is called without a `configDir`
- **THEN** the file is written under the path returned by `getTestConfigDir()`

### Requirement: Auth Fixtures

The system MUST provide `tests/fixtures/auth-fixtures.ts` exporting `createMockCookies(options?)`, `createMockStorageState(options?)`, `createExpiredStorageState()`, and `mockProfileDir(options?)`. The module MUST define internal constants `MOCK_COOKIE_DEFAULTS` (with `domain = ".google.com"`, `path = "/"`, `httpOnly = true`, `secure = true`, `sameSite = "None"`), `FUTURE_EXPIRY` (a Unix timestamp roughly 30 days in the future), and `PAST_EXPIRY` (a Unix timestamp roughly 30 days in the past). `createMockCookies` MUST accept `{ count?, names?, expiry?, values? }` where `count` defaults to 4, `names` defaults to `["__Secure-1PSID", "__Secure-1PSIDTS", "__Secure-1PSIDCC", "NID"]`, `expiry` defaults to `FUTURE_EXPIRY`, and `values` defaults to `{}`. The function MUST return an array of `Cookie` objects each built from `MOCK_COOKIE_DEFAULTS` plus the given name, value, and expiry. `createMockStorageState` MUST return `{ cookies: Cookie[] }` (calling `createMockCookies` internally with the supplied cookies/expiry). `createExpiredStorageState` MUST return a state object whose cookies all use `PAST_EXPIRY`. `mockProfileDir` MUST accept `{ profileName?, configDir?, cookies?, expired? }` (defaults: `profileName = "test-profile"`, `expired = false`) and MUST write a `storage_state.json` file under `<dir>/profiles/<profileName>` using `createMockStorageState` or `createExpiredStorageState` depending on `expired`, returning the profile directory path.

#### Scenario: createMockCookies returns 4 default future-expiry cookies
- **WHEN** `createMockCookies()` is called with no arguments
- **THEN** the returned array has 4 cookies named `__Secure-1PSID`, `__Secure-1PSIDTS`, `__Secure-1PSIDCC`, `NID` in that order, each with `expires === FUTURE_EXPIRY` and the `MOCK_COOKIE_DEFAULTS` fields

#### Scenario: createMockCookies honors custom count and names
- **WHEN** `createMockCookies({ count: 2, names: ["A", "B"] })` is called
- **THEN** the returned array has 2 cookies named `A` and `B`

#### Scenario: createMockCookies honors custom values
- **WHEN** `createMockCookies({ count: 1, names: ["X"], values: { X: "specific" } })` is called
- **THEN** the cookie's `value` is `"specific"`

#### Scenario: createMockStorageState wraps cookies in the expected shape
- **WHEN** `createMockStorageState({ cookies })` is called
- **THEN** the returned object is `{ cookies }` where `cookies` is the same array

#### Scenario: createExpiredStorageState uses PAST_EXPIRY
- **WHEN** `createExpiredStorageState()` is called
- **THEN** every cookie in the returned state's `cookies` array has `expires === PAST_EXPIRY`

#### Scenario: mockProfileDir creates the profile directory and storage_state.json
- **WHEN** `mockProfileDir({ profileName: "alice" })` is called
- **THEN** the directory `<configDir>/profiles/alice` exists and contains a valid `storage_state.json`

#### Scenario: mockProfileDir with expired writes past-expiry cookies
- **WHEN** `mockProfileDir({ profileName: "alice", expired: true })` is called
- **THEN** the cookies in the resulting `storage_state.json` all have `expires === PAST_EXPIRY`

#### Scenario: mockProfileDir creates a fresh test config dir when none exists
- **WHEN** `mockProfileDir({ profileName: "alice" })` is called and `getTestConfigDir()` would throw
- **THEN** `mockProfileDir` calls `createTestConfigDir()` internally and the profile directory is written under that new directory

### Requirement: Chat Fixtures

The system MUST provide `tests/fixtures/chat-fixtures.ts` exporting `createMockChatList(options?)`, `createMockMessageHistory(options?)`, and `createMockConversation(options?)`. `createMockChatList` MUST accept `{ count?, ids?, titles?, pinnedIndices?, baseTimestamp? }` where `count` defaults to 3, `pinnedIndices` defaults to `[]`, and `baseTimestamp` defaults to `Date.now()`. It MUST return an array of `ChatInfo` objects whose `id`/`title` defaults are taken from fixed default lists (`conv-abc123`/`"Chat about TypeScript"`, `conv-def456`/`"Pinned conversation"`, etc.) and whose `timestamp` equals `baseTimestamp - i * 86400000`. `createMockMessageHistory` MUST accept `{ count?, conversationId?, roles?, contents? }` where `count` defaults to 4, `roles` defaults to `["user", "model", "user", "model"]`, and the default contents are `["Hello, Gemini!", "Hi there! How can I help you today?", "Tell me about TypeScript.", "TypeScript is a typed superset of JavaScript."]`. It MUST return an array of `Message` objects, attaching `conversationId` to each only when supplied. `createMockConversation` MUST accept `{ id?, title?, messages?, messageCount? }` (defaults: `id = "conv-abc123"`, `title = "Chat about TypeScript"`, `messageCount = 4`) and MUST return a `Conversation` whose `messages` come from `createMockMessageHistory` (or the supplied `messages`).

#### Scenario: createMockChatList returns the requested number of chats
- **WHEN** `createMockChatList({ count: 5 })` is called
- **THEN** the returned array has length 5

#### Scenario: createMockChatList honors custom ids and titles
- **WHEN** `createMockChatList({ ids: ["x", "y"], titles: ["X", "Y"] })` is called
- **THEN** the resulting chats have `id === "x"` and `id === "y"` with corresponding titles

#### Scenario: createMockChatList applies pinnedIndices
- **WHEN** `createMockChatList({ count: 3, pinnedIndices: [0, 2] })` is called
- **THEN** the first and third chats have `isPinned === true` and the second has `isPinned === false`

#### Scenario: createMockChatList timestamps are baseTimestamp minus i days in ms
- **WHEN** `createMockChatList({ count: 3, baseTimestamp: 1_000_000_000_000 })` is called
- **THEN** chat `i` has `timestamp === 1_000_000_000_000 - i * 86_400_000`

#### Scenario: createMockMessageHistory defaults to 4 user/model messages
- **WHEN** `createMockMessageHistory()` is called
- **THEN** the returned array has 4 messages with roles cycling through `user, model, user, model`

#### Scenario: createMockMessageHistory attaches conversationId when supplied
- **WHEN** `createMockMessageHistory({ count: 2, conversationId: "conv-x" })` is called
- **THEN** both messages have `conversationId === "conv-x"`

#### Scenario: createMockMessageHistory omits conversationId when not supplied
- **WHEN** `createMockMessageHistory({ count: 1 })` is called
- **THEN** the resulting message has no `conversationId` field

#### Scenario: createMockConversation defaults id and title
- **WHEN** `createMockConversation()` is called
- **THEN** the returned `Conversation` has `id === "conv-abc123"`, `title === "Chat about TypeScript"`, and 4 messages

#### Scenario: createMockConversation accepts an explicit messages array
- **WHEN** `createMockConversation({ messages: [...] })` is called
- **THEN** the returned `Conversation` has exactly that `messages` array

### Requirement: Test Scripts

`package.json` MUST define a `scripts` section with the keys `test`, `test:unit`, `test:integration`, `test:parity`, `test:smoke`, and `test:all`. `test` MUST be `bun test`. `test:unit` MUST run `bun test tests/unit`. `test:integration` MUST run `bun test tests/integration`. `test:parity` MUST run `bun test tests/parity`. `test:smoke` MUST run `bun test tests/smoke`. `test:all` MUST be `bun test` (an alias for `test`).

#### Scenario: bun test runs all tests
- **WHEN** `bun test` is executed
- **THEN** all `*.test.ts` files under `tests/` are executed

#### Scenario: test:unit only runs tests/unit
- **WHEN** `bun run test:unit` is executed
- **THEN** only files under `tests/unit/` are loaded by the test runner

#### Scenario: test:integration only runs tests/integration
- **WHEN** `bun run test:integration` is executed
- **THEN** only files under `tests/integration/` are loaded by the test runner

#### Scenario: test:parity only runs tests/parity
- **WHEN** `bun run test:parity` is executed
- **THEN** only files under `tests/parity/` are loaded by the test runner

#### Scenario: test:smoke only runs tests/smoke
- **WHEN** `bun run test:smoke` is executed
- **THEN** only files under `tests/smoke/` are loaded by the test runner

#### Scenario: test:all is an alias for bun test
- **WHEN** `bun run test:all` is executed
- **THEN** it runs `bun test` with no path restriction

### Requirement: Parity Infrastructure

The system MUST provide `tests/parity/compare-outputs.ts` as a parity-comparison module that runs the same command against the Python `gemiterm` CLI and the Bun `gemiterm` CLI and diffs their `stdout`, `stderr`, and exit code. The Python CLI MUST be invoked as `${GEMITERM_PYTHON_CLI:-gemiterm} <args>` (default name `gemiterm`). The Bun CLI MUST be invoked as `bun <repo>/src/cli/index.ts <args>`. Each invocation MUST set `GEMITERM_CONFIG_DIR` to a temporary per-run directory. The module MUST normalize the outputs before comparison: version strings (`gemiterm vX.Y.Z`), ISO timestamps (`<timestamp>`), `/tmp/<dir>` paths (`<tmpdir>`), `C:\Users\<user>` (`<userdir>`), and `/home/<user>` (`<homedir>`). The module MUST export `runParityComparison(commands?, configDir?)` returning a `ParityReport` and, when run directly (`import.meta.main`), MUST print a formatted report and exit with code 1 if any command failed and 0 otherwise. The module MUST define a default command set `DEFAULT_TEST_COMMANDS` that includes `--help`, `--version`, help for each subcommand, and basic `status` / `list` invocations.

#### Scenario: Default command set is a non-empty list
- **WHEN** `runParityComparison()` is called with no arguments
- **THEN** it iterates over `DEFAULT_TEST_COMMANDS`, which MUST contain at least one command and MUST include the strings `"--help"`, `"--version"`, and a help invocation for at least one subcommand

#### Scenario: Version strings are normalized before diff
- **WHEN** the Python CLI prints `gemiterm v1.2.3` and the Bun CLI prints `gemiterm v2.0.0`
- **THEN** the parity comparison MUST consider their outputs equivalent (both normalized to `gemiterm vX.Y.Z`)

#### Scenario: ISO timestamps are normalized
- **WHEN** either CLI prints a string matching `\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[.]\d+Z`
- **THEN** the string is replaced with `<timestamp>` before comparison

#### Scenario: User-specific paths are normalized
- **WHEN** either CLI prints a path matching `/tmp/<dir>`, `C:\Users\<user>`, or `/home/<user>`
- **THEN** that path is replaced with `<tmpdir>`, `<userdir>`, or `<homedir>` respectively before comparison

#### Scenario: When Python CLI is unavailable the result is recorded as skipped
- **WHEN** the `gemiterm` binary is not on `PATH` and `GEMITERM_PYTHON_CLI` is not set
- **THEN** the parity result for that command MUST mark `python === null` and the summary MUST count the command as `skipped`

#### Scenario: Parity module exits non-zero on failed comparisons
- **WHEN** the module is run directly via `bun tests/parity/compare-outputs.ts` and at least one command has discrepancies
- **THEN** the process exits with code 1

#### Scenario: Parity module exits zero when no failures
- **WHEN** the module is run directly via `bun tests/parity/compare-outputs.ts` and no command has discrepancies and no commands were skipped
- **THEN** the process exits with code 0

### Requirement: Parity Test Scripts

The system MUST provide two parity-runner scripts: `tests/parity/test-commands-parity.sh` (POSIX shell) and `tests/parity/test-commands-parity.ps1` (PowerShell). Both scripts MUST verify that `bun` is on `PATH` (exiting with an error if not), MUST resolve `tests/parity/compare-outputs.ts` relative to their own location, MUST set a default `PythonCli` of `gemiterm` (overridable via `GEMITERM_PYTHON_CLI`), MUST define a default command list including help, version, and help for each of the user-facing commands, MUST create a `reports/parity/` directory (using a `REPORT_DIR` env override when set), MUST pass the command list to `compare-outputs.ts` via its `--commands` flag (comma-joined), MUST write a timestamped report file `parity-<YYYYMMDD-HHMMSS>.txt` containing the runner's combined stdout/stderr, and MUST exit with code 0 on success or 1 on failure. The PowerShell script MUST additionally propagate `$LASTEXITCODE` to its own exit code in the `catch` branch. Both scripts MUST accept an optional command list to override the defaults; the shell script accepts the commands as positional arguments, the PowerShell script accepts them as a `-Commands` parameter.

#### Scenario: POSIX parity script writes a report under reports/parity
- **WHEN** `tests/parity/test-commands-parity.sh` is run with `bun` on `PATH`
- **THEN** a file `reports/parity/parity-<timestamp>.txt` is created containing the runner output

#### Scenario: PowerShell parity script writes a report under reports/parity
- **WHEN** `tests/parity/test-commands-parity.ps1` is run with `bun` on `PATH`
- **THEN** a file `reports\parity\parity-<timestamp>.txt` is created containing the runner output

#### Scenario: Both scripts default the Python CLI to "gemiterm"
- **WHEN** either script is run without setting `GEMITERM_PYTHON_CLI`
- **THEN** the script passes `gemiterm` (or the literal default) to `compare-outputs.ts` as the Python CLI name

#### Scenario: PowerShell script propagates the comparison exit code
- **WHEN** `tests/parity/compare-outputs.ts` exits with a non-zero code
- **THEN** the PowerShell script exits with that same non-zero code from its `catch` block

#### Scenario: Scripts skip the comparison when the Python CLI is unavailable
- **WHEN** `gemiterm` is not on `PATH` and `GEMITERM_PYTHON_CLI` is not set
- **THEN** every command in the default list is reported as `SKIPPED` in the parity report (no failures)

### Requirement: Parity Default Command List

The parity test scripts MUST include `--help`, `--version`, `auth --help`, `status --help`, `list --help`, `fetch --help`, `continue --help`, `new --help`, `delete --help`, `export --help`, `export-all --help`, `profile --help`, `status`, `list`, `list --limit 5`, `list --format json`, and `auth` in their default command list. Together this covers all 9 user-facing non-help subcommands (`auth`, `status`, `list`, `fetch`, `continue`, `new`, `delete`, `export`, `export-all`) plus the help and version checks and the integration of `list --limit 5` and `list --format json`.

#### Scenario: Default list contains help and version checks
- **WHEN** either parity script is run with defaults
- **THEN** the command list contains `--help` and `--version`

#### Scenario: Default list contains a help invocation for every subcommand
- **WHEN** either parity script is run with defaults
- **THEN** the command list contains `<cmd> --help` for each of `auth`, `status`, `list`, `fetch`, `continue`, `new`, `delete`, `export`, `export-all`, `profile`

#### Scenario: Default list contains a non-help invocation for the three most-used subcommands
- **WHEN** either parity script is run with defaults
- **THEN** the command list contains `status`, `list`, `list --limit 5`, and `list --format json`

### Requirement: Smoke Tests

The system MUST provide `tests/smoke/smoke.test.ts` that runs the compiled CLI binary `src/cli/index.ts` via `bun` against `tests/fixtures` and asserts basic correctness. The smoke test suite MUST set `GEMITERM_CONFIG_DIR` to an empty string for the spawned process. The suite MUST contain a test for `--help` that asserts exit code `0`, non-empty `stdout`, and a `stdout` value that contains the substring `gemiterm` (case-insensitive). The suite MUST contain a test for `--version` that asserts exit code `0` and that `stdout` contains the substring `gemiterm v`. The suite MUST contain a test for `status` that asserts exit code `0` and non-empty `stdout`.

#### Scenario: --help smoke test passes
- **WHEN** the `--help` smoke test runs the CLI with `["--help"]`
- **THEN** the process exits with code 0, `stdout` is non-empty, and `stdout.toLowerCase().includes("gemiterm")` is true

#### Scenario: --version smoke test passes
- **WHEN** the `--version` smoke test runs the CLI with `["--version"]`
- **THEN** the process exits with code 0 and `stdout.includes("gemiterm v")` is true

#### Scenario: status smoke test passes
- **WHEN** the `status` smoke test runs the CLI with `["status"]` and `GEMITERM_CONFIG_DIR=""`
- **THEN** the process exits with code 0 and `stdout` is non-empty
