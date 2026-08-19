import type { Cookie } from "../core/types.ts";
import type { Logger } from "../infrastructure/logger.ts";
import { CookieStore } from "./cookie-store.ts";
import { GEMINI_APP_URL, PSIDTS_COOKIE_NAME, filterToGeminiDomains } from "./auth-constants.ts";
import { findRoutableCookieValue } from "./cookie-validation.ts";
import { sleep } from "./timing.ts";

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
    session?: string,
  ): Promise<RotationResult> {
    // Caller-scoped session name (openspec/changes/fix-rotation-dead-end):
    // closing a session closes it by name, so concurrent callers (detached
    // runner vs. recovery) must never share one - the winner's finally-close
    // would kill the other's browser mid-poll.
    const sessionName = session ?? `refresh-${profile}`;
    try {
      await this.driver.openHeadless(GEMINI_APP_URL, profile, sessionName);
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const observed = await this.pollPsidts(sessionName);
        if (observed !== null && observed !== baselineValue) {
          const jar = await this.driver.cookieListFromState(sessionName);
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
        await this.driver.closeSession(sessionName);
      } catch (err) {
        this.logger.debug(`Failed to close refresh session: ${err}`);
      }
    }
  }

  private async pollPsidts(session: string): Promise<string | null> {
    try {
      const cookies = await this.driver.cookieList(session);
      return findRoutableCookieValue(cookies, PSIDTS_COOKIE_NAME);
    } catch (err) {
      this.logger.debug(`cookie-list poll failed: ${err}`);
      return null;
    }
  }
}
