## ADDED Requirements

### Requirement: Detect Windows
The system MUST provide an `isWindows()` function that returns `true` if and only if `process.platform === 'win32'`, and `false` otherwise.

#### Scenario: Windows platform returns true
- **WHEN** the current process has `process.platform === 'win32'`
- **THEN** `isWindows()` returns `true`

#### Scenario: Linux platform returns false
- **WHEN** the current process has `process.platform === 'linux'`
- **THEN** `isWindows()` returns `false`

#### Scenario: macOS platform returns false
- **WHEN** the current process has `process.platform === 'darwin'`
- **THEN** `isWindows()` returns `false`

### Requirement: Detect Linux
The system MUST provide an `isLinux()` function that returns `true` if and only if `process.platform === 'linux'` AND the process is NOT running inside WSL, and `false` otherwise.

#### Scenario: Native Linux returns true
- **WHEN** the current process has `process.platform === 'linux'` and is not running inside WSL
- **THEN** `isLinux()` returns `true`

#### Scenario: WSL returns false
- **WHEN** the current process has `process.platform === 'linux'` and IS running inside WSL
- **THEN** `isLinux()` returns `false` (WSL is reported separately via `isWSL()`)

#### Scenario: macOS returns false
- **WHEN** the current process has `process.platform === 'darwin'`
- **THEN** `isLinux()` returns `false`

### Requirement: Detect WSL
The system MUST provide an `isWSL()` function that returns `true` if and only if `process.platform === 'linux'` AND at least one of the following is true: (a) `/proc/version` exists and its contents contain the substring `microsoft` (case-insensitive) or `WSL`, OR (b) the `WSL_DISTRO_NAME` environment variable is set and non-empty. The function MUST return `false` on any other platform, including native Linux where neither condition holds.

#### Scenario: WSL1 or WSL2 detected via /proc/version
- **WHEN** the current process has `process.platform === 'linux'` AND `/proc/version` contains the substring `microsoft` (for example on WSL1 or WSL2)
- **THEN** `isWSL()` returns `true`

#### Scenario: WSL detected via WSL_DISTRO_NAME env var
- **WHEN** the current process has `process.platform === 'linux'` AND the `WSL_DISTRO_NAME` environment variable is set and non-empty
- **THEN** `isWSL()` returns `true` even if `/proc/version` does not contain the `microsoft` substring

#### Scenario: Native Linux returns false
- **WHEN** the current process has `process.platform === 'linux'` AND neither `/proc/version` contains `microsoft` or `WSL` NOR `WSL_DISTRO_NAME` is set
- **THEN** `isWSL()` returns `false`

#### Scenario: macOS returns false
- **WHEN** the current process has `process.platform === 'darwin'`
- **THEN** `isWSL()` returns `false` regardless of `/proc/version` or environment variable contents

### Requirement: Detect macOS (Darwin)
The system MUST provide an `isDarwin()` function that returns `true` if and only if `process.platform === 'darwin'`, and `false` otherwise.

#### Scenario: macOS returns true
- **WHEN** the current process has `process.platform === 'darwin'`
- **THEN** `isDarwin()` returns `true`

#### Scenario: Linux returns false
- **WHEN** the current process has `process.platform === 'linux'`
- **THEN** `isDarwin()` returns `false`

### Requirement: Unified Platform Name
The system MUST provide a `detectPlatform()` function that returns the string `'windows'` if `isWindows()` is true, `'wsl'` if `isWSL()` is true, `'linux'` if `isLinux()` is true, or `'darwin'` if `isDarwin()` is true. If none of these match (an unknown platform), the function MUST return `'linux'` as the safe default.

#### Scenario: Windows returns 'windows'
- **WHEN** the current process has `process.platform === 'win32'`
- **THEN** `detectPlatform()` returns the string `'windows'`

#### Scenario: WSL returns 'wsl' (not 'linux')
- **WHEN** the current process has `process.platform === 'linux'` AND is running inside WSL
- **THEN** `detectPlatform()` returns the string `'wsl'`

#### Scenario: Native Linux returns 'linux'
- **WHEN** the current process has `process.platform === 'linux'` and is not running inside WSL
- **THEN** `detectPlatform()` returns the string `'linux'`

#### Scenario: macOS returns 'darwin'
- **WHEN** the current process has `process.platform === 'darwin'`
- **THEN** `detectPlatform()` returns the string `'darwin'`

#### Scenario: Unknown platform falls back to 'linux'
- **WHEN** the current process has an unrecognized `process.platform` (for example `'freebsd'`)
- **THEN** `detectPlatform()` returns the string `'linux'` as the safe default

### Requirement: Path Normalization Helper
The system MUST provide a `normalizePath(input: string): string` function that returns a forward-slash separated path on Windows (for display purposes) and the input path unchanged (native separators) on Linux and macOS. The function MUST NOT throw on empty or whitespace-only input and MUST return the input unchanged in that case.

#### Scenario: Windows input is converted to forward slashes for display
- **WHEN** `normalizePath` is called with a Windows-style path such as `C:\Users\foo\bar`
- **THEN** the returned string uses forward slashes, for example `C:/Users/foo/bar`

#### Scenario: Linux input is returned unchanged
- **WHEN** `normalizePath` is called with a Linux-style path such as `/home/foo/bar`
- **THEN** the returned string is identical to the input (the forward slashes are already native)

#### Scenario: macOS input is returned unchanged
- **WHEN** `normalizePath` is called with a macOS-style path such as `/Users/foo/bar`
- **THEN** the returned string is identical to the input

#### Scenario: Empty input is returned unchanged
- **WHEN** `normalizePath` is called with an empty string
- **THEN** the returned string is the empty string and the function does not throw

### Requirement: Backwards-Compatible Re-Exports In path-utils
The system MUST re-export `isWindows`, `isLinux`, `isWSL`, `isDarwin`, `detectPlatform`, `getPlatformName`, and `normalizePath` from `src/infrastructure/path-utils.ts` so that existing import statements in the codebase continue to resolve. Importing any of these names from `path-utils.ts` MUST resolve to the corresponding export from the new `src/infrastructure/platform-detect.ts` module.

#### Scenario: Existing import resolves to the new module
- **WHEN** a source file imports `isWindows` from `../infrastructure/path-utils.ts` (or any equivalent relative path)
- **THEN** the import resolves at compile time to the `isWindows` export of the shared `platform-detect.ts` module and the imported function returns the same value as calling `isWindows` directly from `platform-detect.ts`

#### Scenario: Existing path-utils unit tests still pass
- **WHEN** `bun test tests/unit/path-utils.test.ts` is executed
- **THEN** all existing test cases (19 unit tests covering constants, `resolvePath`, `getConfigDir`, `getProfilesDir`, `getProfilePath`, `getProfileDir`, and `getDefaultProfileMarkerPath`) continue to pass
