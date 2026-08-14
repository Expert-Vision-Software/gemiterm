## ADDED Requirements

### Requirement: ChatOutput Render Interface

The system MUST provide a `ChatOutput` module in `src/cli/utils/chat-output.ts` exposing a single entry `render(data, sink)`. `data` MUST be a typed union: `{ kind: 'chat-list', chats: ChatInfo[], includeProfileColumn: boolean }`, `{ kind: 'conversation', conversationId: string, messages: Message[] }`, or `{ kind: 'batch-export', ... }`. `sink` MUST be `{ format: 'text' | 'json' | 'markdown' | 'md', out?: string }`. When `out` is set the module MUST write the rendered content to that path via `infrastructure/io.ts:writeTextFile` and print `Output written to: <out>`; otherwise the content MUST be printed to stdout. The chat-list text strategy MUST delegate to `formatChatList`, the conversation text strategy MUST produce the same `Conversation: <id>` header and `User:` / `Model:` labels as the current `fetch` output, and the JSON strategies MUST produce the same `{ chats }` / `{ conversationId, messages }` documents as the current commands.

#### Scenario: chat-list with out writes the file and prints the confirmation

- **WHEN** `render({ kind: 'chat-list', chats, includeProfileColumn: false }, { format: 'text', out: './out.txt' })` is called
- **THEN** `./out.txt` contains the `formatChatList` rendering and stdout contains `Output written to: ./out.txt`

#### Scenario: chat-list without out prints to stdout

- **WHEN** `render({ kind: 'chat-list', chats, includeProfileColumn: false }, { format: 'text' })` is called
- **THEN** the rendered table is printed to stdout and no file is written

#### Scenario: conversation json shape is preserved

- **WHEN** `render({ kind: 'conversation', conversationId, messages }, { format: 'json' })` is called
- **THEN** the output is the same `{ conversationId, messages }` JSON document the current `fetch --format json` emits

#### Scenario: conversation text shape is preserved

- **WHEN** `render({ kind: 'conversation', conversationId, messages }, { format: 'text' })` is called
- **THEN** the output starts with the `Conversation: <id>` header and labels each message `User:` or `Model:` by role, byte-equivalent to the current `fetch` text output

### Requirement: ChatOutput Owns the Only Stdout-vs-File Dispatch

The stdout-vs-file dispatch (`writeTextFile` + `Output written to: <path>` confirmation vs `console.log`) MUST exist in exactly one place — the `ChatOutput` module. After this change no command file may define a `writeOutput` method or duplicate the dispatch inline.

#### Scenario: list and fetch contain no writeOutput copies

- **WHEN** `src/cli/commands/list-command.ts` and `src/cli/commands/fetch-command.ts` are inspected after the change
- **THEN** neither defines a `writeOutput` private method; both dispatch output through `render`

#### Scenario: Confirmation line is byte-equivalent

- **WHEN** `gemiterm list --out ./out.txt` or `gemiterm fetch <id> --out ./out.txt` is run
- **THEN** the confirmation line `Output written to: <path>` is printed exactly as in the pre-change baseline

### Requirement: Shared Chat Sort Function

The system MUST provide `sortChats(chats: ChatInfo[], order: 'recent' | 'oldest' | 'alpha'): ChatInfo[]` in `src/cli/utils/chat-output.ts` as the single sort implementation: `recent` sorts by descending timestamp, `oldest` by ascending timestamp, `alpha` by ascending `title.localeCompare`. The function MUST NOT mutate its input. Both the `list` command's sort application and the chat-list browser's `filteredSorted` computation MUST consume this function; neither may keep its own comparator switch.

#### Scenario: Sort orders behave as specified

- **WHEN** `sortChats(chats, 'recent' | 'oldest' | 'alpha')` is called
- **THEN** the returned order matches the current `list-command` `applySort` behavior for each mode and the input array is unmutated

#### Scenario: Browser consumes the shared sort

- **WHEN** the chat-list browser recomputes its sorted view (initial render and on `s` sort cycling)
- **THEN** it calls the shared `sortChats` and `src/cli/utils/prompts.ts` contains no inline comparator switch

### Requirement: Shared Chat Date Filter Function

The system MUST provide `filterChatsByDate(chats: ChatInfo[], bounds: { after?: string; before?: string; since?: string }): ChatInfo[]` in `src/cli/utils/chat-output.ts` as the single date-filter implementation, covering both current shapes: `after`/`before` inclusive-range filtering (per-bound invalid-date strings leave the list unfiltered for that bound) and `since` filtering (chats on or after the date; an invalid or missing `since` leaves the list unfiltered). The function MUST NOT mutate its input. The `list` command's `--after`/`--before` handling and the batch export's `--since` handling MUST consume this function.

#### Scenario: after/before range filters inclusively

- **WHEN** `filterChatsByDate(chats, { after: '2024-01-01', before: '2024-12-31' })` is called
- **THEN** chats with timestamps outside the inclusive range are removed, matching the current `list-command` `applyDateFilter` behavior

#### Scenario: Invalid bound strings pass through

- **WHEN** `filterChatsByDate(chats, { after: 'not-a-date' })` is called
- **THEN** the list is returned unfiltered for that bound, matching current behavior

#### Scenario: since filters on-or-after

- **WHEN** `filterChatsByDate(chats, { since: '2024-01-01' })` is called
- **THEN** chats with `timestamp < 2024-01-01` are removed, matching the current `export-all` `applyDateFilter` behavior

### Requirement: ChatOutput Delegates Export-Shaped Data to the Export Strategy

When `render` receives export-shaped data (`format` `markdown`/`md`/`json` on a conversation, or any `batch-export` data), it MUST forward the work to the `ExportStrategy` seam (`refactorings-phase2-03-export-strategy-seam`) rather than formatting and writing inline. The `export` and `export-all` commands' output paths route through `render` and get the strategy's formatting, filename, and write behavior.

#### Scenario: Conversation export forwards to the single strategy

- **WHEN** `render({ kind: 'conversation', conversationId, messages, format: 'markdown' }, { format: 'markdown', out })` is called
- **THEN** the `SingleExport` adapter performs the formatting and the write; `chat-output.ts` contains no export formatting logic of its own

#### Scenario: Batch export forwards to the batch strategy

- **WHEN** `render({ kind: 'batch-export', chats, outDir }, { format: 'markdown' })` is called
- **THEN** the `BatchExport` adapter owns iteration, progress, index, and write; `render` is a pure forwarder for this kind
