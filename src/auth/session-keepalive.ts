import type { Logger } from "../infrastructure/logger.ts";
import type { CookieStore } from "./cookie-store.ts";
import { BrowserRefresher } from "./browser-refresher.ts";
import { PSIDTS_COOKIE_NAME } from "./auth-constants.ts";
import { findRoutableCookieValue } from "./cookie-validation.ts";

const KEEPALIVE_INTERVAL_MS = 10 * 60 * 1000;
const ROTATION_FLOOR_MS = 60 * 1000;

export interface SessionKeepaliveOptions {
  intervalMs?: number;
  rotationFloorMs?: number;
}

export interface SessionKeepaliveDeps {
  cookieStore: Pick<CookieStore, "load">;
  refresher: Pick<BrowserRefresher, "rotatePsidts">;
  logger: Logger;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => number | { unref: () => void };
}

type TimerHandle = number | { unref: () => void };

export class SessionKeepalive {
  private readonly profile: string;
  private readonly deps: SessionKeepaliveDeps;
  private readonly intervalMs: number;
  private readonly rotationFloorMs: number;
  private lastObservedBaseline: string | null = null;
  private lastRotationTime: number | null = null;
  private handle: TimerHandle | null = null;
  private stopped = false;

  constructor(profile: string, deps: SessionKeepaliveDeps, options: SessionKeepaliveOptions = {}) {
    this.profile = profile;
    this.deps = deps;
    this.intervalMs = options.intervalMs ?? KEEPALIVE_INTERVAL_MS;
    this.rotationFloorMs = options.rotationFloorMs ?? ROTATION_FLOOR_MS;
  }

  start(): void {
    if (this.stopped) return;
    const handle = (this.deps.setInterval ?? setInterval)(() => {
      this.tick();
    }, this.intervalMs);
    this.handle = handle;
    if (typeof handle === "object" && handle !== null) {
      handle.unref();
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.handle !== null) {
      if (typeof this.handle === "object" && this.handle !== null) {
        this.handle.unref();
      } else {
        clearInterval(this.handle);
      }
      this.handle = null;
    }
  }

  async tick(): Promise<void> {
    if (this.stopped) return;

    const now = this.deps.now?.() ?? Date.now();

    try {
      const { cookies } = await this.deps.cookieStore.load(this.profile);
      const currentBaseline = findRoutableCookieValue(cookies, PSIDTS_COOKIE_NAME);

      const fastPathEligible =
        this.lastObservedBaseline !== null &&
        currentBaseline === this.lastObservedBaseline &&
        this.lastRotationTime !== null &&
        now - this.lastRotationTime < this.intervalMs;

      if (fastPathEligible) {
        this.deps.logger.debug(
          `Keepalive tick skipped for profile '${this.profile}': PSIDTS unchanged and rotation not yet due`,
        );
        return;
      }

      if (this.lastRotationTime !== null && now - this.lastRotationTime < this.rotationFloorMs) {
        this.deps.logger.debug(
          `Keepalive tick suppressed for profile '${this.profile}': within ${this.rotationFloorMs}ms rotation floor`,
        );
        return;
      }

      const result = await this.deps.refresher.rotatePsidts(this.profile, this.lastObservedBaseline);

      if (result.rotated) {
        this.lastObservedBaseline = currentBaseline;
        this.lastRotationTime = now;
        this.deps.logger.info(`Keepalive rotation complete for profile '${this.profile}'`);
      } else {
        this.deps.logger.debug(
          `Keepalive rotation returned false for profile '${this.profile}'; rescheduling`,
        );
      }
    } catch (err) {
      this.deps.logger.warn(`Keepalive tick failed for profile '${this.profile}': ${err}; rescheduling`);
    }
  }

  getLastRotationTime(): number | null {
    return this.lastRotationTime;
  }
}
