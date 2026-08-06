import type { Cookie } from "../core/types.ts";
import type { Logger } from "../infrastructure/logger.ts";
import { checkCookieFreshness, type ProfileManager } from "../infrastructure/storage.ts";
import type { CookieStorageService } from "./cookie-storage-service.ts";
import type { LoadedCookies } from "./cookie-storage-service.ts";
import type { IGeminiClientService } from "../core/command-handlers.ts";
import { AuthenticationError } from "../core/errors.ts";
import { getDefaultProfileName } from "../infrastructure/config.ts";
import { validateProfileName } from "../infrastructure/validators.ts";
import type { RotateCookiesResult } from "./cookie-rotation.ts";

export type SilentRefreshFn = (profileName: string) => Promise<boolean>;
export type RotateCookiesFn = (profileName: string) => Promise<RotateCookiesResult>;

export interface ProfileAuthManagerDeps {
  profileManager: ProfileManager;
  cookieStorageService: CookieStorageService;
  logger: Logger;
  geminiClient: IGeminiClientService;
  silentRefresh: SilentRefreshFn;
  rotateCookies: RotateCookiesFn;
}

type ProbeResult = "valid" | "stale";

interface ProbeCacheEntry {
  ts: number;
  result: ProbeResult;
}

const DEFAULT_PROBE_CACHE_TTL_MS = 150_000;
const ESCALATION_COOLDOWN_MS = 600_000;

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
  private readonly rotateCookies: RotateCookiesFn;
  private readonly probeCache: Map<string, ProbeCacheEntry> = new Map();
  private readonly escalationCooldown: Map<string, number> = new Map();

  constructor(deps: ProfileAuthManagerDeps) {
    this.profileManager = deps.profileManager;
    this.cookieStorageService = deps.cookieStorageService;
    this.logger = deps.logger;
    this.geminiClient = deps.geminiClient;
    this.silentRefresh = deps.silentRefresh;
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

    let rotation: RotateCookiesResult = { rotated: false, attempted: false };
    try {
      rotation = await this.rotateCookies(name);
    } catch (e) {
      this.logger.debug(`ensureAuthenticated: best-effort rotation failed for profile '${name}': ${e}`);
    }

    if (rotation.sessionInvalid) {
      // RotateCookies returned 401/403: the server rejected the session outright.
      // models() (PSID-only) can still succeed in this state, so the stale-probe path
      // never fires — but the session is dead for PSIDTS-requiring RPCs (listChats).
      // Only a headed reauth recovers this; throw so the CLI's reauth prompt fires.
      throw new AuthenticationError(
        `Session for profile '${name}' is no longer valid (server rejected RotateCookies). Run 'gemiterm login' to re-authenticate.`,
      );
    }

    if (rotation.rotated) {
      // Fresh __Secure-1PSIDTS obtained; session is fully usable.
    } else if (rotation.attempted) {
      // L1 RotateCookies reached Google (HTTP 200) but the server declined to issue a
      // fresh __Secure-1PSIDTS. This is the degraded "phantom-auth" state: models() (a
      // PSID-only RPC) succeeds, but PSIDTS-requiring RPCs (listChats) return empty.
      // models() will keep succeeding indefinitely (PSID is valid), so the stale-probe
      // recovery path never fires — escalate to the L2 browser ladder here, bounded by a
      // per-profile cooldown so a persistently-unrecoverable session does not launch a
      // browser on every command.
      await this.escalateAfterServerDecline(name);
    } else {
      // L1 was throttled (600 s disk-mtime guard), disabled, or unavailable before any
      // network attempt. Cookies are likely still fresh; no escalation warranted.
      this.logger.debug(`ensureAuthenticated: best-effort rotation skipped for profile '${name}'.`);
    }

    this.logger.info(`Profile '${name}' is authenticated`);
    return this.cookieStorageService.loadCookiesForProfile(name);
  }

  private async escalateAfterServerDecline(name: string): Promise<void> {
    const now = Date.now();
    const lastAttempt = this.escalationCooldown.get(name) ?? 0;
    if (now - lastAttempt < ESCALATION_COOLDOWN_MS) {
      throw new AuthenticationError(
        `Session for profile '${name}' is degraded; a recent automatic refresh attempt failed. Run 'gemiterm login' to re-authenticate.`,
      );
    }
    this.escalationCooldown.set(name, now);
    this.logger.info(`ensureAuthenticated: L1 RotateCookies declined by server for profile '${name}'; escalating to L2 silent refresh.`);
    let refreshed = false;
    try {
      refreshed = await this.silentRefresh(name);
      if (refreshed) {
        this.logger.info(`ensureAuthenticated: L2 silent refresh recovered profile '${name}'.`);
        return;
      }
    } catch (e) {
      this.logger.debug(`ensureAuthenticated: L2 silent refresh threw for profile '${name}': ${e}`);
    }
    throw new AuthenticationError(
      `Session for profile '${name}' is degraded and could not be auto-refreshed. Run 'gemiterm login' to re-authenticate.`,
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
    const now = Date.now();
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
