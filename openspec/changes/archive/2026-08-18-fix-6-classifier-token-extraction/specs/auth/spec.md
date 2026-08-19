## MODIFIED Requirements

### Requirement: CookieSession.probe classifies live, phantom, or dead
The facade's `probe(profile)` MUST classify a profile read-only as `live` (init GET yields session tokens AND the probe's `listChats` call returns at least one chat), `phantom` (tokens present AND zero chats), or `dead` (init GET yields no session tokens). Token presence MUST be decided by value extraction, not name presence: a required init token (`SNlM0e`, `cfb2h`, `FdrFJe`) counts as present only when its regex extraction (`/"<token>":\s*"(.*?)"/`, ablation §6.2) yields a non-empty value; token keys with empty values (e.g. `"cfb2h":""`) MUST NOT count, and such HTML MUST classify `dead`. Tokens are present when at least one required token yields a non-empty extracted value. The probe's `listChats` call MUST be unbounded so the observed chat count is real — this is network-identical to a `limit: 1` call because the SDK fetches the full chat list and slices client-side, and the ≥-one-chat signal is identical either way. The facade MUST additionally expose `probeDetailed(profile)` returning `{ state, chatCount }` (the same single classification pass, with the observed chat count; `dead` reports `chatCount: 0` without consulting the chats probe), and MUST re-export the result type so command layers never import the classifier collaborator directly. Both probes MUST NOT write cookies, rotate, or spawn a browser, and MUST NOT use the SDK's `models()` as a signal (it is a static table). The classifier remains the only sanctioned session-state oracle.

#### Scenario: Phantom is distinguishable from dead
- **WHEN** the init GET extracts tokens but the probe's `listChats` call returns none
- **THEN** `probe` resolves `phantom` (and `probeDetailed` resolves `{ state: "phantom", chatCount: 0 }`); and when the init GET extracts no tokens, they resolve `dead` / `{ state: "dead", chatCount: 0 }`

#### Scenario: Token keys with empty values classify dead
- **WHEN** the init GET HTML contains the token keys `SNlM0e`/`cfb2h`/`FdrFJe` only with empty extracted values (signed-out page shape, e.g. `"cfb2h":""`)
- **THEN** `probe` resolves `dead` and `probeDetailed` resolves `{ state: "dead", chatCount: 0 }` without consulting the chats probe

#### Scenario: Probe is read-only
- **WHEN** `probe` or `probeDetailed` runs against any profile state
- **THEN** no cookie write occurs and no browser session is opened

#### Scenario: Detailed probe reports the observed chat count
- **WHEN** the init GET extracts tokens and the unbounded `listChats` probe observes N ≥ 1 chats
- **THEN** `probeDetailed` resolves `{ state: "live", chatCount: N }` and `probe` resolves `live`
