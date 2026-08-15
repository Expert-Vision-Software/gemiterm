## ADDED Requirements

### Requirement: ExportStrategy Seam With Two Adapters

The system MUST provide an `ExportStrategy` interface in `src/services/export-strategy.ts` with a single method `export(input, options): Promise<ExportResult[]>`, and exactly two production adapters behind it: `SingleExport` (exports one conversation to one file) and `BatchExport` (exports many conversations to a directory with an `index.md`). Both adapters MUST be constructed once in `src/cli/index.ts` and carried on `CliCommandContext` as `exportStrategies: { single: ExportStrategy; batch: ExportStrategy }`. The adapters MUST receive their conversation-fetching capability as an injected `fetchChat(conversationId, profileName?) => Promise<Message[]>` callback; the module MUST NOT import from `src/cli/`.

#### Scenario: Single adapter exports one conversation to one file

- **WHEN** `exportStrategies.single.export({ kind: "single", conversationId, messages, format: "markdown" }, { includeMetadata: false })` is called
- **THEN** exactly one file is written and the returned `ExportResult[]` has length 1 with `success: true` and the written path

#### Scenario: Batch adapter exports many conversations to a directory with index

- **WHEN** `exportStrategies.batch.export({ kind: "batch", chats }, { outDir: "./exports" })` is called against a fetcher returning messages for each chat
- **THEN** one markdown file per chat is written under `./exports`, `./exports/index.md` is written, and the returned `ExportResult[]` has one entry per chat

#### Scenario: Adapters use the injected fetcher, not a direct client dependency

- **WHEN** the adapters fetch conversation messages
- **THEN** they call the injected `fetchChat` callback, and `src/services/export-strategy.ts` contains no import of `src/cli/utils/gemini-queries.ts` or `GeminiClientService`

### Requirement: Unified Format Dispatch Hides the Formatter Asymmetry

The strategy MUST expose one internal format-dispatch path — a normalized conversation record (`{ messages, title, conversationId, format, includeMetadata }`) — that selects the correct formatter per `format`. Markdown output MUST be produced by delegating to `formatChatAsMarkdown(messages, title, conversationId, includeMetadata)` and JSON output by delegating to `formatChatAsJson(messages, conversationId)`; the rendered bytes MUST be identical to calling those functions directly. Callers of the strategy MUST NOT need to know the formatters' differing signatures. Adding a new export format MUST require exactly one new formatter entry inside the strategy and zero edits to command files.

#### Scenario: Markdown delegation is byte-identical

- **WHEN** the strategy formats a conversation as markdown
- **THEN** the output is byte-identical to `formatChatAsMarkdown(messages, title, conversationId, includeMetadata)` called with the same values

#### Scenario: JSON delegation ignores title and metadata flags

- **WHEN** the strategy formats a conversation as JSON with `title` and `includeMetadata: true` set on the record
- **THEN** the output is byte-identical to `formatChatAsJson(messages, conversationId)` (the extra fields are ignored, matching the json formatter's shape)

#### Scenario: Format selection is the adapter's job

- **WHEN** `export` is called with `format: "json"`
- **THEN** the caller's command code contains no formatter-selection branching — the branch lives inside the strategy

### Requirement: Unified Filename Strategy

The strategy MUST own all export filename construction behind one internal function with two documented rules. The single rule MUST produce `gemini-chat-<conversationId>-<YYYY-MM-DD>.<ext>` where `ext` is `md` for markdown and `json` for json. The batch rule MUST produce the sanitized-title form `gemini-chat-<sanitized-title>-<YYYY-MM-DD>.md` where the title is sanitized by replacing `/\?%*:|"<>` and whitespace runs with `-`, collapsing consecutive `-`, truncating to 60 characters, and stripping trailing `-`. No command file may construct an export filename after this change.

#### Scenario: Single filename uses the id and format-aware extension

- **WHEN** the single adapter exports conversation `conv-abc123` as json on 2026-08-14
- **THEN** the default filename is `gemini-chat-conv-abc123-2026-08-14.json`

#### Scenario: Batch filename sanitizes the title

- **WHEN** the batch adapter exports a chat titled `What's new? A/B "test"`
- **THEN** the filename matches `gemini-chat-<sanitized>-2026-08-14.md` where `<sanitized>` contains only filesystem-safe characters per the documented rule

#### Scenario: Command files contain no filename construction

- **WHEN** `src/cli/commands/export-command.ts` and `src/cli/commands/export-all-command.ts` are inspected after the change
- **THEN** neither defines `defaultFilename` nor `sanitizeFilename`; both delegate to the strategy

### Requirement: BatchExport Owns Iteration, Progress, Errors, and Index

The `BatchExport` adapter MUST own the batch loop: per-chat progress lines of the form `[i/total]` followed by `OK` or `FAILED`, per-chat error collection into the returned `ExportResult[]` (a failing chat MUST be recorded with `success: false` and its error message and MUST NOT abort the remaining chats), `index.md` generation listing successful exports as links and failures under a `## Failed Exports` section, and the final summary reporting (`Exported:`, `Failed:`, `Output:`, `Index:`). None of this logic may remain in `export-all-command.ts` after the change.

#### Scenario: One failing chat does not abort the batch

- **WHEN** the batch adapter exports 3 chats and the fetcher throws for the second
- **THEN** chats 1 and 3 produce files, the result array records chat 2 with `success: false` and the error message, and `index.md` contains a `## Failed Exports` entry for chat 2

#### Scenario: Progress lines match the current format

- **WHEN** the batch adapter exports N chats
- **THEN** exactly N progress lines of the form `[i/N]` are written, each followed by `OK` or `FAILED`, byte-equivalent to the pre-change `export-all` output

### Requirement: Batch Listing Warns and Continues Per Profile

When the batch adapter lists conversations across profiles, it MUST iterate the configured profiles with `Promise.allSettled` semantics: a profile whose listing fails MUST log a warning naming the profile and be skipped, and the batch MUST proceed with the chats of the remaining profiles. When every profile fails, the adapter MUST complete with an empty chat list and the existing no-conversations message path (no unhandled rejection).

#### Scenario: One inaccessible profile is skipped with a warning

- **WHEN** profiles `work`, `broken`, and `personal` are configured, `broken`'s listing rejects, and the other two resolve
- **THEN** a warning naming `broken` is logged and the batch exports the chats of `work` and `personal` only

#### Scenario: All profiles failing completes gracefully

- **WHEN** every configured profile's listing rejects
- **THEN** each failure is logged as a warning and the adapter resolves with an empty chat list, printing the no-conversations message path
