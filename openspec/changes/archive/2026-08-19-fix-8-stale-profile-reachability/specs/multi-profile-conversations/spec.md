## ADDED Requirements

### Requirement: Conversation ownership resolves for stale-but-recovered profiles
When conversation routing (`findProfileForConversation`) finds no owner among live profiles, it MUST consult profiles whose stale jar armed this invocation and whose detached rotation landed, in `listProfiles()` order, before returning `null`. The lookup MUST NOT block on profiles whose rotation has not landed, MUST NOT spawn browsers, and MUST NOT mutate cookies. Live-profile owners keep priority over stale-recovered owners regardless of list order between the two passes.

#### Scenario: Conversation owned only by a stale profile is found after rotation
- **WHEN** no live profile owns conversation `abc-123`, profile `stale` armed stale this invocation, its rotation landed, and `stale`'s refreshed chat list contains `abc-123`
- **THEN** routing returns `"stale"` and the read command proceeds against `stale`'s refreshed jar

#### Scenario: No owner anywhere still returns null
- **WHEN** neither the live pass nor the rotation-landed stale pass reports owning `abc-123`
- **THEN** routing returns `null` and the caller surfaces the existing remediation error
