# GemiTerm

A terminal CLI for Google's Gemini web app. It authenticates browser-style (cookies, no API key) and lets a human list, continue, fetch, export, and delete their Gemini conversations across multiple named profiles.

## Language

### Conversations

**Chat**:
One entry in a profile's conversation list: an id, title, pinned flag, and timestamp. A Chat is metadata only — it never carries messages.
_Avoid_: conversation (when you mean the list entry), thread

**Conversation**:
A Gemini chat thread proper: an id plus its chronologically ordered messages.
_Avoid_: chat (when you mean the full thread)

**Conversation id (cid)**:
The server-side identifier that addresses a conversation everywhere: fetch, continue, delete, routing, metadata.
_Avoid_: chat id, session id

**Message**:
A single turn in a conversation.
_Avoid_: prompt, reply (position-dependent synonyms)

**Role**:
Who authored a message: `user` or `model`. There is no "assistant".
_Avoid_: sender, author

**Pinned**:
A server-side flag on a Chat marking it as pinned in Gemini's own UI.

**Ownership**:
The one profile whose server-side chat list contains a given conversation. Two profiles claiming the same cid is an inconsistent state the user is responsible for; resolution is first in list order.
_Avoid_: parent, creator

**Routing**:
Dispatching a conversation-scoped operation (continue, delete) to the profile that owns it, rather than to the default profile.
_Avoid_: targeting, resolving (too vague on its own)

### Profiles

**Profile**:
A named, local binding to one Google account's Gemini session: a named set of persisted cookies. One Google account may end up reachable through several scopes of cookies, but a Profile is exactly one local identity.
_Avoid_: account (the Google-side identity), user, workspace

**Default profile**:
The profile used when the user names none. Recorded by an explicit marker; deleting it reassigns to the first remaining profile.
_Avoid_: active profile (overloaded — see Freshness)

**Profile status**:
Display metadata about a profile: whether it exists, is locally active, when it expires, and whether it is the default. Never a validity verdict.
_Avoid_: health

**Freshness**:
Local, display-only currency of a jar, computed from the PSIDTS `expires` attribute (more than 7 days out). A fresh profile can still be server-side dead.
_Avoid_: valid, active, alive

### Cookies & session state

**Session**:
A profile's authenticated standing with the Gemini web app, embodied in its cookies. Server-side; not observable locally except through the probe.
_Avoid_: login, account

**Jar**:
The complete persisted cookie set for a profile (Playwright storage-state JSON). Filtered by domain only — never by cookie name.
_Avoid_: storage state, cookie file, token set

**PSID**:
The long-lived session cookie (`__Secure-1PSID`) that identifies the session.
_Avoid_: SID, token

**PSIDTS**:
The short-lived companion cookie (`__Secure-1PSIDTS`) that the server re-issues over time. Its value changing is the heartbeat of a live session; its local `expires` attribute carries no validity information.
_Avoid_: refresh token, timestamp cookie

**Routability**:
Whether a cookie's RFC-6265 scope would actually deliver it to `gemini.google.com`. The same cookie name under `.youtube.com` is a different session and never counts.
_Avoid_: presence, domain match

**Arm / Armed session**:
Loading the on-disk jar into a ready-to-use client without any network call or browser. Arm-first: even a stale jar arms immediately; staleness spawns background work instead of blocking.
_Avoid_: load, restore, login

**Stale jar**:
A jar whose on-disk snapshot is old enough that arming it spawns a detached refresh. Judged by snapshot age — deliberately distinct from Freshness, which judges the cookie's own expiry. A jar can be fresh (display) and stale (snapshot) at once.
_Avoid_: expired, old session

**Probe**:
The read-only classification of a profile's session state: live, phantom, or dead. It is the only sanctioned validity oracle — freshness, cookie expiry, and static tables never decide validity.
_Avoid_: health check, ping, validate

**Live / Phantom / Dead**:
The three session states. Live: session tokens extractable and at least one chat visible. Phantom: tokens present but zero chats (signed in, emptied out). Dead: no extractable tokens (signed out server-side).
_Avoid_: expired (a local-only notion), broken

### Login & rotation

**Login (capture)**:
The headed-browser flow that ends by persisting the jar for a profile.
_Avoid_: sign-in flow, register

