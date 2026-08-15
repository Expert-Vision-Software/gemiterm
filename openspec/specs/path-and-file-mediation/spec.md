## Purpose

This spec defines the **path-and-file mediation layer** for the GemiTerm Bun rewrite. Its success criterion is:

> **No file in `src/` (other than the allowed exemptions) imports from `node:fs`, `node:path`, or `node:os` directly. All file-system and path operations route through `src/infrastructure/path-utils.ts` (path values) and `src/infrastructure/io.ts` (file-system side effects).**

A CI lint check (added in `release-pipeline/spec.md` §CI Test Job) enforces this rule on every PR.

The only allowed `node:fs` / `node:path` / `node:os` consumers in `src/` are:

- `src/infrastructure/path-utils.ts` — the canonical home for all path-related code.
- `src/services/install-browser-service.ts` — keeps a `node:path` import for the WSL `9p`/`drvfs` mount parser, which is inherently Unix-specific and not a general-purpose cross-platform concern.

---

## Requirements

### Requirement: `path-utils.ts` is the only path value source in `src/`

The system MUST provide `src/infrastructure/path-utils.ts` as the canonical home for all path-related functions and constants. No other source file in `src/` MAY import from `node:path` or `node:os` directly. The only allowed `node:path` consumer in `src/` is `src/services/install-browser-service.ts`, which uses `join` and `sep` for the WSL mount parser.

The `path-utils.ts` module MUST export the existing 9 symbols (the 6 path functions: `resolvePath`, `getConfigDir`, `getProfilesDir`, `getProfilePath`, `getProfileDir`, `getDefaultProfileMarkerPath`; plus 3 constants: `STORAGE_STATE_FILE`, `PROFILES_DIR`, `DEFAULT_PROFILE_MARKER`).

#### Scenario: A new src/ file wants to build a path

- **WHEN** a developer needs to build a path inside `src/`
- **THEN** they MUST use one of the exported functions from `path-utils.ts` (e.g. `join(getProfileDir(name), "subdir")` is fine, but `join` from `node:path` is not)

#### Scenario: An existing src/ file is audited

- **WHEN** the CI lint check runs over `src/`
- **THEN** the only matches for `from "node:path"` or `from "node:os"` are `src/infrastructure/path-utils.ts` and `src/services/install-browser-service.ts`

### Requirement: `io.ts` is the only file-system operation source in `src/`

The system MUST provide `src/infrastructure/io.ts` as the canonical home for all file-system operations. No other source file in `src/` MAY import from `node:fs` or `node:fs/promises` directly. The CI lint check enforces this rule.

The `io.ts` module MUST export the following 13 functions plus one error class: `ensureDir`, `existsFile`, `readTextFile`, `safeReadTextFile`, `writeTextFile`, `readJsonFile`, `writeJsonFile`, `removeDir`, `removeFile`, `renameDir`, `isDirectory`, `listSubdirectories`, `getFileMtime`, and `IOError`. Every exported function MUST be `async` and return a `Promise` of its previous sync return type. Implementations MUST be backed by `node:fs/promises` (never the `*Sync` variants). Error wrapping semantics (`IOError` with `cause`) and observable behavior (messages, safe-return defaults, parent-dir creation on writes) MUST be identical to the sync versions.

#### Scenario: A new src/ file wants to read a file

- **WHEN** a developer needs to read a file inside `src/`
- **THEN** they MUST use `await readTextFile` or `await readJsonFile` from `io.ts`, never `readFileSync` or `readFile` from `node:fs`

#### Scenario: A new src/ file wants to write a file

- **WHEN** a developer needs to write a file inside `src/`
- **THEN** they MUST use `await writeTextFile` or `await writeJsonFile` from `io.ts`, which creates the parent directory if it does not exist, never `writeFileSync` from `node:fs`

#### Scenario: A new src/ file wants to check file existence

- **WHEN** a developer needs to check whether a file or directory exists
- **THEN** they MUST use `await existsFile` from `io.ts`, never `existsSync` from `node:fs`

#### Scenario: Every io.ts function returns a Promise

- **WHEN** the exported function signatures of `io.ts` are inspected
- **THEN** every function is declared `async` and no function calls a `*Sync` `node:fs` API

