## ADDED Requirements

### Requirement: Shared Command Argument Parsing

The system MUST provide a shared, declarative command-argument parser in `src/cli/utils/command-args.ts`. It MUST export a `parseCommandArgs(args: string[], flags: readonly ArgFlagSpec[])` function that returns a flat `Record<string, unknown>` seeded from each flag's `default`. A flag spec MUST carry `key`, `long`, optional `short`, `type` (one of `boolean`, `string`, `integer`, `enum`), `description`, `helpLabel`, optional `default`, `enum`, `required`, and `valueName`. `parseCommandArgs` MUST recognize both the `long` and `short` tokens. Boolean flags MUST set `true`. Tolerant string flags MUST consume the following token (or `""` when absent). Required string/integer/enum flags MUST print `Error: <long> requires a <valueName>` to stderr and exit with code 1 when the following token is missing or starts with `-`. Integer flags MUST parse via `parseInt(value, 10) || default`. Enum flags MUST accept only values in `enum` and silently fall back to `default` otherwise. Unknown tokens MUST be ignored.

The system MUST also provide a `renderUsage(spec: UsageSpec)` function that renders a help block starting with the `usageLine`, an optional `Arguments:` section, an `Options:` section whose flag column is padded to `max(helpLabel length) + 2` using `chalk.cyan` for the flag and `chalk.dim` for the description, and optional footer lines.

#### Scenario: Boolean flag sets true
- **WHEN** `parseCommandArgs(["--force"], [{ key: "force", long: "--force", short: "-f", type: "boolean", default: false, description: "", helpLabel: "--force, -f" }])` is called
- **THEN** the result has `force === true`

#### Scenario: Tolerant string consumes the next token
- **WHEN** `parseCommandArgs(["--profile", "work"], [...profile spec...])` is called
- **THEN** the result has `profile === "work"`

#### Scenario: Tolerant string with no value yields empty string
- **WHEN** `parseCommandArgs(["--profile"], [...profile spec with type string, required false...])` is called
- **THEN** the result has `profile === ""`

#### Scenario: Required string with no value errors and exits 1
- **WHEN** `parseCommandArgs(["--profile"], [...profile spec with required true, valueName "profile name"...])` is called
- **THEN** stderr contains `Error: --profile requires a profile name` and the process exits with code 1

#### Scenario: Enum falls back to default on invalid value
- **WHEN** `parseCommandArgs(["--sort", "bogus"], [...sort spec enum ["recent","oldest","alpha"] default "recent"...])` is called
- **THEN** the result has `sort === "recent"`

#### Scenario: Integer parses via parseInt
- **WHEN** `parseCommandArgs(["--limit", "5"], [...limit spec type integer default 0...])` is called
- **THEN** the result has `limit === 5`

#### Scenario: renderUsage produces the Options block
- **WHEN** `renderUsage({ usageLine: "Usage: gemiterm list [options]", flags: [helpLabel "--limit, -n N" desc "Limit"], footer: [] })` is called
- **THEN** the returned string starts with `Usage: gemiterm list [options]` and contains an `Options:` section including the `--limit, -n N` label and its description

### Requirement: Shared Prompt Spillover

The system MUST provide a `loadEffectivePrompt(message: string | null, promptFile: string | null): Promise<string | null>` helper in `src/cli/utils/prompt-file.ts` used by both the `new` and `continue` commands. When `promptFile` is set it MUST load that file. When only `message` is set and it exceeds the Windows arg limit, the helper MUST spill the message to a temp file, load it, and remove the temp file afterwards. When `message` is within the limit it MUST return it unchanged. When both inputs are null it MUST return `null`.

#### Scenario: Prompt file takes precedence
- **WHEN** `loadEffectivePrompt("hi", "file.txt")` is called
- **THEN** the file content is read and returned

#### Scenario: Long message is spilled and cleaned up
- **WHEN** `loadEffectivePrompt(<message over the limit>, null)` is called
- **THEN** the message is written to a temp file, loaded, returned, and the temp file is removed

#### Scenario: No input returns null
- **WHEN** `loadEffectivePrompt(null, null)` is called
- **THEN** the result is `null`
