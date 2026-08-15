import type { Logger } from "../infrastructure/logger.ts";
import type { ProfileManager } from "../infrastructure/storage.ts";
import type { CookieSession, LoadedCookies } from "./cookie-session.ts";
import { AuthenticationError } from "../core/errors.ts";
import { getDefaultProfileName } from "../infrastructure/config.ts";
import { validateProfileName } from "../infrastructure/validators.ts";

interface ProfileConversationLookup {
  profileHasConversation(profileName: string, conversationId: string): Promise<boolean>;
}

export interface ProfileAuthManagerDeps {
  profileManager: ProfileManager;
  session: CookieSession;
  logger: Logger;
  geminiClient: ProfileConversationLookup;
}

export class ProfileAuthManager {
  private readonly profileManager: ProfileManager;
  private readonly session: CookieSession;
  private readonly logger: Logger;
  private readonly geminiClient: ProfileConversationLookup;

  constructor(deps: ProfileAuthManagerDeps) {
    this.profileManager = deps.profileManager;
    this.session = deps.session;
    this.logger = deps.logger;
    this.geminiClient = deps.geminiClient;
  }

  async ensureAuthenticated(profileName?: string): Promise<LoadedCookies> {
    const name = profileName ?? getDefaultProfileName();
    validateProfileName(name);

    try {
      const active = await this.session.ensureSession(name);
      this.logger.info(`Profile '${name}' is authenticated`);
      return { secure_1psid: active.secure1psid, secure_1psidts: active.secure1psidts };
    } catch {
      throw new AuthenticationError(
        `No valid session for profile '${name}'. Run 'gemiterm login' to authenticate.`,
      );
    }
  }

  getActiveProfiles(): string[] {
    return this.profileManager.list().filter((name) => this.session.sessionStatus(name).active);
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
