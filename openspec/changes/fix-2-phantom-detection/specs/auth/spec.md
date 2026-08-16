# Delta: auth (fix-2-phantom-detection)

Amends the pinned probe requirement to cover the count-aware probe surface the `status --verbose` PROBE column consumes (`live (N)` needs the probe's chat count). The tri-state classification semantics are unchanged.

## MODIFIED Requirements

### Requirement: CookieSession.probe classifies live, phantom, or dead
The facade's `probe(profile)` MUST classify a profile read-only as `live` (init GET yields session tokens AND the probe's `listChats` call returns at least one chat), `phantom` (tokens present AND zero chats), or `dead` (init GET yields no session tokens). The probe's `listChats` call MUST be unbounded so the observed chat count is real — this is network-identical to a `limit: 1` call because the SDK fetches the full chat list and slices client-side, and the ≥-one-chat signal is identical either way. The facade MUST additionally expose `probeDetailed(profile)` returning `{ state, chatCount }` (the same single classification pass, with the observed chat count; `dead` reports `chatCount: 0` without consulting the chats probe), and MUST re-export the result type so command layers never import the classifier collaborator directly. Both probes MUST NOT write cookies, rotate, or spawn a browser, and MUST NOT use the SDK's `models()` as a signal (it is a static table). The classifier remains the only sanctioned session-state oracle.

#### Scenario: Phantom is distinguishable from dead
- **WHEN** the init GET extracts tokens but the probe's `listChats` call returns none
- **THEN** `probe` resolves `phantom` (and `probeDetailed` resolves `{ state: "phantom", chatCount: 0 }`); and when the init GET extracts no tokens, they resolve `dead` / `{ state: "dead", chatCount: 0 }`

#### Scenario: Probe is read-only
- **WHEN** `probe` or `probeDetailed` runs against any profile state
- **THEN** no cookie write occurs and no browser session is opened

#### Scenario: Detailed probe reports the observed chat count
- **WHEN** the init GET extracts tokens and the unbounded `listChats` probe observes N ≥ 1 chats
- **THEN** `probeDetailed` resolves `{ state: "live", chatCount: N }` and `probe` resolves `live`
