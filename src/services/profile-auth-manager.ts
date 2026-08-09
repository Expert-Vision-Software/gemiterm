import type { Cookie } from "../core/types.ts";
import type { Logger } from "../infrastructure/logger.ts";
import type { ProfileManager } from "../infrastructure/storage.ts";
import type { CookieStorageService } from "./cookie-storage-service.ts";
import type { LoadedCookies } from "./cookie-storage-service.ts";
import type { IGeminiClientService } from "../core/command-handlers.ts";
import { AuthenticationError } from "../core/errors.ts";
import { getDefaultProfileName } from "../infrastructure/config.ts";
import { validateProfileName } from "../infrastructure/validators.ts";
import type { RotateCookiesResult } from "./cookie-rotation.ts";
import type { SilentRefreshOptions } from "./auth-service.ts";
import { classifySession, getRecoveryAction, RecoveryAction } from "./session-state.ts";

export type SilentRefreshFn = (
  profileName: string,
  opts?: SilentRefreshOptions,
) => Promise<boolean>;
export type RotateCookiesFn = (profileName: string) => Promise<RotateCookiesResult>;

export interface ProfileAuthManagerDeps {
  profileManager: ProfileManager;
  cookieStorageService: CookieStorageService;
  logger: Logger;
  geminiClient: IGeminiClientService;
  silentRefresh: SilentRefreshFn;
  now?: () => number;
  rotateCookies: RotateCookiesFn;
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
  private readonly rotateCookies: RotateCookiesFn;
  private readonly probeCache: Map<string, ProbeCacheEntry> = new Map();


  constructor(deps: ProfileAuthManagerDeps) {
    this.profileManager = deps.profileManager;
    this.cookieStorageService = deps.cookieStorageService;
    this.logger = deps.logger;
    this.geminiClient = deps.geminiClient;
    this.silentRefresh = deps.silentRefresh;
    this.now = deps.now ?? Date.now;
    this.rotateCookies = deps.rotateCookies;
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

    const restored = await this.tryRestoreStaleCookies(name);
    if (restored) return restored;

    const probeResult = await this.tryRestoreStaleProbe(name);
    if (probeResult.cookies) return probeResult.cookies;

    return this.finishAuthentication(name, probeResult.state);
  }

  private async tryRestoreStaleCookies(name: string): Promise<LoadedCookies | null> {
    if (this.profileManager.hasValidCookies(name)) return null;

    const extended = await this.autoExtendSession(name);
    if (extended) {
      this.logger.info(`Session auto-refreshed for profile '${name}'`);
      return this.cookieStorageService.loadCookiesForProfile(name);
    }
    if (!this.profileManager.hasStoredCookies(name)) {
      throw new AuthenticationError(
        `No valid session for profile '${name}'. Run 'gemiterm login' to authenticate.`,
      );
    }
    return null;
  }

  private async tryRestoreStaleProbe(name: string): Promise<{ state: ProbeResult; cookies: LoadedCookies | null }> {
    const probe = await this.probeServerSession(name);
    if (probe === "valid") return { state: "valid", cookies: null };

    const refreshed = await this.silentRefresh(name, { mode: "targeted" });
    if (refreshed) {
      this.probeCache.delete(name);
      await this.probeServerSession(name);
      this.logger.info(`Profile '${name}' is authenticated`);
      return { state: "valid", cookies: this.cookieStorageService.loadCookiesForProfile(name) };
    }
    return { state: "valid", cookies: null };
  }

  private async finishAuthentication(name: string, probe: ProbeResult): Promise<LoadedCookies> {
    let rotation: RotateCookiesResult = { rotated: false, attempted: false };
    try {
      rotation = await this.rotateCookies(name);
    } catch (e) {
      this.logger.debug(`ensureAuthenticated: best-effort rotation failed for profile '${name}': ${e}`);
    }

    let isPhantom = false;
    if (rotation.attempted || rotation.sessionInvalid) {
      isPhantom = await this.detectPhantomAuth(name);
    }

    const state = classifySession({
      hasValidCookies: this.profileManager.hasValidCookies(name),
      serverProbe: probe,
      rotation,
      isPhantom,
    });

    if (getRecoveryAction(state) === RecoveryAction.TargetedRefresh) {
      const refreshed = await this.silentRefresh(name, { mode: "targeted" });
      if (!refreshed) {
        throw new AuthenticationError(
          `Session for profile '${name}' is in phantom-auth state; targeted refresh failed. Run 'gemiterm login' to re-authenticate.`,
        );
      }
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

  private async detectPhantomAuth(name: string): Promise<boolean> {
    try {
      const client = await this.geminiClient.forProfile(name);
      const chats = await client.listChats({ limit: 1 });
      return chats.length === 0;
    } catch (err) {
      this.logger.debug(`detectPhantomAuth: listChats failed for profile '${name}': ${err}`);
      return false;
    }
  }
}
