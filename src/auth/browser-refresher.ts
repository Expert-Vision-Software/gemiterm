import type { Cookie } from "../core/types.ts";
import type { Logger } from "../infrastructure/logger.ts";
import { CookieStore } from "./cookie-store.ts";
import { GEMINI_APP_URL, PSIDTS_COOKIE_NAME } from "./auth-constants.ts";
import { filterToGeminiDomains } from "./auth-constants.ts";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;

export interface RefresherDriver {
  openHeadless(url: string, profile: string, session?: string): Promise<void>;
  cookieList(session: string): Promise<Cookie[]>;
  cookieListFromState(session: string): Promise<Cookie[]>;
  closeSession(session: string): Promise<void>;
}

export interface RotationResult {
  rotated: boolean;
  cookies?: Cookie[];
}

export interface BrowserRefresherDeps {
  driver: RefresherDriver;
  cookieStore: CookieStore;
  logger: Logger;
  pollIntervalMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class BrowserRefresher {
  private readonly driver: RefresherDriver;
  private readonly cookieStore: CookieStore;
  private readonly logger: Logger;
  private readonly pollIntervalMs: number;

  constructor(deps: BrowserRefresherDeps) {
    this.driver = deps.driver;
    this.cookieStore = deps.cookieStore;
    this.logger = deps.logger;
    this.pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  async rotatePsidts(
    profile: string,
    baselineValue: string | null,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ): Promise<RotationResult> {
    const session = `refresh-${profile}`;
    try {
      await this.driver.openHeadless(GEMINI_APP_URL, profile, session);
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const observed = await this.pollPsidts(session);
        if (observed !== null && observed !== baselineValue) {
          const jar = await this.driver.cookieListFromState(session);
          const filtered = filterToGeminiDomains(jar);
          await this.cookieStore.saveFullJar(profile, filtered);
          this.logger.info(
            `Rotated ${PSIDTS_COOKIE_NAME} for profile '${profile}' (${filtered.length} cookies persisted)`,
          );
          return { rotated: true, cookies: filtered };
        }
        if (Date.now() >= deadline) {
          this.logger.info(
            `PSIDTS rotation timed out after ${timeoutMs}ms for profile '${profile}' (no change from baseline)`,
          );
          return { rotated: false };
        }
        await sleep(this.pollIntervalMs);
      }
    } finally {
      try {
        await this.driver.closeSession(session);
      } catch (err) {
        this.logger.debug(`Failed to close refresh session: ${err}`);
      }
    }
  }

  private async pollPsidts(session: string): Promise<string | null> {
    try {
      const cookies = await this.driver.cookieList(session);
      return cookies.find((c) => c.name === PSIDTS_COOKIE_NAME)?.value ?? null;
    } catch (err) {
      this.logger.debug(`cookie-list poll failed: ${err}`);
      return null;
    }
  }
}
