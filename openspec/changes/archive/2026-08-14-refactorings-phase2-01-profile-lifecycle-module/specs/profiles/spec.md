## REMOVED Requirements

### Requirement: ProfileService.authenticate returns an AuthResult for a valid profile
**Reason**: `ProfileService` (`src/services/profile-service.ts`) is dead code — it has zero production callers; only its own test file references it. The live authentication path is `AuthService.authenticate` composed by the auth command (now via the `ProfileLifecycle` module). Maintaining two parallel authentication wrappers with no caller for one of them is the duplication this change removes.
**Migration**: Authentication-against-a-profile is owned by `AuthService.authenticate`, reachable through `context.profileLifecycle.manageProfiles("auth" | "create", ...)`. See the `profile-lifecycle` capability (`ProfileLifecycle Module Action-Dispatch Interface`, `ProfileLifecycle CRUD Actions Delegate With Validation`). The cookie-array reconstruction (`buildCookieArray`) has no live consumer and is deleted with the class.

### Requirement: ProfileService.getProfileStatuses returns all profile statuses
**Reason**: Dead code — no production caller invokes `ProfileService.getProfileStatuses`; the live status paths call `ProfileManager.getStatus`/`getAllStatuses` directly from the auth/status commands.
**Migration**: Profile-status enumeration is owned by the `ProfileLifecycle` `list`/`status` actions (see `ProfileLifecycle list Action Renders the Shared Profile Table` and `ProfileLifecycle status Action Reports Configuration and Profiles` in the `profile-lifecycle` capability), which delegate to `ProfileManager.getAllStatuses()`.

### Requirement: ProfileService.getAuthStatus reports default profile authentication
**Reason**: Dead code — no production caller; the default-profile auth check lives in `ProfileManager`/`ProfileAuthManager` paths that the commands actually use.
**Migration**: Default-profile authentication state is read via `ProfileAuthManager` (already on `CliCommandContext`) and the `ProfileLifecycle` `status` action; no separate `getAuthStatus` surface is provided.

### Requirement: ProfileService.deleteProfile removes a profile
**Reason**: Dead code — no production caller; the live delete flows (auth menu option `D`) call `ProfileManager.delete` directly.
**Migration**: Profile deletion is owned by the `ProfileLifecycle` `delete` action (see `ProfileLifecycle CRUD Actions Delegate With Validation`), which preserves the `[y/N]` confirmation and `does not exist` error semantics.

### Requirement: ProfileService.renameProfile renames a profile directory
**Reason**: Dead code — no production caller; the live rename flow (auth menu option `R`) calls `ProfileManager.rename` directly.
**Migration**: Profile renaming is owned by the `ProfileLifecycle` `rename` action (see `ProfileLifecycle CRUD Actions Delegate With Validation`), which preserves name validation and the default-marker update semantics.

### Requirement: ProfileService.setDefaultProfile writes the default marker
**Reason**: Dead code — no production caller; the live set-default flows call `ProfileManager.setDefault` + `setDefaultProfileName` directly.
**Migration**: Default-profile selection is owned by the `ProfileLifecycle` `set-default` action (see `ProfileLifecycle CRUD Actions Delegate With Validation`), which calls both marker surfaces.

### Requirement: ProfileService is exposed via the IProfileService and IProfileQueryService interfaces
**Reason**: The `IProfileService`/`IProfileQueryService` interfaces existed to serve the removed mediator's command/query handler layer. With the mediator gone (phase-1 change `2026-08-13-remove-mediator-layer`) and `ProfileService` having zero production callers, both interfaces and the class are dead code.
**Migration**: Command-layer consumers use `CliCommandContext.profileLifecycle` (`manageProfiles` action dispatch); conversation→profile routing uses `CliCommandContext.profileAuthManager`. See the `profile-lifecycle` capability and the modified `CommandRegistry` requirement in the `commands` capability.
