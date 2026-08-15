import type { Cookie } from "../core/types.ts";
import type { CookieStorage } from "../infrastructure/storage.ts";
import type { Logger } from "../infrastructure/logger.ts";
import { AuthenticationError } from "../core/errors.ts";

export const PRIMARY_COOKIE_NAME = "__Secure-1PSID";
export const SECONDARY_COOKIE_NAME = "__Secure-1PSIDTS";

const COOKIE_EXPIRY_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

const ROTATE_COOKIES_URL =
  "https://gemini.google.com/_/BardChatUi/data/assistant.lamda.BardFrontendService/RotateCookies";

export interface LoadedCookies {
  secure_1psid: string;
  secure_1psidts: string | null;
}

export interface ActiveSession {
  cookies: Cookie[];
  secure1psid: string;
  secure1psidts: string | null;
  expiresAt: Date | null;
}

export interface CookieValidation {
  hasPrimary: boolean;
  hasSecondary: boolean;
  fresh: boolean;
  expiresAt: Date | null;
  secure1psid: string | null;
  secure1psidts: string | null;
}

export interface SessionStatus extends CookieValidation {
  loaded: boolean;
  active: boolean;
  cookies: Cookie[];
}

export interface CookieRotator {
  rotate(cookies: Cookie[]): Promise<string | null>;
}

export interface CookieSessionDeps {
  cookieStorage: CookieStorage;
  logger: Logger;
  clock?: () => number;
  rotator?: CookieRotator;
  rotationEnabled?: boolean;
}

export function sessionExpiry(cookies: Cookie[]): Date | null {
  let maxMs: number | null = null;
  for (const cookie of cookies) {
    if (
      (cookie.name === PRIMARY_COOKIE_NAME || cookie.name === SECONDARY_COOKIE_NAME) &&
      cookie.expires > 0
    ) {
      const ms = cookie.expires * 1000;
      if (maxMs === null || ms > maxMs) {
        maxMs = ms;
      }
    }
  }
  return maxMs === null ? null : new Date(maxMs);
}

function cookiesEquivalent(a: Cookie[], b: Cookie[]): boolean {
  if (a.length !== b.length) return false;
  const key = (c: Cookie) => `${c.name}\u0000${c.value}\u0000${c.expires}`;
  const setA = new Set(a.map(key));
  const setB = new Set(b.map(key));
  if (setA.size !== setB.size) return false;
  for (const k of setA) {
    if (!setB.has(k)) return false;
  }
  return true;
}

class DefaultRotator implements CookieRotator {
  async rotate(cookies: Cookie[]): Promise<string | null> {
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    try {
      const res = await fetch(ROTATE_COOKIES_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader,
        },
        body: JSON.stringify({}),
      });
      if (!res.ok) return null;
      const setCookies =
        typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
      for (const sc of setCookies) {
        const [name, ...rest] = sc.split("=");
        if (name.trim() === SECONDARY_COOKIE_NAME) {
          const value = rest.join("=").split(";")[0]?.trim();
          if (value) return value;
        }
      }
      return null;
    } catch {
      return null;
    }
  }
}

export class CookieSession {
  private readonly cookieStorage: CookieStorage;
  private readonly logger: Logger;
  private readonly clock: () => number;
  private readonly rotator: CookieRotator;
  private readonly rotationEnabled: boolean;

  constructor(deps: CookieSessionDeps) {
    this.cookieStorage = deps.cookieStorage;
    this.logger = deps.logger;
    this.clock = deps.clock ?? Date.now;
    this.rotator = deps.rotator ?? new DefaultRotator();
    this.rotationEnabled = deps.rotationEnabled ?? false;
  }

  validate(cookies: Cookie[]): CookieValidation {
    const now = this.clock();
    let secure1psid: string | null = null;
    let secure1psidts: string | null = null;
    let psidtsPresent = false;

    for (const cookie of cookies) {
      if (cookie.name === PRIMARY_COOKIE_NAME && secure1psid === null) {
        secure1psid = cookie.value;
      }
      if (cookie.name === SECONDARY_COOKIE_NAME) {
        psidtsPresent = true;
        if (secure1psidts === null) {
          secure1psidts = cookie.value;
        }
      }
    }

    const expiresAt = sessionExpiry(cookies);
    return {
      hasPrimary: !!secure1psid,
      hasSecondary: psidtsPresent && !!secure1psidts,
      fresh: expiresAt === null || expiresAt.getTime() > now,
      expiresAt,
      secure1psid,
      secure1psidts,
    };
  }

  sessionStatus(profile: string): SessionStatus {
    try {
      const cookies = this.cookieStorage.load(profile);
      const validation = this.validate(cookies);
      return {
        loaded: true,
        cookies,
        ...validation,
        active: validation.hasPrimary && validation.hasSecondary && validation.fresh,
      };
    } catch {
      return {
        loaded: false,
        active: false,
        cookies: [],
        hasPrimary: false,
        hasSecondary: false,
        fresh: false,
        expiresAt: null,
        secure1psid: null,
        secure1psidts: null,
      };
    }
  }

