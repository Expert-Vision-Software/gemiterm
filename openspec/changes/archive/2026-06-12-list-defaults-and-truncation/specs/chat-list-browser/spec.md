## ADDED Requirements

### Requirement: Browser SHALL truncate long titles with an ellipsis

The browser SHALL truncate `chat.title` to 55 visible characters when rendering each row, and SHALL append the `…` (U+2026 HORIZONTAL ELLIPSIS) character to signal that the title has been truncated. A title of 55 characters or fewer MUST be rendered unchanged. The truncated form MUST be 55 characters total (54 source characters + the `…` glyph). The truncation MUST be applied in `src/cli/utils/prompts.ts` via the `truncateTitle` helper before chalk styling.

#### Scenario: Short titles render unchanged
- **WHEN** a chat has a `title` shorter than 55 characters
- **THEN** the browser renders the full title in the row, with no ellipsis

#### Scenario: Exactly 55-char titles render unchanged
- **WHEN** a chat has a `title` of exactly 55 characters
- **THEN** the browser renders the full title in the row, with no ellipsis

#### Scenario: Long titles are truncated to 55 chars + ellipsis
- **WHEN** a chat has a `title` longer than 55 characters
- **THEN** the browser renders the first 54 characters of the title followed by `…`, for a total of 55 characters
- **AND** the remaining characters of the original title are not visible in the row

#### Scenario: 56-char title truncates to 54 chars + ellipsis
- **WHEN** a chat has a `title` of exactly 56 characters
- **THEN** the browser renders the first 54 characters of the title followed by `…`

#### Scenario: Truncation is visible in the rendered row
- **WHEN** the browser renders a page that contains a chat whose `title` is 80 characters
- **THEN** the visible screen output contains the truncated 54-character prefix and the `…` glyph
- **AND** the full 80-character title is NOT present in the screen output (it has been replaced by the truncated form)

#### Scenario: Truncation does not affect the action menu
- **WHEN** a user picks a truncated chat and the action menu is shown
- **THEN** the action menu's `Selected: <id> — "<title>"` line displays the full un-truncated title
