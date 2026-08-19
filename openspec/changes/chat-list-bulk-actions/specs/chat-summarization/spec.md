## ADDED Requirements

### Requirement: Local summarizer SHALL produce a per-note 100-token extract

The `summarizeChatsLocally` function in `src/services/local-summarizer.ts` MUST produce a `BulkSummary` whose `perNote` array contains one `PerNoteExtract` per input chat. Each `PerNoteExtract` MUST include the chat's `id`, `title`, `timestamp`, a `keywords` array of up to 3 non-stopword tokens, and an `excerpt` string. The `excerpt` MUST be derived from the first `User` message of the chat and MUST be cut on a sentence boundary at or before 60 words; when no sentence boundary is found within 60 words, the excerpt MUST be hard-cut at 60 words. The combined `excerpt + title + keywords` line MUST be capped at 400 characters (an approximate 100-token ceiling). The `keywords` MUST be the top 3 tokens by frequency drawn from `title + excerpt + first 200 characters of all messages`, lowercased, alphanumeric-only, deduped, and filtered against a standard English stopword list (`a, an, and, are, as, at, be, but, by, for, from, has, have, he, her, his, i, if, in, is, it, its, of, on, or, she, that, the, their, there, they, this, to, was, we, were, what, when, where, which, who, will, with, you, your`).

#### Scenario: extract from a chat with a long first user message cuts on a sentence boundary

- **WHEN** `summarizeChatsLocally` is called with a chat whose first user message is 200 words long with a period at word 55
- **THEN** the `excerpt` ends at the period after word 55
- **AND** the excerpt length in words is at most 60

#### Scenario: extract from a chat with a short first user message uses the full text

- **WHEN** `summarizeChatsLocally` is called with a chat whose first user message is 10 words long
- **THEN** the `excerpt` is the full 10-word message

#### Scenario: extract keywords are lowercase alphanumeric, stopwords removed, top 3 by frequency

- **WHEN** `summarizeChatsLocally` is called with a chat whose first message contains `TypeScript` (twice), `async` (three times), `the` (five times), and `runtime` (once)
- **THEN** the `keywords` array is `["async", "typescript", "runtime"]` (or `["async", "typescript", "runtime"]` in any frequency-respecting order; `the` is excluded as a stopword)

#### Scenario: extract enforces the 400-character ceiling

- **WHEN** a chat's title + excerpt + keywords line would exceed 400 characters
- **THEN** the `excerpt` is hard-truncated to fit within the 400-character combined ceiling

### Requirement: Local summarizer SHALL produce a cross-references section

`BulkSummary.crossReferences` MUST be an array of `CrossRefGroup` objects of three possible `kind` values: `date`, `shared-keywords`, and `no-related`. The `date` groups MUST group chats whose `timestamp` falls on the same `YYYY-MM-DD` day; a date group MUST be emitted only when ≥ 2 chats share that day. The `shared-keywords` groups MUST be emitted for every pair of chats whose `keywords` arrays share ≥ 2 entries, with the `label` formatted as `<idA> ↔ <idB>: <shared-keyword-1>, <shared-keyword-2>, ...`. A pair MUST NOT appear in both a date group and a shared-keywords group; the date grouping takes precedence. The `no-related` group MUST be a single `CrossRefGroup` whose `members` are the ids of every chat that appears in neither a date group nor a shared-keywords group.

#### Scenario: two chats on the same day are grouped by date

- **WHEN** two chats have timestamps on `2024-05-28`
- **THEN** `crossReferences` contains one `date` group with `label: "2024-05-28"` and `members: [id1, id2]`

#### Scenario: three chats across two days produce two date groups

- **WHEN** three chats have timestamps on `2024-05-28`, `2024-05-29`, and `2024-05-28`
- **THEN** `crossReferences` contains one `date` group for `2024-05-28` (members: the two chats) and one `date` group for `2024-05-29` (members: the one chat)
- **AND** a `no-related` group is NOT emitted for the singleton (a date group of size 1 is also not emitted; the singleton is implicitly in the `no-related` group)

