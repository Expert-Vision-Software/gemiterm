## MODIFIED Requirements

### Requirement: list --all-profiles skips unauthenticated profiles and surfaces warnings

When `list --all-profiles` (or `list -i`) is executed, the system SHALL query only profiles that have stored authentication cookies on disk (a cookie file exists for the profile and contains both `__Secure-1PSID` and `__Secure-1PSIDTS`). Profiles without stored cookies SHALL be skipped, and a warning SHALL be logged to stderr containing the profile name. The system SHALL NOT consult the freshness check (`checkCookieFreshness`) when deciding whether to include a profile for listing — near-expiry cookies are eligible for listing. The default profile, when its cookies are within the 1-hour freshness grace window, SHALL be silently refreshed in `ProfileAuthManager.ensureAuthenticated` before the API client is built, and SHALL be queried as usual. Profiles other than the default whose cookies are within the grace window SHALL be queried with the cookies as-is; any auth error surfaced by the API is caught by `Promise.allSettled` in the handler and logged as a warning per profile, not propagated as "No conversations found." The system SHALL NOT attempt API calls for profiles without stored cookies. Partial results from profiles with stored cookies SHALL be returned even if some profiles are skipped or fail.

#### Scenario: One of three profiles is unauthenticated
- **WHEN** a user with profiles `work` (stored cookies), `personal` (no stored cookies), and `test` (stored cookies) runs `gemiterm list --all-profiles`
- **THEN** conversations from `work` and `test` are displayed
- **AND** a warning is printed to stderr: `"Skipping unauthenticated profile 'personal'"`
- **AND** no API calls are made for the `personal` profile

#### Scenario: No profiles are authenticated
- **WHEN** a user with no stored-cookie profiles runs `gemiterm list --all-profiles`
- **THEN** no API calls are made
- **AND** a warning is printed for each profile
- **AND** the output shows "No conversations found." (or empty JSON: `{"chats": []}`)

#### Scenario: An authenticated profile's API call fails
- **WHEN** a user with stored-cookie profiles `work` and `personal` runs `gemiterm list --all-profiles` and `personal`'s API call throws
- **THEN** conversations from `work` are displayed
- **AND** a warning is printed to stderr: `"Failed to list chats for profile 'personal': <error message>"`
- **AND** `work`'s results remain unaffected

#### Scenario: A profile's cookies are within the 1-hour freshness grace window
- **WHEN** a user with profile `work` whose `__Secure-1PSIDTS` cookie expires in 30 minutes runs `gemiterm list --all-profiles`
- **THEN** the `work` profile IS queried (not skipped by the listing filter)
- **AND** if the API returns a non-empty chat list, those chats are displayed
- **AND** for the **default** profile specifically, any needed silent refresh happens transparently in `ProfileAuthManager.ensureAuthenticated` before the API client is built — the user does not see an interactive reauth prompt in this case

#### Scenario: Non-default profile's cookies are within the 1-hour freshness grace window and the API rejects them
- **WHEN** a user with default profile `work` (fresh cookies) and additional profile `personal` (cookies inside the 1-hour grace window) runs `gemiterm list --all-profiles` and `personal`'s API call returns an auth error
- **THEN** conversations from `work` are displayed
- **AND** a warning is printed to stderr: `"Failed to list chats for profile 'personal': <error message>"`
- **AND** `work`'s results remain unaffected (the listing is not empty)
