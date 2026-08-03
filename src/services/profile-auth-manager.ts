import type { Cookie } from "../core/types.ts";
import type { Logger } from "../infrastructure/logger.ts";
import { checkCookieFreshness, type ProfileManager } from "../infrastructure/storage.ts";
import type { CookieStorageService } from "./cookie-storage-service.ts";
import type { LoadedCookies } from "./cookie-storage-service.ts";
import type { IGeminiClientService } from "../core/command-handlers.ts";
import { AuthenticationError } from "../core/errors.ts";
import { getDefaultProfileName } from "../infrastructure/config.ts";
import { validateProfileName } from "../infrastructure/validators.ts";
import { readProfileHasChats, writeProfileHasChats } from "../infrastructure/io.ts";

export type SilentRefreshFn = (profileName: string) => Promise<boolean>;

export interface ProfileAuthManagerDeps {
  profileManager: ProfileManager;
  cookieStorageService: CookieStorageService;
  logger: Logger;
  geminiClient: IGeminiClientService;
  silentRefresh: SilentRefreshFn;
}

type ProbeResult = "valid" | "stale" | "ambiguous";

interface ProbeCacheEntry {
  ts: number;
  result: ProbeResult;
}

const DEFAULT_PROBE_CACHE_TTL_MS = 150_000;

function getProbeCacheTtlMs(): number {
  const raw = process.env.GEMITERM_PROBE_TTL_MS;
  if (typeof raw !== "string" || raw.length === 0) return DEFAULT_PROBE_CACHE_TTL_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PROBE_CACHE_TTL_MS;
  return parsed;
}

export class ProfileAuthManager {
  private readonly profileManager: ProfileManager;
  private readonly cookieStorageService: CookieStorageService;
  private readonly logger: Logger;
  private readonly geminiClient: IGeminiClientService;
  private readonly silentRefresh: SilentRefreshFn;
  private readonly probeCache: Map<string, ProbeCacheEntry> = new Map();

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

    if (checkCookieFreshness(cookies)) {
      return true;
    }

    return this.silentRefresh(name);
  }

  async ensureAuthenticated(profileName?: string): Promise<LoadedCookies> {
    const name = profileName ?? getDefaultProfileName();
    validateProfileName(name);

    if (!this.profileManager.hasValidCookies(name)) {
      const extended = await this.autoExtendSession(name);
      if (extended) {
        this.logger.info(`Session auto-refreshed for profile '${name}'`);
        return this.cookieStorageService.loadCookiesForProfile(name);
      }
      throw new AuthenticationError(
        `No valid session for profile '${name}'. Run 'gemiterm login' to authenticate.`,
      );
    }

    const probe = await this.probeServerSession(name);
    if (probe === "stale") {
      const refreshed = await this.silentRefresh(name);
      if (refreshed) {
        this.probeCache.delete(name);
        await this.probeServerSession(name);
        this.logger.info(`Profile '${name}' is authenticated`);
        return this.cookieStorageService.loadCookiesForProfile(name);
      }
      throw new AuthenticationError(
        `No valid session for profile '${name}'. Run 'gemiterm login' to re-authenticate.`,
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

  private async probeServerSession(name: string, opts: { skipCache?: boolean } = {}): Promise<ProbeResult> {
    const now = Date.now();
    if (!opts.skipCache) {
      const cached = this.probeCache.get(name);
      if (cached && now - cached.ts < getProbeCacheTtlMs()) {
        return cached.result;
      }
    }

    let chats;
    try {
      chats = await this.geminiClient.forProfile(name).listChats({ limit: 1 });
    } catch (err) {
      this.logger.debug(`probeServerSession: listChats failed for profile '${name}': ${err}`);
      this.probeCache.set(name, { ts: now, result: "ambiguous" });
      return "ambiguous";
    }

    if (chats.length > 0) {
      try {
        writeProfileHasChats(name);
      } catch (err) {
        this.logger.debug(`probeServerSession: writeProfileHasChats failed: ${err}`);
      }
      this.probeCache.set(name, { ts: now, result: "valid" });
      return "valid";
    }

    const hasChatsFlag = readProfileHasChats(name);
    if (hasChatsFlag) {
      this.logger.warn(`Server-side session for profile '${name}' appears stale; forcing refresh`);
      this.probeCache.set(name, { ts: now, result: "stale" });
      return "stale";
    }
    this.logger.debug(`probeServerSession: no server chat history found for profile '${name}'`);
    this.probeCache.set(name, { ts: now, result: "ambiguous" });
    return "ambiguous";
  }
}
