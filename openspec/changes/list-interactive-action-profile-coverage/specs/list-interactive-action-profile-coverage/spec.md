## ADDED Requirements

### Requirement: export-markdown action forwards chat profile to export command

When a chat with a `profile` field is selected from the interactive browser and the user picks "Export to Markdown", the caller SHALL dispatch to the export handler with argv `[chat.id, "--format", "markdown", "--out", "<path>", "--profile", "<chat.profile>"]`.

#### Scenario: export-markdown with chat that has profile forwards --profile in argv
- **WHEN** the user picks a chat with `profile: "dhb-worker"` and selects "Export to Markdown"
- **THEN** `exportExecute` is called with `[chat.id, "--format", "markdown", "--out", "<default-or-entered-path>", "--profile", "dhb-worker"]`

### Requirement: export-json action forwards chat profile to export command

When a chat with a `profile` field is selected from the interactive browser and the user picks "Export to JSON", the caller SHALL dispatch to the export handler with argv `[chat.id, "--format", "json", "--out", "<path>", "--profile", "<chat.profile>"]`.

#### Scenario: export-json with chat that has profile forwards --profile in argv
- **WHEN** the user picks a chat with `profile: "personal"` and selects "Export to JSON"
- **THEN** `exportExecute` is called with `[chat.id, "--format", "json", "--out", "<default-or-entered-path>", "--profile", "personal"]`

### Requirement: continue action forwards chat profile to continue command

When a chat with a `profile` field is selected from the interactive browser and the user picks "Continue conversation", the caller SHALL dispatch to the continue handler with argv `[chat.id, "--profile", "<chat.profile>"]`.

#### Scenario: continue with chat that has profile forwards --profile in argv
- **WHEN** the user picks a chat with `profile: "work"` and selects "Continue conversation"
- **THEN** `continueExecute` is called with `[chat.id, "--profile", "work"]`

### Requirement: delete action forwards chat profile to delete command

When a chat with a `profile` field is selected from the interactive browser and the user picks "Delete conversation", the caller SHALL dispatch to the delete handler with argv `[chat.id, "--force", "--profile", "<chat.profile>"]`.

#### Scenario: delete with chat that has profile forwards --profile in argv
- **WHEN** the user picks a chat with `profile: "dhb-worker"` and selects "Delete conversation"
- **THEN** `deleteExecute` is called with `[chat.id, "--force", "--profile", "dhb-worker"]`