### Requirement: `isWSL()` detects WSL via `/proc/version` or `WSL_DISTRO_NAME`

The system MUST provide `isWSL(): Promise<boolean>` in `src/infrastructure/path-utils.ts`. The function MUST return `false` (resolved) on any platform other than Linux. On Linux, it MUST resolve `true` if either:

- `/proc/version` exists and contains the substring `microsoft` or `WSL` (case-insensitive), OR
- the `WSL_DISTRO_NAME` environment variable is set and non-empty.

If neither condition holds, the function MUST resolve `false`.

#### Scenario: WSL detected via `/proc/version`

- **WHEN** `process.platform === "linux"` and `/proc/version` contains the substring `microsoft`
- **THEN** `await isWSL()` resolves `true`

#### Scenario: WSL detected via `WSL_DISTRO_NAME`

- **WHEN** `process.platform === "linux"` and `WSL_DISTRO_NAME` is set to any non-empty string
- **THEN** `await isWSL()` resolves `true` even if `/proc/version` does not contain the `microsoft` substring

#### Scenario: Native Linux returns false

- **WHEN** `process.platform === "linux"` and neither `/proc/version` contains `microsoft` or `WSL` nor `WSL_DISTRO_NAME` is set
- **THEN** `await isWSL()` resolves `false`

#### Scenario: macOS or Windows returns false

- **WHEN** `process.platform` is `"darwin"` or `"win32"`
- **THEN** `await isWSL()` resolves `false` regardless of `/proc/version` or environment variable contents

### Requirement: `getProjectRoot()` finds the repository root from `import.meta.url`

The system MUST provide `getProjectRoot(importMetaUrl?: string): Promise<string>` in `src/infrastructure/path-utils.ts`. The function MUST walk up from the caller (or the provided `import.meta.url`) until it finds a directory containing `package.json`, then return the absolute path (resolved). The function MUST reject with `IOError` if no `package.json` is found in any parent directory.

#### Scenario: Called from a file in the repo

- **WHEN** `await getProjectRoot()` is called from any file under the repository root
- **THEN** it resolves the absolute path of the repository root (the directory containing `package.json`)

#### Scenario: Called with no `package.json` ancestors

- **WHEN** `await getProjectRoot()` is called from a file that has no `package.json` in any parent directory
- **THEN** it rejects with an `IOError` with a message indicating the walk completed without finding `package.json`

### Requirement: `getPackageJson()` reads and parses `package.json`

The system MUST provide `getPackageJson(): Promise<{ name: string; version: string; [key: string]: unknown }>` in `src/infrastructure/path-utils.ts`. The function MUST call `getProjectRoot(importMetaUrl)`, read `<root>/package.json` as UTF-8, parse it as JSON, and return the parsed object (resolved). On any error (file missing, file unparseable, no `package.json` ancestor), the function MUST resolve `{ name: "gemiterm", version: "unknown" }` as a fallback (it MUST NOT reject). The build-time `__GEMITERM_VERSION__` constant-folding fast path MUST be preserved and MUST NOT touch the filesystem.

#### Scenario: Normal call

- **WHEN** `await getPackageJson()` is called from a file under the repository root
- **THEN** it resolves the parsed `package.json` object, with `name === "gemiterm"` and `version` equal to the repo's current `package.json` version

#### Scenario: `package.json` missing or unparseable

- **WHEN** the resolved `package.json` does not exist or is unparseable JSON
- **THEN** `await getPackageJson()` resolves the fallback object `{ name: "gemiterm", version: "unknown" }`

### Requirement: `writeTextFile` consolidates the 4-copy "resolve + mkdir + write" block

The system MUST provide `writeTextFile(path: string, content: string): Promise<void>` in `src/infrastructure/io.ts`. The function MUST resolve `path` to an absolute path, ensure the parent directory exists (recursively), and write `content` as UTF-8. The function MUST reject with `IOError` on EACCES, ENOSPC, or any other write error.

#### Scenario: Writing a new file to an existing directory

- **WHEN** `await writeTextFile("/tmp/gemiterm-test/output.md", "# Hello")` is called and `/tmp/gemiterm-test` exists
- **THEN** the file `/tmp/gemiterm-test/output.md` is created with the content `# Hello`

