import type { Cookie } from "../core/types.ts";
import type { Logger } from "../infrastructure/logger.ts";
import type { ProfileManager } from "../infrastructure/storage.ts";
import type { CookieStorageService } from "./cookie-storage-service.ts";
import type { LoadedCookies } from "./cookie-storage-service.ts";
import { AuthenticationError } from "../core/errors.ts";
import { getDefaultProfileName } from "../infrastructure/config.ts";
import { validateProfileName } from "../infrastructure/validators.ts";

export interface ProfileAuthManagerDeps {
  profileManager: ProfileManager;
  cookieStorageService: CookieStorageService;
  logger: Logger;
}

export class ProfileAuthManager {
  private readonly profileManager: ProfileManager;
  private readonly cookieStorageService: CookieStorageService;
  private readonly logger: Logger;

  constructor(deps: ProfileAuthManagerDeps) {
    this.profileManager = deps.profileManager;
    this.cookieStorageService = deps.cookieStorageService;
    this.logger = deps.logger;
  }

  ensureAuthenticated(profileName?: string): LoadedCookies {
    const name = profileName ?? getDefaultProfileName();
    validateProfileName(name);

    if (!this.profileManager.hasValidCookies(name)) {
      throw new AuthenticationError(
        `No valid session for profile '${name}'. Run 'gemiterm login' to authenticate.`,
      );
    }

    this.logger.info(`Profile '${name}' is authenticated`);
    return this.cookieStorageService.loadCookiesForProfile(name);
  }

  getActiveProfiles(): string[] {
    const profiles = this.profileManager.list();
    return profiles.filter((name) => this.profileManager.hasValidCookies(name));
  }

  findProfileForConversation(conversationId: string): string | null {
    const profiles = this.profileManager.list();
    for (const name of profiles) {
      try {
        const status = this.profileManager.getStatus(name);
        if (status.isActive) {
          return name;
        }
      } catch {
        continue;
      }
    }

    return null;
  }
}
