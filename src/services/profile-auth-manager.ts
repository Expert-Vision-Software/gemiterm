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

type ProbeResult = "valid" | "stale";

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
  private readonly now: () => number;
  private readonly probeCache: Map<string, ProbeCacheEntry> = new Map();


  constructor(deps: ProfileAuthManagerDeps) {
    this.profileManager = deps.profileManager;
    this.cookieStorageService = deps.cookieStorageService;
    this.logger = deps.logger;
    this.geminiClient = deps.geminiClient;
    this.silentRefresh = deps.silentRefresh;
    this.now = deps.now ?? Date.now;
  }

  async ensureAuthenticated(profileName?: string): Promise<LoadedCookies> {
    const name = profileName ?? getDefaultProfileName();
    validateProfileName(name);

    const hasStored = this.profileManager.hasStoredCookies(name);
    const hasValid = this.profileManager.hasValidCookies(name);

    if (!hasStored) {
      throw new AuthenticationError(
        `No valid session for profile '${name}'. Run 'gemiterm login' to authenticate.`,
      );
    }

    if (hasValid) {
      const probe = await this.probeServerSession(name);
      if (probe === "valid") {
        return this.cookieStorageService.loadCookiesForProfile(name);
      }
      const refreshed = await this.silentRefresh(name);
      if (refreshed) {
        this.logger.info(`Profile '${name}' session revived via silent refresh`);
        return this.cookieStorageService.loadCookiesForProfile(name);
      }
      throw new AuthenticationError(
        `Session for profile '${name}' is no longer valid. Run 'gemiterm login' to re-authenticate.`,
      );
    }

    const refreshed = await this.silentRefresh(name);
    if (refreshed) {
      this.logger.info(`Profile '${name}' session auto-refreshed`);
      return this.cookieStorageService.loadCookiesForProfile(name);
    }
    throw new AuthenticationError(
      `Session for profile '${name}' has expired and could not be refreshed. Run 'gemiterm login' to re-authenticate.`,
    );
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
    const now = this.now();
    if (!opts.skipCache) {
      const cached = this.probeCache.get(name);
      if (cached && now - cached.ts < getProbeCacheTtlMs()) {
        return cached.result;
      }
    }

    try {
      const probed = await this.geminiClient.forProfile(name);
      await probed.models();
    } catch (err) {
      this.logger.warn(`Server-side session for profile '${name}' appears stale; forcing refresh`);
      this.logger.debug(`probeServerSession: models failed for profile '${name}': ${err}`);
      this.probeCache.set(name, { ts: now, result: "stale" });
      return "stale";
    }

    this.probeCache.set(name, { ts: now, result: "valid" });
    return "valid";
  }

}
