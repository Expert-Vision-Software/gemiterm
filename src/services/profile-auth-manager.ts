import type { Cookie } from "../core/types.ts";
import type { Logger } from "../infrastructure/logger.ts";
import type { ProfileManager } from "../infrastructure/storage.ts";
import type { CookieStorageService } from "./cookie-storage-service.ts";
import type { LoadedCookies } from "./cookie-storage-service.ts";
import { AuthenticationError } from "../core/errors.ts";
import { getDefaultProfileName } from "../infrastructure/config.ts";
import { validateProfileName } from "../infrastructure/validators.ts";

interface ProfileConversationLookup {
  profileHasConversation(profileName: string, conversationId: string): Promise<boolean>;
}

export interface ProfileAuthManagerDeps {
  profileManager: ProfileManager;
  cookieStorageService: CookieStorageService;
  logger: Logger;
  geminiClient: ProfileConversationLookup;
}

export class ProfileAuthManager {
  private readonly profileManager: ProfileManager;
  private readonly cookieStorageService: CookieStorageService;
  private readonly logger: Logger;
  private readonly geminiClient: ProfileConversationLookup;

  constructor(deps: ProfileAuthManagerDeps) {
    this.profileManager = deps.profileManager;
    this.cookieStorageService = deps.cookieStorageService;
    this.logger = deps.logger;
    this.geminiClient = deps.geminiClient;
  }

  async ensureAuthenticated(profileName?: string): Promise<LoadedCookies> {
    const name = profileName ?? await getDefaultProfileName();
    validateProfileName(name);

    if (!(await this.profileManager.hasValidCookies(name))) {
      throw new AuthenticationError(
        `No valid session for profile '${name}'. Run 'gemiterm login' to authenticate.`,
      );
    }

    this.logger.info(`Profile '${name}' is authenticated`);
    return await this.cookieStorageService.loadCookiesForProfile(name);
  }

  async getActiveProfiles(): Promise<string[]> {
    const profiles = await this.profileManager.list();
    const active: string[] = [];
    for (const name of profiles) {
      if (await this.profileManager.hasValidCookies(name)) {
        active.push(name);
      }
    }
    return active;
  }

  async findProfileForConversation(conversationId: string): Promise<string | null> {
    const profiles = await this.getActiveProfiles();
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
