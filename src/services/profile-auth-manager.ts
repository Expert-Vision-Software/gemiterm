import type { Cookie } from "../core/types.ts";
import type { Logger } from "../infrastructure/logger.ts";
import type { ProfileManager } from "../infrastructure/storage.ts";
import type { CookieStorageService } from "./cookie-storage-service.ts";
import type { LoadedCookies } from "./cookie-storage-service.ts";
import type { IGeminiClientService } from "../core/command-handlers.ts";
import { AuthenticationError } from "../core/errors.ts";
import { getDefaultProfileName } from "../infrastructure/config.ts";
import { validateProfileName } from "../infrastructure/validators.ts";

export interface ProfileAuthManagerDeps {
  profileManager: ProfileManager;
  cookieStorageService: CookieStorageService;
  logger: Logger;
  geminiClient: IGeminiClientService;
}

export class ProfileAuthManager {
  private readonly profileManager: ProfileManager;
  private readonly cookieStorageService: CookieStorageService;
  private readonly logger: Logger;
  private readonly geminiClient: IGeminiClientService;

  constructor(deps: ProfileAuthManagerDeps) {
    this.profileManager = deps.profileManager;
    this.cookieStorageService = deps.cookieStorageService;
    this.logger = deps.logger;
    this.geminiClient = deps.geminiClient;
  }

  ensureAuthenticated(profileName?: string): LoadedCookies {
    const name = profileName ?? getDefaultProfileName();
    validateProfileName(name);

    if (!this.profileManager.hasRequiredCookies(name)) {
      throw new AuthenticationError(
        `No valid session for profile '${name}'. Run 'gemiterm login' to authenticate.`,
      );
    }

    this.logger.info(`Profile '${name}' is authenticated`);
    return this.cookieStorageService.loadCookiesForProfile(name);
  }

  getActiveProfiles(): string[] {
    const profiles = this.profileManager.list();
    return profiles.filter((name) => this.profileManager.hasRequiredCookies(name));
  }

  async findProfileForConversation(conversationId: string): Promise<string | null> {
    const profiles = this.getActiveProfiles();
    for (const name of profiles) {
      try {
        const hasConversation = await this.geminiClient.profileHasConversation(name, conversationId);
        if (hasConversation) {
          return name;
        }
      } catch {
        continue;
      }
    }

    return null;
  }
}