**Gate**:
The condition that ends a login's waiting: both required cookies present and routable to the Gemini app. The gate is a condition, not the saved data.
_Avoid_: validation, check

**Payload**:
The complete jar persisted at login — never trimmed to the gate's cookie set.
_Avoid_: gate set, cookies (when you mean the whole jar)

**Tier 1 / Tier 2 validation**:
Two-tier jar checking. Tier 1 hard-fails (PSID missing, or PSIDTS missing, expired, or unroutable). Tier 2 only warns, at most once per process, when companion cookies are absent — a hedge, never a gate.
_Avoid_: strict/loose mode

**Renew**:
Re-running login for a profile that already exists.
_Avoid_: refresh, re-auth

**Login cancellation**:
The user closing the headed browser mid-login. Treated as the user's choice, not a failure: the wait ends immediately and any pre-existing jar is preserved untouched. Distinct from a gate timeout, which is a genuine failure.
_Avoid_: timeout (a different event), abort

**Rotation**:
A server-issued change of the PSIDTS value, captured by a headless page load and persisted as the full jar. Companion cookies are preserved — rotation replaces, never trims.
_Avoid_: refresh (reserve for the user-facing verb), cookie update

**Refresh**:
The operation that triggers or awaits a rotation for a profile. The user-facing verb; Rotation is the event.
_Avoid_: rotate (as a verb for the operation)

**Detached refresh-runner**:
A background process that performs a rotation so the current command never blocks on a browser. Single-flight per profile across processes.
_Avoid_: daemon, background refresh

**Rotation floor**:
The short in-process window during which a second rotation for the same profile is suppressed, no matter which consumer asks.
_Avoid_: cooldown, lock

**Keepalive**:
The interval loop that rotates on schedule during a long-lived session. Failed ticks log and reschedule; they never surface into the session.
_Avoid_: heartbeat, monitor

**Recovery**:
The single refresh-and-retry rung for a degraded profile: await any in-flight rotation, attempt exactly one rotation plus re-arm, then surface a typed auth error pointing at login.
_Avoid_: repair, self-heal

### Continuation

**Chat metadata**:
The (rid, rcid, ctx) triple persisted per (profile, conversation), capturing where the conversation's turn pointer stands server-side.
_Avoid_: session state, cursor

**Threading**:
Restoring chat metadata so a sent message appends to the existing conversation server-side instead of starting a new one. Missing metadata falls back to cid-only continuation, never an error.
_Avoid_: resume, reattach, continue (that's the command)

**Model selection**:
The optional per-send choice of model, reflected only in the constructed chat session — never as a separate wire field. The resolved default is process-wide: environment variable, else the built-in flash default.
_Avoid_: model override, model switch

### CLI contracts

**Byte-equivalence**:
The contract that a refactor leaves a command's output byte-identical to its recorded baseline. Tests assert it without editing expected output.
_Avoid_: backwards compatible, snapshot testing

**Warn-and-continue**:
The all-profiles iteration contract: one profile's failure logs a warning naming it; the batch never aborts, even when every profile fails.
_Avoid_: best-effort, fault tolerance

**Chat-list browser**:
The opt-in TUI over the chat list (`list -i`), and the only chat-list TUI entry point.
_Avoid_: interactive mode (elsewhere), TUI (unqualified)

**Export**:
Writing a conversation (or many) to markdown or JSON files. Single export writes one file per conversation; batch export writes one file per chat plus an index, and a failing chat never aborts the batch.
_Avoid_: download, backup

### Governance

**Auth-regression gate**:
The rule that a change touching an auth-sensitive path must, in the same change, also touch the auth-regression tests and append to the lifecycle doc's changelog.
_Avoid_: auth tests (generic)

**Auth-sensitive path**:
A source file the gate watches — the cookie session surface, the browser driver's sensitive methods, and the rotation engine.

**Path mediation**:
The rule that file-system access is confined to exempted infrastructure modules; no other source file touches the filesystem directly.
_Avoid_: fs ban, no-fs rule

**Documentation authority order**:
For auth facts: the lifecycle doc is canonical, the ablation findings are the empirical record, everything else must not contradict them. Conflicts resolve by rule, not judgment.
_Avoid_: doc priority (informal)
