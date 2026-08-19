## ADDED Requirements

### Requirement: findProfileForConversation consults stale profiles after their rotation lands
The facade's `findProfileForConversation(conversationId)` MUST run two passes. Pass 1 is unchanged: live profiles (per the classifier) are consulted in `listProfiles()` order. When pass 1 finds no owner, pass 2 MUST consult profiles that were armed stale during this invocation and whose detached rotation landed (`waitForRotation(profile)` returned a session): for each such profile, in `listProfiles()` order, `profileHasConversation` MUST be evaluated against the refreshed jar. When no profile in either pass owns the conversation, the method MUST return `null`. The method MUST NOT spawn browsers, write cookies, or block on profiles whose rotation has not landed.

#### Scenario: Conversation owned by a stale profile resolves after its rotation lands
- **WHEN** conversation `c_x` is owned by profile `stale` (jar stale at arm time), no live profile owns `c_x`, and `stale`'s detached rotation lands during `findProfileForConversation("c_x")`
- **THEN** the method returns `"stale"`

#### Scenario: Stale profile whose rotation has not landed is not consulted
- **WHEN** no live profile owns the conversation and a stale-armed profile's rotation is still in flight at the deadline
- **THEN** the method returns `null` without waiting beyond the existing `waitForRotation` ceiling for that profile

#### Scenario: Live profiles keep priority
- **WHEN** conversation `c_x` is owned by both a live profile `a` (earlier in list order) and a rotation-landed stale profile `b`
- **THEN** the method returns `"a"`
