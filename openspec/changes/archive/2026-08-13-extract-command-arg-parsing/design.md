## Context

Each command's `parseArgs` is a `for`/`switch` over `args` that mutates a local `options` object seeded from a `DEFAULT_OPTIONS` constant. Flags fall into four kinds:

- **boolean** — `--help/-h`, `--force/-f`, `--all-profiles`, `--include-metadata`, `--interactive/-i`.
- **string (tolerant)** — `--profile/-p`, `--search/-s`, `--out/-o`, `--after`, `--before`, `--out-dir/-o`, `--since`. Tolerant commands do `options.x = args[++i] ?? ""` (consume the next token even if it is another flag or absent).
- **string (required)** — `--profile/-p`, `--prompt-file/-f` in `new`/`continue`. These print `Error: --<flag> requires a <value>` to stderr and `process.exit(1)` when the next token is missing or flag-like.
- **integer** — `--limit/-n` (`parseInt(args[++i],10) || 0`), `--offset` (same).
- **enum (silent fallback)** — `--sort` (`recent|oldest|alpha`), `--format/-f` (`text|json` for list/fetch, `markdown|json` for export). Invalid values silently fall back to the default.

## Goals / Non-Goals

Goals: one declarative spec per command, one parser, one usage renderer; byte-equivalent behavior; extract the spillover duplication.

Non-goals: converting `auth`/`status` (different parsing model), changing any flag semantics, changing output.

## Decisions

### 1. Spec model (`src/cli/utils/command-args.ts`)

```ts
export type ArgFlagType = "boolean" | "string" | "integer" | "enum";

export interface ArgFlagSpec {
  key: string;              // result key, e.g. "limit"
  long: string;             // "--limit"
  short?: string;           // "-n"
  type: ArgFlagType;
  description: string;      // help text
  helpLabel: string;        // exact usage column text, e.g. "--limit, -n N"
  default?: unknown;
  enum?: readonly string[]; // for type "enum"
  required?: boolean;       // string/integer/enum: missing value errors
  valueName?: string;       // e.g. "profile name" / "path" for the required error
}

export interface UsageSpec {
  usageLine: string;                    // "Usage: gemiterm list [options]"
  arguments?: { name: string; description: string }[];
  flags: readonly ArgFlagSpec[];
  footer?: readonly string[];
}

export function parseCommandArgs(args: string[], flags: readonly ArgFlagSpec[]): Record<string, unknown>;
export function renderUsage(spec: UsageSpec): string;
```

`helpLabel` is carried explicitly so the help column reproduces the current byte-exact strings (`--limit, -n N`, `--format, -f <fmt>`, …) without deriving placeholders.

### 2. Parser semantics

- Seed `result[key] = default` for every flag.
- Match `args[i]` against `long`/`short`.
- boolean → `true`.
- string tolerant → `result[key] = args[++i] ?? ""`.
- string/integer/enum required → if next token is missing or starts with `-`, print `Error: <long> requires a <valueName>` to stderr and `process.exit(1)`; else consume.
- integer → `parseInt(value, 10) || default`.
- enum → `enum.includes(value) ? value : default`.
- Unknown tokens are ignored (positionals are extracted separately by each command).

### 3. Usage renderer

`renderUsage` reproduces the shared shape: `Usage:` line, optional `Arguments:` block (`padEnd(20)`), blank line, `Options:` block with each flag column padded to `maxLabelLen + 2` and rendered as `  ` + `chalk.cyan(padded)` + `chalk.dim(description)`, then optional footer lines. `new`/`continue` switch from fixed `padEnd(22/26)` to the shared `maxLen + 2` padding — a cosmetic spacing change only (no test asserts exact help spacing).

### 4. Spillover extraction (`prompt-file.ts`)

```ts
export async function loadEffectivePrompt(message: string | null, promptFile: string | null): Promise<string | null>;
```

Encapsulates: if `promptFile` use it; else if `message` exceeds the arg limit, spill to a temp file (marking it for cleanup); load the file; clean up spillover. Returns the resolved prompt string or `null`. `new` and `continue` both call it.

## Risks

- Behavior drift is the main risk; mitigated by the existing per-command test suites (help/flag assertions) plus a new `command-args.test.ts` covering tolerant vs required values, enum fallback, integer parsing, and usage rendering.
- The required-value error path uses `process.exit(1)` inside the parser (matching the current commands) — a small amount of process control leaking into a utility, accepted to preserve byte-equivalent behavior.

## Files

- New: `src/cli/utils/command-args.ts`, `tests/cli/utils/command-args.test.ts`.
- Edit: `src/cli/commands/{list,fetch,new,continue,delete,export,export-all}-command.ts`, `src/cli/utils/prompt-file.ts`.
