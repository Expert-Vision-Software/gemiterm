## Purpose

Output formatters that turn in-memory domain values (chats, conversations, profile statuses) into human-readable terminal output. The module provides markdown rendering for exporting a single conversation, JSON rendering for machine-readable export, and colored table rendering for listing profiles and chats in the terminal.

## Requirements

### Requirement: formatChatAsMarkdown Produces a Markdown Document
The system MUST export a `formatChatAsMarkdown(messages, title, conversationId?, includeMetadata?): string` function that builds a single markdown document. The first line of the document MUST be a level-1 heading `# <title>` followed by a blank line. For each message, the function MUST emit a bold role label on its own line (`**You:**` for `role === "user"`, `**Gemini:**` for `role === "model"`), a blank line, the message `content`, a blank line, and a horizontal rule `---` on its own line, followed by a blank line.

#### Scenario: Title heading is rendered
- **WHEN** `formatChatAsMarkdown(messages, "Test Chat")` is called
- **THEN** the result starts with `# Test Chat\n\n`

#### Scenario: User message label
- **WHEN** the messages contain a `{ role: "user", content: "Hello" }` entry
- **THEN** the result contains `**You:**` followed by the content

#### Scenario: Model message label
- **WHEN** the messages contain a `{ role: "model", content: "Hi" }` entry
- **THEN** the result contains `**Gemini:**` followed by the content

#### Scenario: Horizontal rule between messages
- **WHEN** the messages array has N entries
- **THEN** the result contains exactly N `---` separator lines

#### Scenario: Empty messages array
- **WHEN** `formatChatAsMarkdown([], "Empty")` is called
- **THEN** the result still contains `# Empty` and does NOT contain `**You:**` or `**Gemini:**`

#### Scenario: Single-message array
- **WHEN** the messages array has exactly one entry
- **THEN** the result contains that message's label, the message content, and exactly one `---` separator

### Requirement: formatChatAsMarkdown Optional Metadata Block
When `includeMetadata === true` AND a `conversationId` is supplied, `formatChatAsMarkdown` MUST prepend a metadata block (placed after the title heading, before the first message) of three blockquote lines: `> Conversation ID: <conversationId>`, `> Messages: <count>`, and `> Exported: <iso>`. When `includeMetadata` is `false` or `undefined`, or when `conversationId` is missing, the metadata block MUST NOT appear.

#### Scenario: Metadata included when both flags are set
- **WHEN** `formatChatAsMarkdown(messages, "Test", "conv-123", true)` is called
- **THEN** the result contains `> Conversation ID: conv-123`, `> Messages: <N>`, and `> Exported:`

#### Scenario: Metadata excluded when includeMetadata is false
- **WHEN** `formatChatAsMarkdown(messages, "Test", "conv-123", false)` is called
- **THEN** the result does NOT contain `> Conversation ID:`

#### Scenario: Metadata excluded when includeMetadata is undefined
- **WHEN** `formatChatAsMarkdown(messages, "Test", "conv-123")` is called (no fourth arg)
- **THEN** the result does NOT contain `> Conversation ID:`

#### Scenario: Metadata excluded when conversationId is missing
- **WHEN** `formatChatAsMarkdown(messages, "Test", undefined, true)` is called
- **THEN** the result does NOT contain `> Conversation ID:`

### Requirement: formatChatAsJson Produces a Conversation Document
The system MUST export a `formatChatAsJson(messages, conversationId): string` function that returns a JSON string of the form `{ "conversationId": "<id>", "messages": <messages> }`. The function MUST produce valid JSON and MUST use 2-space pretty-printing. The order of `messages` in the output MUST match the order of the input array.

#### Scenario: Output is valid JSON
- **WHEN** `formatChatAsJson(messages, "conv-1")` is called
- **THEN** `JSON.parse(result)` does not throw

#### Scenario: conversationId is present
- **WHEN** the function is called with `conversationId === "conv-1"`
- **THEN** the parsed object has `conversationId === "conv-1"`

#### Scenario: messages array is preserved
- **WHEN** the function is called with an N-element messages array
- **THEN** the parsed object has `messages.length === N` and the entries appear in the input order with their `role` and `content` intact

#### Scenario: Pretty-printed with 2-space indentation
- **WHEN** the function is called with non-empty input
- **THEN** the raw string contains `  "conversationId"` (2 spaces of indentation before the key)

#### Scenario: Empty messages array
- **WHEN** `formatChatAsJson([], "conv-empty")` is called
- **THEN** the parsed object has `messages: []` and `conversationId === "conv-empty"`

### Requirement: formatProfileTable Renders a 4-Column Status Table
The system MUST export a `formatProfileTable(statuses: ProfileStatus[]): string` function. The output MUST contain a header row with the four columns `NAME`, `ACTIVE`, `EXPIRES`, and `DEFAULT` (in that order), followed by a separator row of horizontal-line characters. The function MUST return the placeholder message `No profiles found. Run 'gemiterm login' to create one.` (dimmed) when the input array is empty.

