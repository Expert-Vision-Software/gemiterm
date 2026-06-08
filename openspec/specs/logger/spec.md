## Purpose

The application's logging facility. It provides a single `Logger` class that emits timestamped, leveled, module-tagged log lines to `process.stderr`. Verbosity is controlled globally via a static flag, and each `Logger` instance carries a per-instance module tag that is rendered into every line it produces.

## Requirements

### Requirement: Logger Class With Leveled Methods
The system MUST export a `Logger` class with four instance methods: `debug(message, ...args)`, `info(message, ...args)`, `warn(message, ...args)`, and `error(message, ...args)`. Each method MUST format the supplied message (and any trailing args) into a single line on `process.stderr` with a level tag of `DEBUG`, `INFO`, `WARN`, or `ERROR` respectively.

#### Scenario: info writes an INFO line
- **WHEN** a `Logger` instance has `info("hello world")` called
- **THEN** `process.stderr.write` is invoked once with a string containing `[INFO]` and the message

#### Scenario: warn writes a WARN line
- **WHEN** `warn("something happened")` is called
- **THEN** the emitted line contains `[WARN]`

#### Scenario: error writes an ERROR line
- **WHEN** `error("failed")` is called
- **THEN** the emitted line contains `[ERROR]`

### Requirement: Verbose Toggle For Debug Output
The `Logger` class MUST expose a static `setVerbose(enabled: boolean)` method that sets a process-global verbose flag, and a static `isVerbose(): boolean` method that returns the current flag value. When the flag is `false` (the default), `debug()` MUST NOT write anything. When the flag is `true`, `debug()` MUST write a `DEBUG` line identically to the other levels.

#### Scenario: debug is silent by default
- **WHEN** `setVerbose(false)` is the current state
- **THEN** calling `debug("msg")` does not invoke `process.stderr.write`

#### Scenario: setVerbose(true) enables debug
- **WHEN** `setVerbose(true)` is called and then `debug("verbose message")` is invoked
- **THEN** `process.stderr.write` is invoked once with a string containing `[DEBUG]`

#### Scenario: isVerbose reflects current state
- **WHEN** the verbose flag is toggled
- **THEN** `isVerbose()` returns the new value

### Requirement: Standard Log Line Format
Every emitted log line MUST have the exact structure `[<ISO_TIMESTAMP>] [<LEVEL>] [<module>] <message>`, where `<ISO_TIMESTAMP>` is the result of `new Date().toISOString()`, `<LEVEL>` is one of `DEBUG`, `INFO`, `WARN`, `ERROR`, and `<module>` is the per-instance tag supplied at construction time. The line MUST end with a single newline character.

#### Scenario: ISO timestamp prefix
- **WHEN** any log method is called
- **THEN** the emitted line starts with `[` followed by an ISO-8601 timestamp that matches `YYYY-MM-DDTHH:MM:SS.sssZ`

#### Scenario: Module tag in the line
- **WHEN** a `Logger` is constructed with module tag `"test-module"` and `info("hi")` is called
- **THEN** the emitted line contains `[test-module]`

### Requirement: Output To Stderr Only
The `Logger` MUST write exclusively to `process.stderr` and MUST NOT write to `process.stdout`. This separation guarantees that logger output does not pollute structured stdout payloads (such as JSON command results) that consumers may parse.

#### Scenario: Logs do not touch stdout
- **WHEN** any log method is called
- **THEN** the only `process.<stream>.write` invocation triggered is on `process.stderr` (no writes to `process.stdout`)

### Requirement: Per-Instance Module Tag
Each `Logger` instance MUST carry a single, immutable `module` tag set via the constructor. The tag MUST appear in every line emitted by that instance. Different `Logger` instances with different module tags MUST produce lines with different module fields.

#### Scenario: Two instances, two different module tags
- **WHEN** `new Logger("cli").info("a")` and `new Logger("auth").info("b")` are both called
- **THEN** one emitted line contains `[cli]` and the other contains `[auth]`

### Requirement: Variadic Args Appended As Space-Separated
When extra arguments are passed to any log method after the message, the system MUST stringify each argument (via `String(arg)`), join them with single spaces, and append the result to the message portion of the line (after a single space separator). When no extra args are supplied, the message is emitted unchanged.

#### Scenario: Extra args appended
- **WHEN** `info("result", 42, "extra")` is called on a logger with module tag `"svc"`
- **THEN** the emitted line contains `[svc] result 42 extra`

#### Scenario: No extra args
- **WHEN** `info("plain")` is called
- **THEN** the emitted line contains the message verbatim and no trailing `undefined` token
