import type { Cookie } from "../core/types.ts";
import type { Logger } from "../infrastructure/logger.ts";
import { AuthenticationError } from "../core/errors.ts";
import type { BrowserRefresher } from "./browser-refresher.ts";
import type { ArmedSession } from "./cookie-session.ts";
import { PSIDTS_COOKIE_NAME } from "./auth-constants.ts";
import { findRoutableCookieValue } from "./cookie-validation.ts";

export interface RecoveryDeps {
  refresher: Pick<BrowserRefresher, "rotatePsidts">;
  cookieStore: { load(profile: string): Promise<{ cookies: Cookie[] }> };
  rearm: (profile: string) => Promise<ArmedSession>;
  logger: Logger;
}

export class RecoveryRung {
  private readonly deps: RecoveryDeps;

  constructor(deps: RecoveryDeps) {
    this.deps = deps;
  }

  async recover(profile: string): Promise<ArmedSession> {
    let baseline: string | null = null;
    try {
      const { cookies } = await this.deps.cookieStore.load(profile);
      baseline = findRoutableCookieValue(cookies, PSIDTS_COOKIE_NAME);
    } catch {
      this.deps.logger.debug(`recovery: no stored jar for profile '${profile}'`);
    }

    try {
      // Distinct session name (openspec/changes/fix-rotation-dead-end):
      // recovery may run while a detached runner is still alive for this
      // profile; sharing `refresh-<profile>` would let either side's
      // finally-close kill the other's browser mid-poll.
      const result = await this.deps.refresher.rotatePsidts(
        profile,
        baseline,
        undefined,
        `recover-${profile}`,
      );
      if (!result.rotated) {
        // Field-validated diagnosis: an unraced rotation that produces no
        // PSIDTS change within its own budget means the persistent-profile
        // browser session is signed out server-side - a re-auth condition,
        // not a transient (docs/auth-cookie-lifecycle.md, PSIDTS supersession).
        throw new AuthenticationError(
          `Could not rotate ${PSIDTS_COOKIE_NAME} for profile '${profile}' (no change from baseline within the rotate budget) - the browser session appears signed out server-side. Run 'gemiterm auth' to re-authenticate.`,
        );
      }
    } catch (err) {
      if (err instanceof AuthenticationError) {
        throw err;
      }
      throw new AuthenticationError(
        `Session refresh failed for profile '${profile}' (${err instanceof Error ? err.message : String(err)}). Run 'gemiterm auth' to re-authenticate.`,
      );
    }

    try {
      return await this.deps.rearm(profile);
    } catch (err) {
      if (err instanceof AuthenticationError) {
        throw err;
      }
      throw new AuthenticationError(
        `Session re-arm failed for profile '${profile}' (${err instanceof Error ? err.message : String(err)}). Run 'gemiterm auth' to re-authenticate.`,
      );
    }
  }
}