#### Scenario: Writing a new file to a nested non-existent directory

- **WHEN** `await writeTextFile("/tmp/gemiterm-test/nested/dir/output.md", "# Hello")` is called and neither `/tmp/gemiterm-test/nested` nor `/tmp/gemiterm-test/nested/dir` exist
- **THEN** both directories are created recursively, and the file is written

### Requirement: `readJsonFile` and `writeJsonFile` provide typed JSON I/O

The system MUST provide `readJsonFile<T>(path: string): Promise<T>` and `writeJsonFile(path: string, data: unknown): Promise<void>` in `src/infrastructure/io.ts`. `readJsonFile` MUST read the file as UTF-8, parse it as JSON, and cast the result to `T` (resolved). `writeJsonFile` MUST serialize `data` with `JSON.stringify(data, null, 2)` and write it via `writeTextFile`. Both functions MUST reject with `IOError` (with a `cause` field for the original error) on any failure.

#### Scenario: Round-trip a JSON object

- **WHEN** a developer writes an object via `await writeJsonFile(path, obj)` and reads it back via `await readJsonFile<typeof obj>(path)`
- **THEN** the deep-equal comparison of the two values is true

#### Scenario: `readJsonFile` on a missing file

- **WHEN** `await readJsonFile` is called with a path that does not exist
- **THEN** it rejects with `IOError` whose `cause` is the underlying `ENOENT` error

#### Scenario: `readJsonFile` on unparseable content

- **WHEN** `await readJsonFile` is called with a path whose content is not valid JSON
- **THEN** it rejects with `IOError` whose `cause` is the underlying `SyntaxError`

### Requirement: `safeReadTextFile` returns `""` on any error

The system MUST provide `safeReadTextFile(path: string): Promise<string>` in `src/infrastructure/io.ts`. The function MUST read the file as UTF-8 and resolve the content; on any error (ENOENT, EACCES, EISDIR), it MUST resolve the empty string `""` (it MUST NOT reject). The function MUST include a JSDoc comment noting that the `""` return conflates "file does not exist" with "file exists but is empty" and is appropriate for callers that only need a string for `.includes()` / `.trim()` checks.

#### Scenario: Reading an existing file

- **WHEN** `await safeReadTextFile` is called with a path that exists
- **THEN** it resolves the file's content

#### Scenario: Reading a missing file

- **WHEN** `await safeReadTextFile` is called with a path that does not exist
- **THEN** it resolves `""` and does not reject

#### Scenario: Code comment is present

- **WHEN** the source of `safeReadTextFile` is inspected
- **THEN** the JSDoc comment is present and explicitly notes the `""` return and its implication

### Requirement: `ensureDir`, `removeDir`, `renameDir`, `isDirectory`, `listSubdirectories` provide safe file-system access

The system MUST provide the following 5 async functions in `src/infrastructure/io.ts`:

- `ensureDir(path: string): Promise<void>` — calls `mkdir(path, { recursive: true })` from `node:fs/promises`. Rejects with `IOError` on EACCES, EPERM, EROFS, or any other error.
- `removeDir(path: string): Promise<void>` — calls `rm(path, { recursive: true, force: true })`. The `force: true` flag means the function is a no-op if the path does not exist. Rejects with `IOError` on EACCES, EBUSY, or any other error.
- `renameDir(src: string, dest: string): Promise<void>` — calls `rename`. Rejects with `IOError` with a clear message on ENOENT (source missing) or EEXIST (destination present).
- `isDirectory(path: string): Promise<boolean>` — resolves `true` if the stat succeeds and the target is a directory; resolves `false` on any error (including ENOENT).
- `listSubdirectories(path: string): Promise<string[]>` — reads the directory and resolves the names of immediate subdirectories only. Resolves `[]` if the path does not exist. The `.default` marker file (or any other non-directory entry) is excluded.

#### Scenario: `ensureDir` creates nested directories

- **WHEN** `await ensureDir("/tmp/a/b/c")` is called and `/tmp/a` does not exist
- **THEN** `/tmp/a`, `/tmp/a/b`, and `/tmp/a/b/c` are all created

