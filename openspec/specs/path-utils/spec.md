## Purpose

Cross-platform path resolution helpers used throughout the gemiterm infrastructure. This module centralizes how the application locates its config directory, profiles directory, per-profile storage file, and default-profile marker file, and exposes a generic `resolvePath` helper for joining and normalizing paths in an OS-correct way.

## Requirements

### Requirement: resolvePath Joins and Normalizes
The system MUST export a `resolvePath(...parts: string[])` function that joins all supplied path segments with the OS-native separator and resolves the result to an absolute path (via `path.resolve`). The function MUST correctly handle zero, one, or many segments and MUST normalize `..` and `.` segments.

#### Scenario: Multiple segments
- **WHEN** `resolvePath("foo", "bar", "baz.txt")` is called
- **THEN** the result is `path.resolve(path.join("foo", "bar", "baz.txt"))` — the joined, resolved path

#### Scenario: Single segment
- **WHEN** `resolvePath("single")` is called
- **THEN** the result is `path.resolve("single")`

#### Scenario: No segments
- **WHEN** `resolvePath()` is called with no arguments
- **THEN** the result is `path.resolve(path.join())` (i.e. resolves the current working directory)

#### Scenario: Path with .. and .
- **WHEN** `resolvePath("foo", "..", "bar")` is called
- **THEN** the result is the OS-normalized absolute path equivalent to `path.resolve(path.join("foo", "..", "bar"))`

### Requirement: getConfigDir Honors Env Override
The system MUST export a `getConfigDir()` function. The function MUST first check the `GEMITERM_CONFIG_DIR` environment variable. If the variable is set to a non-empty string, the function MUST return that string verbatim and MUST NOT consult any platform-specific code path. If the variable is unset or empty, the function MUST fall back to a platform default.

#### Scenario: Env override wins on any platform
- **WHEN** `GEMITERM_CONFIG_DIR=/override/path` and `process.platform === "win32"`
- **THEN** `getConfigDir()` returns `"/override/path"`

#### Scenario: Env override wins on Linux/macOS
- **WHEN** `GEMITERM_CONFIG_DIR=/override/path` and `process.platform === "linux"`
- **THEN** `getConfigDir()` returns `"/override/path"`

### Requirement: getConfigDir Platform Default
When `GEMITERM_CONFIG_DIR` is unset, `getConfigDir()` MUST return a platform-appropriate default: on `process.platform === "win32"` with `APPDATA` set it MUST return `<APPDATA>/gemiterm`; on Windows without `APPDATA` and on `linux` / `darwin` it MUST return `<homedir>/gemiterm` (no `.config` intermediary).

#### Scenario: Windows with APPDATA
- **WHEN** the env override is unset, `process.platform === "win32"`, and `APPDATA` is set
- **THEN** `getConfigDir()` returns `<APPDATA>/gemiterm`

#### Scenario: Windows without APPDATA
- **WHEN** the env override is unset, `process.platform === "win32"`, and `APPDATA` is not set
- **THEN** `getConfigDir()` returns `<homedir>/gemiterm`

#### Scenario: Linux
- **WHEN** the env override is unset and `process.platform === "linux"`
- **THEN** `getConfigDir()` returns `<homedir>/gemiterm`

#### Scenario: macOS
- **WHEN** the env override is unset and `process.platform === "darwin"`
- **THEN** `getConfigDir()` returns `<homedir>/gemiterm`

### Requirement: getProfilesDir
The system MUST export a `getProfilesDir()` function that returns `<configDir>/profiles`, where `configDir` is the result of `getConfigDir()`. The function MUST always return the same result on a given invocation as `path.join(getConfigDir(), "profiles")`.

#### Scenario: Profiles dir is config + /profiles
- **WHEN** `GEMITERM_CONFIG_DIR=/tmp/gemiterm`
- **THEN** `getProfilesDir()` returns `path.join("/tmp/gemiterm", "profiles")`

### Requirement: getProfilePath
The system MUST export a `getProfilePath(name: string)` function that returns `<configDir>/profiles/<name>/storage_state.json`. The function MUST interpolate the supplied name directly into the path with no additional validation.

#### Scenario: Single profile
- **WHEN** `GEMITERM_CONFIG_DIR=/tmp/gemiterm`
- **THEN** `getProfilePath("default")` returns `<configDir>/profiles/default/storage_state.json`

#### Scenario: Names with special characters
- **WHEN** `GEMITERM_CONFIG_DIR=/tmp/gemiterm`
- **THEN** `getProfilePath("my-profile")` returns `<configDir>/profiles/my-profile/storage_state.json`

### Requirement: getProfileDir
The system MUST export a `getProfileDir(name: string)` function that returns `<configDir>/profiles/<name>`. The function MUST NOT include any storage file in the returned path.

#### Scenario: Profile directory for a name
- **WHEN** `GEMITERM_CONFIG_DIR=/tmp/gemiterm`
- **THEN** `getProfileDir("work")` returns `<configDir>/profiles/work`

### Requirement: getDefaultProfileMarkerPath
The system MUST export a `getDefaultProfileMarkerPath()` function that returns `<configDir>/profiles/.default` — the path of the marker file used to record the current default profile name.

#### Scenario: Marker path
- **WHEN** `GEMITERM_CONFIG_DIR=/tmp/gemiterm`
- **THEN** `getDefaultProfileMarkerPath()` returns `<configDir>/profiles/.default`

### Requirement: Path Constants
The system MUST export three string constants: `STORAGE_STATE_FILE` (value `"storage_state.json"`), `PROFILES_DIR` (value `"profiles"`), and `DEFAULT_PROFILE_MARKER` (value `".default"`). These constants are the canonical values used by the path helpers and other modules.

#### Scenario: STORAGE_STATE_FILE
- **WHEN** the module is loaded
- **THEN** `STORAGE_STATE_FILE === "storage_state.json"`

#### Scenario: PROFILES_DIR
- **WHEN** the module is loaded
- **THEN** `PROFILES_DIR === "profiles"`

#### Scenario: DEFAULT_PROFILE_MARKER
- **WHEN** the module is loaded
- **THEN** `DEFAULT_PROFILE_MARKER === ".default"`
