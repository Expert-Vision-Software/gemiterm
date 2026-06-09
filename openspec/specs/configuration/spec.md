## Purpose

The configuration subsystem resolves the on-disk config directory, manages the default-profile marker file, lists and mutates profile directories, and ensures the config tree exists. It encapsulates the platform-specific location of the user's gemiterm data and the `profiles/<name>/storage_state.json` layout used by storage.

## Requirements

### Requirement: Config Directory Resolution With Env Override
The system MUST resolve the config directory by checking the `GEMITERM_CONFIG_DIR` environment variable first. If that variable is set to a non-empty string, the config directory MUST be exactly that string. If the env var is unset or empty, the system MUST fall back to a platform default.

#### Scenario: Env override takes precedence
- **WHEN** `GEMITERM_CONFIG_DIR` is set to `/custom/gemiterm`
- **THEN** `getConfigDir()` returns `/custom/gemiterm` regardless of the current platform

#### Scenario: Env var empty falls back to platform default
- **WHEN** `GEMITERM_CONFIG_DIR` is unset or empty
- **THEN** `getConfigDir()` returns the platform default

### Requirement: Windows Config Path
On Windows (`process.platform === "win32"`), when the env override is not set, the system MUST use `%APPDATA%\gemiterm` (i.e. the value of the `APPDATA` environment variable joined with `"gemiterm"`).

#### Scenario: Windows with APPDATA
- **WHEN** `process.platform === "win32"` and `APPDATA` is set to `C:\Users\test\AppData\Roaming`
- **THEN** `getConfigDir()` returns `C:\Users\test\AppData\Roaming\gemiterm`

#### Scenario: Windows without APPDATA falls back to homedir
- **WHEN** `process.platform === "win32"` and `APPDATA` is not set
- **THEN** `getConfigDir()` returns `<homedir>/gemiterm` (the Linux/macOS-style default)

### Requirement: Linux and macOS Config Path
On Linux and macOS (`process.platform` is `"linux"` or `"darwin"`), when the env override is not set, the system MUST use `~/gemiterm` (i.e. `<homedir>/gemiterm`; no `.config` intermediary).

#### Scenario: Linux platform
- **WHEN** `process.platform === "linux"` and the env override is not set
- **THEN** `getConfigDir()` returns `<homedir>/gemiterm`

#### Scenario: macOS platform
- **WHEN** `process.platform === "darwin"` and the env override is not set
- **THEN** `getConfigDir()` returns `<homedir>/gemiterm`

### Requirement: Profiles Subdirectory Layout
The system MUST expose a `getProfilesDir()` function that returns `<configDir>/profiles`. The profiles subdirectory is the parent of every per-profile directory.

#### Scenario: Profiles dir under config
- **WHEN** the config dir is `/x/gemiterm`
- **THEN** `getProfilesDir()` returns `/x/gemiterm/profiles`

### Requirement: Storage State File Path
The system MUST expose a `getProfilePath(name)` function that returns `<profilesDir>/<name>/storage_state.json`. The filename `storage_state.json` is the canonical file inside each profile directory that holds the cookie JSON.

#### Scenario: Profile path for a single profile
- **WHEN** the config dir is `/x/gemiterm`
- **THEN** `getProfilePath("work")` returns `/x/gemiterm/profiles/work/storage_state.json`

### Requirement: Default Profile Marker File
The system MUST use the file name `.default` (the value of the exported `DEFAULT_PROFILE_MARKER` constant) inside the profiles directory to record the current default profile name. The full marker path is `<profilesDir>/.default` and is exposed via `getDefaultProfileMarkerPath()`. The file content MUST be the default profile name as a plain text string.

#### Scenario: Marker path
- **WHEN** the config dir is `/x/gemiterm`
- **THEN** `getDefaultProfileMarkerPath()` returns `/x/gemiterm/profiles/.default`

### Requirement: Default Profile Name Resolution
The system MUST expose a `getDefaultProfileName()` function that returns the contents of the marker file (trimmed) when the file exists, and MUST return the literal string `"default"` when the marker file does not exist.

#### Scenario: No marker file returns 'default'
- **WHEN** the marker file does not exist on disk
- **THEN** `getDefaultProfileName()` returns `"default"`

#### Scenario: Marker file present returns its content
- **WHEN** the marker file contains the trimmed text `work`
- **THEN** `getDefaultProfileName()` returns `"work"`

#### Scenario: Marker file whitespace is trimmed
- **WHEN** the marker file contains `"  my-profile  \n"`
- **THEN** `getDefaultProfileName()` returns `"my-profile"`

### Requirement: Set Default Profile Name
The system MUST expose a `setDefaultProfileName(name)` function that creates the profiles directory if missing and writes the supplied `name` to the marker file, overwriting any prior value.

#### Scenario: Set a new default
- **WHEN** `setDefaultProfileName("personal")` is called
- **THEN** the marker file exists at `<profilesDir>/.default` and its content is the string `"personal"`

#### Scenario: Set creates the profiles directory
- **WHEN** `setDefaultProfileName("work")` is called and `<configDir>/profiles` does not exist
- **THEN** the function creates the profiles directory as a side effect

#### Scenario: Set overwrites the previous default
- **WHEN** the marker already contains `"first"` and `setDefaultProfileName("second")` is called
- **THEN** `getDefaultProfileName()` returns `"second"`

### Requirement: List Profiles
The system MUST expose a `listProfiles()` function that returns the names of all profile directories in the profiles directory, sorted alphabetically. The function MUST exclude the `.default` marker file and MUST exclude any non-directory entry. If the profiles directory does not exist, the function MUST return an empty array.

#### Scenario: Empty when profiles dir is missing
- **WHEN** the profiles directory does not exist
- **THEN** `listProfiles()` returns `[]`

#### Scenario: Empty when profiles dir is empty
- **WHEN** the profiles directory exists but is empty
- **THEN** `listProfiles()` returns `[]`

#### Scenario: Sorted list of profile directories
- **WHEN** the profiles directory contains subdirectories `charlie`, `alpha`, and `bravo`
- **THEN** `listProfiles()` returns `["alpha", "bravo", "charlie"]`

#### Scenario: Excludes the .default marker
- **WHEN** the profiles directory contains `work`, `personal`, and a `.default` file
- **THEN** `listProfiles()` returns `["personal", "work"]`

#### Scenario: Excludes non-directory entries
- **WHEN** the profiles directory contains `valid-profile` (directory) and `not-a-profile.txt` (file)
- **THEN** `listProfiles()` returns `["valid-profile"]`

### Requirement: Ensure Config Directory
The system MUST expose an `ensureConfigDir()` function that creates the config directory and the profiles subdirectory (both with `recursive: true`) and returns the config directory path. The function MUST be idempotent — calling it when the directories already exist MUST NOT throw.

#### Scenario: Creates both directories
- **WHEN** neither the config dir nor the profiles dir exist
- **THEN** calling `ensureConfigDir()` creates both and returns the config directory path

#### Scenario: Idempotent
- **WHEN** the config dir and profiles dir already exist
- **THEN** calling `ensureConfigDir()` does not throw and returns the config directory path

### Requirement: Exported Configuration API Surface
The system MUST export the following functions from `src/infrastructure/config.ts`: `getConfigDir`, `getProfilesDir`, `getProfilePath`, `getDefaultProfileName`, `setDefaultProfileName`, `listProfiles`, and `ensureConfigDir`. These functions form the complete public surface for profile marker management and config directory handling at this layer.

#### Scenario: All functions importable
- **WHEN** a consumer imports any of the seven exported function names from `src/infrastructure/config.ts`
- **THEN** the import resolves to a callable function
