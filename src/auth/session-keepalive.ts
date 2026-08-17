import type { Logger } from "../infrastructure/logger.ts";
import type { CookieStore } from "./cookie-store.ts";
import { BrowserRefresher } from "./browser-refresher.ts";
import { PSIDTS_COOKIE_NAME } from "./auth-constants.ts";
import { findRoutableCookieValue } from "./cookie-validation.ts";
import type { RotationCooldownSeam } from "./rotation-cooldown.ts";

const KEEPALIVE_INTERVAL_MS = 10 * 60 * 1000;

export interface SessionKeepaliveOptions {
  intervalMs?: number;
}

export interface SessionKeepaliveDeps {
  cookieStore: Pick<CookieStore, "load">;
  refresher: Pick<BrowserRefresher, "rotatePsidts">;
  cooldown: RotationCooldownSeam;
  logger: Logger;
  now?: () => number;
  setInterval?: (fn: () => void, ms: number) => number | { unref: () => void };
}

type TimerHandle = number | { unref: () => void };

export class SessionKeepalive {
  private readonly profile: string;
  private readonly deps: SessionKeepaliveDeps;
  private readonly intervalMs: number;
  private lastObservedBaseline: string | null = null;
  // Interval tracking for the local fast path only. The 60s rotation floor itself lives
  // in the shared cooldown (fix-3b) so this loop and manual refresh() suppress each other.
  private lastRotationTime: number | null = null;
  private handle: TimerHandle | null = null;
  private stopped = false;

  constructor(profile: string, deps: SessionKeepaliveDeps, options: SessionKeepaliveOptions = {}) {
    this.profile = profile;
    this.deps = deps;
    this.intervalMs = options.intervalMs ?? KEEPALIVE_INTERVAL_MS;
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

      if (!this.deps.cooldown.canRotate(this.profile, now)) {
        this.deps.logger.debug(
          `Keepalive tick suppressed for profile '${this.profile}': within the shared rotation floor window`,
        );
        return;
      }

      const result = await this.deps.refresher.rotatePsidts(this.profile, this.lastObservedBaseline);

      if (result.rotated) {
        this.lastObservedBaseline = currentBaseline;
        this.lastRotationTime = now;
        this.deps.cooldown.record(this.profile, now);
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
}
