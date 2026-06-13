## Context

`-o` is already the short flag for output on `export` (`--output/-o`) and `export-all` (`--output-dir/-o`). Extending `-o` to `fetch` and `list` makes the short flag uniform. The long name `--out` is shorter than `--output` and unambiguous; `--out-dir` parallels it for the directory case.

## Goals / Non-Goals

- **Goal:** one short flag (`-o`) for all output-to-path concepts; reserve `-p` for profile.
- **Goal:** consistent long names (`--out`, `--out-dir`).
- **Non-goal:** backward-compatible aliases. v2.0.0 is a clean break; adding deprecation plumbing for flags that shipped days ago adds complexity for no real users.

## Decisions

- **Hard-remove over alias.** No `--path`/`--output` hidden aliases. Keeps the parsers and help text simple and matches the v2.0.0 posture.
- **Rename internal option fields.** The `FetchCommandOptions.path` / `ExportCommandOptions.output` / `ExportAllCommandOptions.outputDir` fields and their private helper parameters are renamed to `out` / `outDir` so the code reads consistently with the flags. These are internal; no public API impact.
- **Keep the `Output:` summary label.** `export-all`'s `printSummary` prints a report line `Output: <dir>`. That is a generic summary label, not a flag name, and is left unchanged.
- **Committed specs lag until archive.** Per OpenSpec flow, the committed `specs/commands/spec.md` and `specs/chat-list-browser/spec.md` keep the old flag names until this change is archived (the delta in this change carries the new state).

## Risks / Trade-offs

- **Breaking flag renames** — any script using `gemiterm fetch -p` / `list --path` / `export --output` / `export-all --output-dir` breaks. Acceptable at v2.0.0; documented in the help text and README.
- **In-flight change dependency** — `chat-list-bulk-actions` must adopt the new names, otherwise its later implementation would re-introduce the inconsistency. Handled in this change.