  async ensureSession(profile: string, liveJar?: Record<string, string>): Promise<ActiveSession> {
    let cookies = this.cookieStorage.load(profile);
    let validation = this.validate(cookies);

    if (validation.hasPrimary && validation.fresh) {
      this.logger.debug(`[cookie-session] rung 1: persisted session valid for profile '${profile}'`);
      return this.toActiveSession(cookies, validation);
    }

    if (liveJar && this.jarHasNewerValues(cookies, liveJar)) {
      this.logger.debug(`[cookie-session] rung 2: absorbing live jar for profile '${profile}'`);
      this.commitJarMerge(profile, liveJar);
      cookies = this.cookieStorage.load(profile);
      validation = this.validate(cookies);
      if (validation.hasPrimary && validation.fresh) {
        this.logger.debug(`[cookie-session] rung 2: absorbed live jar recovered session '${profile}'`);
        return this.toActiveSession(cookies, validation);
      }
    }

    if (this.rotationEnabled) {
      this.logger.debug(`[cookie-session] rung 3: rotating for profile '${profile}'`);
      const rotated = await this.rotator.rotate(cookies);
      if (rotated) {
        const jar: Record<string, string> = { [SECONDARY_COOKIE_NAME]: rotated };
        try {
          this.commitJarMerge(profile, jar);
          cookies = this.cookieStorage.load(profile);
          validation = this.validate(cookies);
          if (validation.hasPrimary && validation.fresh) {
            this.logger.debug(`[cookie-session] rung 3: rotation recovered session '${profile}'`);
            return this.toActiveSession(cookies, validation);
          }
        } catch (err) {
          this.logger.debug(`[cookie-session] rung 3: rotation commit failed for '${profile}': ${err}`);
        }
      } else {
        this.logger.debug(`[cookie-session] rung 3: rotation returned no value for '${profile}'`);
      }
    }

    this.logger.debug(`[cookie-session] rung 4: failing session for profile '${profile}'`);
    this.fail(profile, validation);
  }

  commit(profile: string, entries: Cookie[]): Cookie[];
  commit(profile: string, liveJar: { jar: Record<string, string> }): void;
  commit(profile: string, input: Cookie[] | { jar: Record<string, string> }): Cookie[] | void {
    if (Array.isArray(input)) {
      return this.commitCapture(profile, input);
    }
    this.commitJarMerge(profile, input.jar);
  }

  private commitCapture(profile: string, entries: Cookie[]): Cookie[] {
    const validation = this.validate(entries);
    if (!validation.hasPrimary) {
      throw new Error(`${PRIMARY_COOKIE_NAME} missing from captured cookies — retry 'gemiterm auth'`);
    }

    let persisted: Cookie[] | null = null;
    try {
      persisted = this.cookieStorage.load(profile);
    } catch {
      persisted = null;
    }
    if (persisted !== null && cookiesEquivalent(persisted, entries)) {
      this.logger.debug(`[cookie-session] capture unchanged for profile '${profile}', skipping write`);
      return entries;
    }

    this.cookieStorage.save(profile, entries);
    return entries;
  }

  private commitJarMerge(profile: string, jar: Record<string, string>): void {
    const stored = this.cookieStorage.load(profile);
    const expirySec = Math.floor((this.clock() + COOKIE_EXPIRY_THRESHOLD_MS) / 1000);

    let changed = false;
    const merged = stored.map((cookie) => {
      if (
        cookie.name === PRIMARY_COOKIE_NAME &&
        jar[PRIMARY_COOKIE_NAME] !== undefined &&
        jar[PRIMARY_COOKIE_NAME] !== cookie.value
      ) {
        changed = true;
        return { ...cookie, value: jar[PRIMARY_COOKIE_NAME], expires: expirySec };
      }
      if (
        cookie.name === SECONDARY_COOKIE_NAME &&
        jar[SECONDARY_COOKIE_NAME] !== undefined &&
        jar[SECONDARY_COOKIE_NAME] !== cookie.value
      ) {
        changed = true;
        return { ...cookie, value: jar[SECONDARY_COOKIE_NAME], expires: expirySec };
      }
      return cookie;
    });

    if (!changed) return;

    const validation = this.validate(merged);
    if (!validation.hasPrimary) {
      throw new Error(
        `Merged cookie set for profile '${profile}' lost ${PRIMARY_COOKIE_NAME}; refusing to write.`,
      );
    }

    this.cookieStorage.save(profile, merged);
  }

  private jarHasNewerValues(cookies: Cookie[], jar: Record<string, string>): boolean {
    for (const cookie of cookies) {
      if (cookie.name === PRIMARY_COOKIE_NAME || cookie.name === SECONDARY_COOKIE_NAME) {
        const live = jar[cookie.name];
        if (typeof live === "string" && live !== "" && live !== cookie.value) {
          return true;
        }
      }
    }
    return false;
  }

  private toActiveSession(cookies: Cookie[], validation: CookieValidation): ActiveSession {
    return {
      cookies,
      secure1psid: validation.secure1psid ?? "",
      secure1psidts: validation.secure1psidts,
      expiresAt: validation.expiresAt,
    };
  }

  private fail(profile: string, validation: CookieValidation): never {
    const binding = validation.hasPrimary ? SECONDARY_COOKIE_NAME : PRIMARY_COOKIE_NAME;
    throw new AuthenticationError(
      `No valid session for profile '${profile}': ${binding} binding failed. Run 'gemiterm auth' to authenticate.`,
    );
  }
}
