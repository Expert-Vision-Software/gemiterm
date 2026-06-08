## Purpose

Input validation helpers used by command handlers and services to enforce invariants on user-supplied data: conversation IDs, ISO date strings, and profile names. All helpers throw a `GemitermError` (the project's base domain error) on invalid input so the calling layer can treat validation failures uniformly.

## Requirements

### Requirement: validateConversationId
The system MUST export a `validateConversationId(id: string): void` function. The function MUST throw a `GemitermError` whose message starts with `Conversation ID must not be empty` when the supplied id is falsy, an empty string, or a whitespace-only string (i.e. `id.trim().length === 0`). The function MUST return `void` and MUST NOT throw for any other string.

#### Scenario: Non-empty id passes
- **WHEN** `validateConversationId("abc123")` is called
- **THEN** the function does not throw

#### Scenario: Empty string throws
- **WHEN** `validateConversationId("")` is called
- **THEN** the function throws a `GemitermError` whose message includes `Conversation ID must not be empty`

#### Scenario: Whitespace-only id throws
- **WHEN** `validateConversationId("   ")` is called
- **THEN** the function throws a `GemitermError`

### Requirement: parseIsoDate
The system MUST export a `parseIsoDate(dateStr: string, fieldName: string): number` function. The function MUST parse the supplied string with `Date.parse`. If parsing yields a `NaN` value, the function MUST throw a `GemitermError` whose message names the supplied `fieldName` and the invalid input. If parsing succeeds, the function MUST return the resulting timestamp in milliseconds (a `number`).

#### Scenario: Valid ISO date returns timestamp
- **WHEN** `parseIsoDate("2025-01-15T10:30:00.000Z", "createdAt")` is called
- **THEN** the function returns a `number` equal to `new Date("2025-01-15T10:30:00.000Z").getTime()`

#### Scenario: Invalid date string throws
- **WHEN** `parseIsoDate("not-a-date", "field")` is called
- **THEN** the function throws a `GemitermError` whose message contains `Invalid ISO date for 'field'`

#### Scenario: Field name appears in error
- **WHEN** `parseIsoDate("bad", "updatedAt")` is called
- **THEN** the thrown error's message contains the literal string `'updatedAt'`

### Requirement: validateProfileName Allowed Character Set
The system MUST export a `validateProfileName(name: string): void` function. The function MUST treat a name as valid iff (a) the name is non-empty after trimming, and (b) the un-trimmed name matches the regular expression `/^[a-zA-Z0-9_-]+$/` — i.e. the name contains only ASCII letters, ASCII digits, hyphens, and underscores, and is at least one character long. Any other input MUST cause a `GemitermError` to be thrown.

#### Scenario: Valid names pass
- **WHEN** `validateProfileName` is called with `"default"`, `"my-profile"`, `"profile_2"`, or `"ABC123"`
- **THEN** the function does not throw

#### Scenario: Empty string throws
- **WHEN** `validateProfileName("")` is called
- **THEN** the function throws a `GemitermError` whose message includes `Profile name must not be empty`

#### Scenario: Whitespace-only name throws
- **WHEN** `validateProfileName("   ")` is called
- **THEN** the function throws a `GemitermError`

#### Scenario: Names with spaces throw
- **WHEN** `validateProfileName("my profile")` is called
- **THEN** the function throws a `GemitermError`

#### Scenario: Names with disallowed special characters throw
- **WHEN** `validateProfileName` is called with `"profile@bad"`, `"pro/ject"`, or `"pro.file"`
- **THEN** the function throws a `GemitermError`

### Requirement: Validation Errors Use GemitermError
All three validators (`validateConversationId`, `parseIsoDate`, `validateProfileName`) MUST throw instances of the project's base `GemitermError` class on invalid input. Validation errors therefore MUST be catchable as `GemitermError` (or as `Error`) by upstream layers.

#### Scenario: Validation errors are GemitermErrors
- **WHEN** any of the three validators is called with invalid input
- **THEN** the thrown value is an instance of `GemitermError`