#### Scenario: `removeDir` is a no-op on missing path

- **WHEN** `await removeDir("/tmp/nonexistent")` is called
- **THEN** no error is thrown and the promise resolves

#### Scenario: `renameDir` throws on missing source

- **WHEN** `await renameDir("/tmp/nope", "/tmp/dest")` is called and `/tmp/nope` does not exist
- **THEN** the promise rejects with `IOError` with a message that includes the source path

#### Scenario: `listSubdirectories` excludes the marker file

- **WHEN** `await listSubdirectories` is called on a profile directory containing both subdirectories and a `.default` marker file
- **THEN** the resolved array contains only the subdirectory names; `.default` is excluded

### Requirement: `IOError` provides structured error context

The system MUST export an `IOError` class from `src/infrastructure/io.ts` that extends `Error` and includes a `cause` field (of type `Error | undefined`) for the original error. All other functions in `io.ts` MUST throw `IOError` (with a populated `cause` when the original error is available) rather than raw `Error` or re-throwing the original error.

#### Scenario: `IOError` carries a cause

- **WHEN** a function in `io.ts` catches an `ENOENT` error from `node:fs` and re-throws as `IOError`
- **THEN** the `IOError.cause` field is the original `ENOENT` error

#### Scenario: Error name is set

- **WHEN** an `IOError` is constructed
- **THEN** its `name` field is `"IOError"` (so `error.name === "IOError"` is true)

### Requirement: `install-browser-service` is the only WSL-detection consumer

The system MUST refactor `src/services/install-browser-service.ts` to:

- import `isWSL` from `path-utils.ts` and delete the private `isWsl()` method.
- import `existsFile` and `safeReadTextFile` from `io.ts` and delete the private `readFileSafe` helper.
- unify `getEdgePaths()` and `getChromePaths()` behind a single local `getWindowsKnownDirs()` helper.

The 5 unit tests in `tests/services/install-browser-service.test.ts` MUST continue to pass without modification; the 432/432 baseline MUST be maintained.

#### Scenario: `isWsl()` private method is gone

- **WHEN** `src/services/install-browser-service.ts` is inspected
- **THEN** the file does not define a private `isWsl()` method

#### Scenario: `isWSL()` is the only WSL detection source

- **WHEN** the rewrite needs to check whether it is running under WSL
- **THEN** the check is made via the shared `isWSL()` from `path-utils.ts`, not via inline `/proc/version` reads

#### Scenario: `getEdgePaths` and `getChromePaths` are unified

- **WHEN** `src/services/install-browser-service.ts` is inspected
- **THEN** both methods are short (≤5 lines each) and delegate path construction to a shared `getWindowsKnownDirs()` helper

### Requirement: `storage.ts` and `config.ts` route all file access through `io.ts`

The system MUST keep `src/infrastructure/storage.ts` and `src/infrastructure/config.ts` importing from `./io.ts` only — neither file MAY import from `node:fs` or `node:path` directly. As part of the async-first conversion, both modules' IO-bound functions become `async` and `await` the `io.ts` surface.

The unit tests in `tests/infrastructure/storage.test.ts` and `tests/unit/config.test.ts` MUST continue to pass after being updated to `await` the converted surfaces (test assertions and fixture semantics are otherwise unchanged).

#### Scenario: `storage.ts` has no `node:fs` import

- **WHEN** `src/infrastructure/storage.ts` is inspected
- **THEN** the file does not contain `from "node:fs"`

#### Scenario: `config.ts` has no `node:fs` or `node:path` import

- **WHEN** `src/infrastructure/config.ts` is inspected
- **THEN** the file does not contain `from "node:fs"` or `from "node:path"`

#### Scenario: `storage.ts` tests still pass

- **WHEN** `bun test tests/infrastructure/storage.test.ts` is run after the conversion
- **THEN** all tests pass

#### Scenario: `config.ts` tests still pass

- **WHEN** `bun test tests/unit/config.test.ts` is run after the conversion
- **THEN** all tests pass

### Requirement: 4 export commands use `writeTextFile`

