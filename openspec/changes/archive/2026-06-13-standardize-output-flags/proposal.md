## Why

The CLI overloads the `-p` short flag: it means `--path` (output file) on `fetch` and `list`, but `--profile` on `new`. Separately, the "output to a path" concept is spelled three different ways across commands — `--path` (`fetch`, `list`), `--output` (`export`), and `--output-dir` (`export-all`). Both issues surprise users and make the flag surface inconsistent.

Standardize on two rules:

1. **`-p` means profile only** (the `new` command is the canonical reference).
2. **Output paths use `-o`/`--out`** (single file) and **`-o`/`--out-dir`** (directory).

Old flag spellings are **hard-removed** (no hidden aliases). This is acceptable at v2.0.0, which is a clean-break rewrite with no `--path`/`--output` users to deprecate gracefully.

## What Changes

- `fetch`: `--path`/`-p` → `--out`/`-o`.
- `list`: `--path`/`-p` → `--out`/`-o`.
- `export`: `--output`/`-o` → `--out`/`-o`.
- `export-all`: `--output-dir`/`-o` → `--out-dir`/`-o`.
- `new`: unchanged — `-p`/`--profile` (confirms `-p` = profile).
- The `list` `--interactive` conflict error message and its scenarios change `--path` → `--out`.
- Internal command option field names are renamed for coherence: `path`/`output`/`outputDir` → `out`/`outDir`.

## Capabilities

### Modified Capabilities

- `commands` — the `ListCommand`, `FetchCommand`, `ExportCommand`, and `ExportAllCommand` flag surfaces change as listed above. The `list` `--interactive` conflict error string changes `--path` → `--out`.
- `chat-list-browser` — the `--interactive` conflict requirement and scenarios reference `--out` instead of `--path`.

## Impact

- **Code touched**
  - `src/cli/commands/fetch-command.ts` — flag + internal `out` field rename.
  - `src/cli/commands/list-command.ts` — flag + internal `out` field rename + conflict error message.
  - `src/cli/commands/export-command.ts` — flag + internal `out` field rename.
  - `src/cli/commands/export-all-command.ts` — flag + internal `outDir` field/param rename.
- **APIs / public surface** — the four commands' CLI flags change. The short flag `-o` now uniformly means "output" everywhere; `-p` uniformly means "profile".
- **Dependencies** — none.
- **Conformance** — the non-interactive byte-equivalence contract for `gemiterm list` is untouched (only the flag *name* changes, not the output bytes). `tests/integration/commands/list.test.ts` references none of these flags and is unchanged.
- **Docs** — `README.md` flag tables/examples and the `AGENTS.md` reference example are updated.
- **In-flight change** — `chat-list-bulk-actions` (unimplemented) referenced the old `--output`/`--output-dir` spellings; its artifacts are updated to the new names so the later build is consistent.