#### Scenario: Empty array returns a placeholder
- **WHEN** `formatProfileTable([])` is called
- **THEN** the result contains `No profiles found` and `gemiterm login`

#### Scenario: Header row contains all four columns
- **WHEN** `formatProfileTable([{ name: "default", exists: true, isActive: true, expiresAt: null, isDefault: false }])` is called
- **THEN** the result contains `NAME`, `ACTIVE`, `EXPIRES`, and `DEFAULT`

#### Scenario: Separator row follows the header
- **WHEN** the table has at least one status
- **THEN** the line immediately after the header is a row composed entirely of horizontal-line characters

### Requirement: formatProfileTable Per-Status Coloring
For each `ProfileStatus` row, the formatter MUST render the `ACTIVE` column with a green check (`✓`) when `isActive === true`, a red cross (`✗`) when `exists === true && isActive === false`, and an em-dash (`—`) when `!exists`. The formatter MUST render the `EXPIRES` column with a localized date when `expiresAt` is non-null, and with the text `N/A` when `expiresAt` is `null`. The formatter MUST append a `*` to the default profile's `NAME` and render the `DEFAULT` column as `Yes` for the default profile (empty for non-defaults). A footer line MUST read `* = default profile`.

#### Scenario: Active check
- **WHEN** a status has `isActive: true`
- **THEN** the row's ACTIVE cell contains the check glyph

#### Scenario: Inactive cross
- **WHEN** a status has `exists: true, isActive: false`
- **THEN** the row's ACTIVE cell contains the cross glyph

#### Scenario: Missing profile
- **WHEN** a status has `exists: false`
- **THEN** the row's ACTIVE cell contains an em-dash

#### Scenario: Expiry date rendering
- **WHEN** a status has `expiresAt: "2026-12-31T00:00:00Z"`
- **THEN** the row's EXPIRES cell contains `2026` (the year of the parsed date)

#### Scenario: Null expiry
- **WHEN** a status has `expiresAt: null`
- **THEN** the row's EXPIRES cell contains `N/A`

#### Scenario: Default marker and footer
- **WHEN** a status has `isDefault: true`
- **THEN** the rendered table contains `Yes` in the DEFAULT cell and the footer `* = default profile` is present

### Requirement: formatChatList Renders a 4-Column Chat Table
The system MUST export a `formatChatList(chats: ChatInfo[]): string` function. The output MUST contain a header row with the four columns `ID`, `TITLE`, `DATE`, and `PIN` (in that order), followed by a separator row. The function MUST return the placeholder message `No conversations found.` (dimmed) when the input array is empty.

#### Scenario: Empty array returns a placeholder
- **WHEN** `formatChatList([])` is called
- **THEN** the result contains `No conversations found`

#### Scenario: Header row contains all four columns
- **WHEN** `formatChatList` is called with at least one chat
- **THEN** the result contains `ID`, `TITLE`, `DATE`, and `PIN`

#### Scenario: Separator row follows the header
- **WHEN** the table has at least one row
- **THEN** the line immediately after the header is composed entirely of horizontal-line characters

### Requirement: formatChatList Per-Chat Rendering
For each `ChatInfo`, the formatter MUST render the `ID` cell as the chat id (dimmed), the `TITLE` cell as the chat title truncated with an ellipsis (`…`) when it exceeds the column width, the `DATE` cell as a localized timestamp derived from `chat.timestamp`, and the `PIN` cell as a yellow pushpin emoji when `chat.isPinned === true` (empty otherwise). A footer line MUST report the total count, using the singular form `conversation` for exactly one entry and the plural form `conversations` otherwise.

#### Scenario: Chat id appears in the table
- **WHEN** a chat has `id === "abc123"`
- **THEN** the result contains `abc123`

#### Scenario: Long title is truncated
- **WHEN** a chat has a 100-character title
- **THEN** the result contains the ellipsis character `…` (the title has been truncated)

#### Scenario: Pinned chat shows a pushpin
- **WHEN** a chat has `isPinned: true`
- **THEN** the result contains the pushpin emoji glyph in that row's PIN cell

#### Scenario: Current year appears in the DATE cell
- **WHEN** a chat has `timestamp: Date.now()`
- **THEN** the result contains the current calendar year (i.e. the formatted date is rendered)

#### Scenario: Plural footer
- **WHEN** the chats array has 3 entries
- **THEN** the footer reads `Total: 3 conversations`

#### Scenario: Singular footer
- **WHEN** the chats array has exactly 1 entry
- **THEN** the footer reads `Total: 1 conversation` (no trailing `s`)