The system MUST refactor `src/cli/commands/export-command.ts`, `export-all-command.ts`, `list-command.ts`, and `fetch-command.ts` so that each file uses `writeTextFile` and `ensureDir` from `io.ts` instead of inline `node:fs` operations. After the refactor, none of the 4 files MUST import from `node:fs` or `node:path` directly. The integration tests in `tests/integration/commands/{export,list,fetch}.test.ts` and `tests/cli/export-all-command.test.ts` MUST continue to pass without modification.

#### Scenario: `export-command.ts` uses `writeTextFile`

- **WHEN** `src/cli/commands/export-command.ts` is inspected
- **THEN** the file imports `writeTextFile` from `../../infrastructure/io.ts` and does not import from `node:fs` or `node:path`

#### Scenario: `export-all-command.ts` uses `writeTextFile` and `ensureDir`

- **WHEN** `src/cli/commands/export-all-command.ts` is inspected
- **THEN** the file imports `writeTextFile` and `ensureDir` from `../../infrastructure/io.ts` and does not import from `node:fs` or `node:path`

#### Scenario: `list-command.ts` and `fetch-command.ts` have a 2-line `writeOutput`

- **WHEN** `src/cli/commands/list-command.ts` and `src/cli/commands/fetch-command.ts` are inspected
- **THEN** the `writeOutput` private method in each is 2 lines (a `writeTextFile` call and a `console.log`)

#### Scenario: Integration tests still pass

- **WHEN** `bun test tests/integration/commands/{export,list,fetch}.test.ts tests/cli/export-all-command.test.ts` is run after the refactor
- **THEN** all tests pass

### Requirement: `cli/index.ts` uses `getPackageJson()`

The system MUST refactor `src/cli/index.ts` to import `getPackageJson` from `src/infrastructure/path-utils.ts` and remove the inline `fileURLToPath` / `__dirname` / `readFileSync` / `JSON.parse` sequence at lines 33-35. After the refactor, `src/cli/index.ts` MUST NOT import from `node:fs`, `node:path`, or `node:url`. The `--version` flag MUST continue to print `2.0.0`; the smoke test in `tests/smoke/smoke.test.ts` is the regression gate.

#### Scenario: `cli/index.ts` has no `node:fs` / `node:path` / `node:url` import

- **WHEN** `src/cli/index.ts` is inspected
- **THEN** the file does not contain `from "node:fs"`, `from "node:path"`, or `from "node:url"`

#### Scenario: `--version` still prints `2.0.0`

- **WHEN** `gemiterm --version` is run
- **THEN** the output includes the string `2.0.0`

### Requirement: CI lint check fails the build on a forbidden import

The system MUST add a step to `.github/workflows/test.yml` that runs the following command and fails the workflow if the command exits non-zero:

```bash
! grep -rn --include='*.ts' "from \"node:\\(fs\\|path\\|os\\)\"" src/ \
  | grep -v "src/infrastructure/path-utils.ts" \
  | grep -v "src/services/install-browser-service.ts" \
  | grep -q .
```

The check MUST exclude `src/infrastructure/path-utils.ts` (the canonical home) and `src/services/install-browser-service.ts` (the only legitimate cross-platform `node:path` consumer). The check MUST NOT exclude any other file.

#### Scenario: A new src/ file imports from `node:fs`

- **WHEN** a contributor adds `import { readFileSync } from "node:fs";` to a new file `src/services/foo.ts` and opens a PR
- **THEN** the `test.yml` workflow's "Enforce path-utils mediation" step exits non-zero and the PR cannot be merged

#### Scenario: A new src/ file imports from `node:path`

- **WHEN** a contributor adds `import { join } from "node:path";` to `src/services/foo.ts`
- **THEN** the workflow fails with a clear error message naming the file

#### Scenario: A new src/ file imports from `node:os`

- **WHEN** a contributor adds `import { homedir } from "node:os";` to `src/services/foo.ts`
- **THEN** the workflow fails

#### Scenario: The two allowed files are exempt

- **WHEN** the check is run and the only matches are in `src/infrastructure/path-utils.ts` and `src/services/install-browser-service.ts`
- **THEN** the check exits 0 (success)

#### Scenario: Tests directory is out of scope

- **WHEN** the check is run and a test file in `tests/` imports from `node:fs`
- **THEN** the check is unaffected (it scans `src/` only)