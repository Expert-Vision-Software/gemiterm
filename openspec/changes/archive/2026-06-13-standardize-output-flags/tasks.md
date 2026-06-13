# Implementation tasks

## 1. Source — command parsers, options, help

- [x] 1.1 `src/cli/commands/fetch-command.ts`: rename option field `path` → `out` (interface + `DEFAULT_OPTIONS`); parser `--path`/`-p` → `--out`/`-o`; `options.out` call sites; private helper params `path` → `out`; help text `--out, -o <path>`.
- [x] 1.2 `src/cli/commands/list-command.ts`: rename option field `path` → `out`; parser `--path`/`-p` → `--out`/`-o`; `options.out` call sites + conflict check; helper params `path` → `out`; conflict error message `--path` → `--out`; help text `--out, -o <path>`.
- [x] 1.3 `src/cli/commands/export-command.ts`: rename option field `output` → `out`; parser `--output` → `--out` (keep `-o`); `options.out` references; help text `--out, -o <path>`.
- [x] 1.4 `src/cli/commands/export-all-command.ts`: rename option field `outputDir` → `outDir`; parser `--output-dir` → `--out-dir` (keep `-o`); `options.outDir` references + local `outputDir` var/params → `outDir`; help text `--out-dir, -o <dir>`. Keep the `Output:` summary label.

## 2. Tests

- [x] 2.1 `tests/integration/commands/fetch.test.ts`: `--path` → `--out`; `-p` short test → `-o`; help `toContain("--out")`.
- [x] 2.2 `tests/cli/list-command.test.ts`: conflict error string + scenario args `--path` → `--out`.
- [x] 2.3 `tests/integration/commands/export.test.ts`: `--output` → `--out` (args, describe/test titles, help `toContain`); `-o` short test unchanged.
- [x] 2.4 `tests/cli/export-all-command.test.ts`: `--output-dir` → `--out-dir` (args + help `toContain`).

## 3. Docs

- [x] 3.1 `README.md`: fetch/list `-p, --path` → `-o, --out`; fetch example `-p chat.json` → `-o chat.json`; export `-o, --output` → `-o, --out`; export-all `-o, --output-dir` → `-o, --out-dir`.
- [x] 3.2 `AGENTS.md`: example `gemiterm list --path out.txt` → `--out out.txt`.

## 4. OpenSpec alignment

- [x] 4.1 Update the in-flight `chat-list-bulk-actions` artifacts (proposal/design/tasks + delta spec) from `--output`/`--output-dir` to `--out`/`--out-dir`.

## 5. Verification

- [x] 5.1 `bun run typecheck` clean.
- [x] 5.2 `bun test` green at baseline.
- [x] 5.3 `bun run lint:mediation` (bash form) clean.
- [x] 5.4 Eyeball `fetch --help`, `list --help`, `export --help`, `export-all --help`.