#### Scenario: two chats with overlapping keywords are linked

- **WHEN** two chats have `keywords: ["typescript", "async", "hooks"]` and `keywords: ["typescript", "async", "runtime"]` respectively
- **THEN** `crossReferences` contains a `shared-keywords` group with `label: "<idA> ↔ <idB>: typescript, async"`

#### Scenario: a chat with no date and keyword neighbors is in the no-related group

- **WHEN** one chat has no other chat sharing its day and shares fewer than 2 keywords with every other chat
- **THEN** `crossReferences` contains a `no-related` group whose `members` includes that chat's id

#### Scenario: a single chat produces only a no-related group

- **WHEN** `summarizeChatsLocally` is called with one chat
- **THEN** `crossReferences` contains exactly one `no-related` group whose `members` is `[id]`
- **AND** no `date` or `shared-keywords` groups are emitted

### Requirement: Bulk summary formatter SHALL produce deterministic markdown

The `formatBulkSummary` function in `src/services/local-summarizer.ts` MUST produce a markdown string with the following structure, in order:

1. A top-level heading `# Bulk summary — N conversations` where N is the size of `perNote`.
2. A `Generated: <ISO timestamp>` line drawn from `summary.generatedAt`.
3. A `## Cross-references` section containing, in order, a `### By date` subsection (omitted when there are no `date` groups), a `### Shared keywords` subsection (omitted when there are no `shared-keywords` groups), and a `### No related notes` subsection (omitted when there are no `no-related` groups).
4. A `## Notes` section containing, for each `PerNoteExtract` in `summary.perNote`, a `### <title> ('<id>', <YYYY-MM-DD>)` heading, a `**Keywords:** <kw1>, <kw2>, <kw3>` line (omitted when `keywords` is empty), and the `excerpt` block (each entry separated by a blank line).

The function MUST be deterministic: two calls with the same `BulkSummary` produce byte-identical output. The function MUST NOT consult the file system or call the Gemini client (the function is pure). The function MUST be exported as a named function so it can be unit-tested in isolation.

#### Scenario: formatter produces the expected structure for a 2-chat input

- **WHEN** `formatBulkSummary` is called with a `BulkSummary` whose `perNote` has 2 entries and `crossReferences` has one date group and one shared-keywords group
- **THEN** the output starts with `# Bulk summary — 2 conversations`
- **AND** contains `## Cross-references`, `### By date`, `### Shared keywords`, `## Notes`
- **AND** contains a `### <title> ('<id>', <date>)` heading for each per-note entry
- **AND** contains a `**Keywords:**` line for each per-note entry whose `keywords` is non-empty

#### Scenario: formatter omits the no-related subsection when all chats are linked

- **WHEN** `formatBulkSummary` is called with a `BulkSummary` whose `crossReferences` has only `date` and `shared-keywords` groups (no `no-related` group)
- **THEN** the output does not contain `### No related notes`

#### Scenario: formatter is deterministic

- **WHEN** `formatBulkSummary` is called twice with the same `BulkSummary`
- **THEN** the two returned strings are byte-identical

#### Scenario: formatter does not call the Gemini client

- **WHEN** `formatBulkSummary` is called
- **THEN** no Gemini-client method is invoked during the call (the function is pure)

### Requirement: Per-note block fits within a follow-up chat prompt

The combined per-note block (heading + keywords line + excerpt) MUST be small enough that the resulting bulk-summary file is a practical input to `gemiterm new --prompt-file <path>`. The bulk-summary file MUST NOT exceed 100 KB; the per-note block MUST NOT exceed 4 KB. The file MUST be UTF-8 encoded. The file MUST end with a trailing newline.

#### Scenario: file is UTF-8 encoded with a trailing newline

- **WHEN** the bulk summary file is written
- **THEN** the file content is valid UTF-8
- **AND** the file content ends with a `\n` character

#### Scenario: file is under 100 KB for a 50-chat input

- **WHEN** `summarize` is called with 50 chat ids
- **THEN** the written file is less than 100 KB
- **AND** the process exits with code 0
