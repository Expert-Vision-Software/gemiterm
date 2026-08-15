# Delta: configuration (async-first-codebase)

The path-resolution functions (`getConfigDir`, `getProfilesDir`, `getProfilePath`, `getDefaultProfileMarkerPath`) remain synchronous pure string builders. The IO-bound functions become `async`. Resolution rules are otherwise unchanged.

## MODIFIED Requirements

### Requirement: Default Profile Name Resolution
The system MUST expose an async `getDefaultProfileName(): Promise<string>` function that resolves the contents of the marker file (trimmed) when the file exists, and MUST resolve the literal string `"default"` when the marker file does not exist.

#### Scenario: No marker file returns 'default'
- **WHEN** the marker file does not exist on disk
- **THEN** `await getDefaultProfileName()` resolves `"default"`

#### Scenario: Marker file present returns its content
- **WHEN** the marker file contains the trimmed text `work`
- **THEN** `await getDefaultProfileName()` resolves `"work"`

#### Scenario: Marker file whitespace is trimmed
- **WHEN** the marker file contains `"  my-profile  \n"`
- **THEN** `await getDefaultProfileName()` resolves `"my-profile"`

### Requirement: Set Default Profile Name
The system MUST expose an async `setDefaultProfileName(name): Promise<void>` function that creates the profiles directory if missing and writes the supplied `name` to the marker file, overwriting any prior value.

#### Scenario: Set a new default
- **WHEN** `await setDefaultProfileName("personal")` is called
- **THEN** the marker file exists at `<profilesDir>/.default` and its content is the string `"personal"`

#### Scenario: Set creates the profiles directory
- **WHEN** `await setDefaultProfileName("work")` is called and `<configDir>/profiles` does not exist
- **THEN** the function creates the profiles directory as a side effect

#### Scenario: Set overwrites the previous default
- **WHEN** the marker already contains `"first"` and `await setDefaultProfileName("second")` is called
- **THEN** `await getDefaultProfileName()` resolves `"second"`

### Requirement: List Profiles
The system MUST expose an async `listProfiles(): Promise<string[]>` function that resolves the names of all profile directories in the profiles directory, sorted alphabetically. The function MUST exclude the `.default` marker file and MUST exclude any non-directory entry. If the profiles directory does not exist, the function MUST resolve an empty array.

#### Scenario: Empty when profiles dir is missing
- **WHEN** the profiles directory does not exist
- **THEN** `await listProfiles()` resolves `[]`

#### Scenario: Empty when profiles dir is empty
- **WHEN** the profiles directory exists but is empty
- **THEN** `await listProfiles()` resolves `[]`

#### Scenario: Sorted list of profile directories
- **WHEN** the profiles directory contains subdirectories `charlie`, `alpha`, and `bravo`
- **THEN** `await listProfiles()` resolves `["alpha", "bravo", "charlie"]`

#### Scenario: Excludes the .default marker
- **WHEN** the profiles directory contains `work`, `personal`, and a `.default` file
- **THEN** `await listProfiles()` resolves `["personal", "work"]`

#### Scenario: Excludes non-directory entries
- **WHEN** the profiles directory contains `valid-profile` (directory) and `not-a-profile.txt` (file)
- **THEN** `await listProfiles()` resolves `["valid-profile"]`

### Requirement: Ensure Config Directory
The system MUST expose an async `ensureConfigDir(): Promise<string>` function that creates the config directory and the profiles subdirectory (both with `recursive: true`) and resolves the config directory path. The function MUST be idempotent — calling it when the directories already exist MUST NOT reject.

#### Scenario: Creates both directories
- **WHEN** neither the config dir nor the profiles dir exist
- **THEN** calling `await ensureConfigDir()` creates both and resolves the config directory path

#### Scenario: Idempotent
- **WHEN** the config dir and profiles dir already exist
- **THEN** calling `await ensureConfigDir()` does not reject and resolves the config directory path

### Requirement: Exported Configuration API Surface
The system MUST export the following functions from `src/infrastructure/config.ts`: `getConfigDir`, `getProfilesDir`, `getProfilePath`, `getDefaultProfileName`, `setDefaultProfileName`, `listProfiles`, and `ensureConfigDir`. These functions form the complete public surface for profile marker management and config directory handling at this layer. Of these, `getConfigDir`, `getProfilesDir`, and `getProfilePath` MUST remain synchronous (pure path builders); `getDefaultProfileName`, `setDefaultProfileName`, `listProfiles`, and `ensureConfigDir` MUST be `async` and return Promises.

#### Scenario: All functions importable
- **WHEN** a consumer imports any of the seven exported function names from `src/infrastructure/config.ts`
- **THEN** the import resolves to a callable function

#### Scenario: Sync functions stay sync
- **WHEN** the exported signatures of `getConfigDir`, `getProfilesDir`, and `getProfilePath` are inspected
- **THEN** they return plain strings, not Promises
