import { AuthService } from "./auth-service.ts";
import { ProfileManager } from "../infrastructure/storage.ts";
import { getDefaultProfileName, setDefaultProfileName } from "../infrastructure/config.ts";
import type { IProfileService } from "../core/command-handlers.ts";
import type { AuthResult, ProfileStatus } from "../core/types.ts";

export class ProfileService implements IProfileService {
  private readonly authService: AuthService;
  private readonly profileManager: ProfileManager;

  constructor(authService: AuthService, profileManager: ProfileManager) {
    this.authService = authService;
    this.profileManager = profileManager;
  }

  async authenticate(profileName: string, options?: { renew?: boolean; create?: boolean }): Promise<AuthResult> {
    if (options?.create) {
      this.profileManager.create(profileName);
    }
    if (options?.renew) {
      return this.authService.renew(profileName);
    }
    return this.authService.authenticate(profileName);
  }

  async deleteProfile(profileName: string): Promise<void> {
    this.profileManager.delete(profileName);
  }

  async renameProfile(oldName: string, newName: string): Promise<void> {
    this.profileManager.rename(oldName, newName);
  }

  async setDefaultProfile(profileName: string): Promise<void> {
    this.profileManager.setDefault(profileName);
    setDefaultProfileName(profileName);
  }

  listProfileStatuses(): ProfileStatus[] {
    return this.profileManager.getAllStatuses();
  }

  listProfiles(): string[] {
    return this.profileManager.list();
  }
}
