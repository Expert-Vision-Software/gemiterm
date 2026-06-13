## MODIFIED Requirements

### Requirement: Interactive flag conflicts

The `--interactive / -i` flag MUST conflict with `--format` and `--out`. When `--interactive` is combined with either, the command MUST print `Cannot use --interactive with --format or --out.` to stderr and exit with code 1.

#### Scenario: --interactive conflicts with --format

- **WHEN** the user runs `gemiterm list -i --format json`
- **THEN** the command prints `Cannot use --interactive with --format or --out.` to stderr

#### Scenario: --interactive conflicts with --out

- **WHEN** the user runs `gemiterm list -i --out out.txt`
- **THEN** the command prints `Cannot use --interactive with --format or --out.` to stderr

### Requirement: Non-interactive byte-equivalence

The non-interactive forms of `gemiterm list` SHALL remain byte-equivalent to the previous baseline. The `--interactive` flag SHALL be the only entry point to the TUI. The flag SHALL be added without changing the default output of `gemiterm list` (no flags), the JSON output of `gemiterm list --format json`, the file output of `gemiterm list --out out.txt`, or any other existing flag's behaviour.

#### Scenario: gemiterm list --out is unchanged

- **WHEN** the user runs `gemiterm list --out out.txt` without `--interactive`
- **THEN** the rendered output is written to `out.txt` exactly as the non-interactive baseline
