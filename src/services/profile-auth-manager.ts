import type { Cookie } from "../core/types.ts";
import type { Logger } from "../infrastructure/logger.ts";
import type { ProfileManager } from "../infrastructure/storage.ts";
import type { CookieStorageService } from "./cookie-storage-service.ts";
import type { LoadedCookies } from "./cookie-storage-service.ts";
import type { IGeminiClientService } from "../core/command-handlers.ts";
import { AuthenticationError } from "../core/errors.ts";
import { getDefaultProfileName } from "../infrastructure/config.ts";
import { validateProfileName } from "../infrastructure/validators.ts";
import type { SilentRefreshOptions } from "./auth-service.ts";

export type SilentRefreshFn = (
  profileName: string,
  opts?: SilentRefreshOptions,
) => Promise<boolean>;

export interface ProfileAuthManagerDeps {
  profileManager: ProfileManager;
  cookieStorageService: CookieStorageService;
  logger: Logger;
  geminiClient: IGeminiClientService;
  silentRefresh: SilentRefreshFn;
  now?: () => number;
}

export class ProfileAuthManager {
  private readonly profileManager: ProfileManager;
  private readonly cookieStorageService: CookieStorageService;
  private readonly logger: Logger;
  private readonly geminiClient: IGeminiClientService;
  private readonly silentRefresh: SilentRefreshFn;

  constructor(deps: ProfileAuthManagerDeps) {
    this.profileManager = deps.profileManager;
    this.cookieStorageService = deps.cookieStorageService;
    this.logger = deps.logger;
    this.geminiClient = deps.geminiClient;
    this.silentRefresh = deps.silentRefresh;
  }

  async autoExtendSession(profileName: string): Promise<boolean> {
    const name = profileName ?? getDefaultProfileName();
    validateProfileName(name);

    let cookies: Cookie[];
    try {
      cookies = this.cookieStorageService.loadAllCookiesForProfile(name);
    } catch {
      return false;
    }

    if (this.cookieStorageService.checkCookieFreshness(cookies)) {
      return true;
    }

    return this.silentRefresh(name);
  }

  async ensureAuthenticated(profileName?: string): Promise<LoadedCookies> {
    const name = profileName ?? getDefaultProfileName();
    validateProfileName(name);

    if (!this.profileManager.hasValidCookies(name)) {
      if (!this.profileManager.hasStoredCookies(name)) {
        throw new AuthenticationError(
          `No valid session for profile '${name}'. Run 'gemiterm login' to authenticate.`,
        );
      }
      const extended = await this.silentRefresh(name);
      if (extended) {
        this.logger.info(`Session auto-refreshed for profile '${name}'`);
      }
      this.logger.info(`Profile '${name}' is authenticated`);
      return this.cookieStorageService.loadCookiesForProfile(name);
    }

    let phantom = false;
    try {
      const probed = await this.geminiClient.forProfile(name);
      await probed.models();
      const chats = await probed.listChats({ limit: 1 });
      if (chats.length === 0) {
        phantom = true;
      }
    } catch (err) {
      this.logger.warn(`Server-side session for profile '${name}' appears stale; forcing refresh`);
      this.logger.debug(`probeServerSession: probe failed for profile '${name}': ${err}`);
      const refreshed = await this.silentRefresh(name);
      if (refreshed) {
        this.logger.info(`Profile '${name}' is authenticated`);
        return this.cookieStorageService.loadCookiesForProfile(name);
      }
    }

    if (phantom) {
      this.logger.warn(`Server-side session for profile '${name}' appears phantom (models ok, no chats); forcing refresh`);
      await this.silentRefresh(name);
      try {
        const reProbe = await this.geminiClient.forProfile(name);
        const reChats = await reProbe.listChats({ limit: 1 });
        if (reChats.length > 0) {
          this.logger.info(`Profile '${name}' is authenticated`);
          return this.cookieStorageService.loadCookiesForProfile(name);
        }
      } catch {
        this.logger.debug(`Re-probe after phantom refresh failed for profile '${name}'`);
      }
      throw new AuthenticationError(
        `Session for profile '${name}' is in phantom state. Run 'gemiterm login' to re-authenticate.`,
      );
    }

    this.logger.info(`Profile '${name}' is authenticated`);
    return this.cookieStorageService.loadCookiesForProfile(name);
  }

  getActiveProfiles(): string[] {
    const profiles = this.profileManager.list();
    return profiles.filter((name) => this.profileManager.hasValidCookies(name));
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
