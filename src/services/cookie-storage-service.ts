import type { Cookie } from "../core/types.ts";
import type { CookieStorage } from "../infrastructure/storage.ts";
import type { Logger } from "../infrastructure/logger.ts";
import { isGoogleDomainCookie } from "./cookie-rotation.ts";

const COOKIE_EXPIRY_THRESHOLD_MS = 60 * 60 * 1000;
const REQUIRED_COOKIE_NAMES = new Set(["__Secure-1PSID", "__Secure-1PSIDTS"]);

function resolveCookie(cookies: Cookie[], name: string): string | undefined {
  const googleMatch = cookies.find((c) => c.name === name && isGoogleDomainCookie(c));
  return googleMatch?.value ?? cookies.find((c) => c.name === name)?.value;
}

export interface LoadedCookies {
  secure_1psid: string;
  secure_1psidts: string | null;
}

export interface CookieStorageServiceDeps {
  cookieStorage: CookieStorage;
  logger: Logger;
}

export class CookieStorageService {
  private readonly cookieStorage: CookieStorage;
  private readonly logger: Logger;

  constructor(deps: CookieStorageServiceDeps) {
    this.cookieStorage = deps.cookieStorage;
    this.logger = deps.logger;
  }

  loadCookiesForProfile(profileName: string): LoadedCookies {
    const cookies = this.cookieStorage.load(profileName);
    const secure1psid = resolveCookie(cookies, "__Secure-1PSID");
    if (!secure1psid) {
      throw new Error(
        `Missing required cookie __Secure-1PSID for profile '${profileName}'. Run 'gemiterm auth' to re-authenticate.`,
      );
    }
    return {
      secure_1psid: secure1psid,
      secure_1psidts: resolveCookie(cookies, "__Secure-1PSIDTS") ?? null,
    };
  }

  loadAllCookiesForProfile(profileName: string): Cookie[] {
    return this.cookieStorage.load(profileName);
  }

  saveCookiesForProfile(profileName: string, cookies: Cookie[]): void {
    this.cookieStorage.save(profileName, cookies);
  }

  validateCookies(cookies: Cookie[]): boolean {
    const names = new Set(cookies.map((c) => c.name));
    for (const required of REQUIRED_COOKIE_NAMES) {
      if (!names.has(required)) return false;
    }
    return true;
  }

  checkCookieFreshness(cookies: Cookie[]): boolean {
    for (const cookie of cookies) {
      if (cookie.name === "__Secure-1PSIDTS" && cookie.expires > 0) {
        const threshold = Date.now() + COOKIE_EXPIRY_THRESHOLD_MS;
        if (cookie.expires * 1000 < threshold) return false;
      }
    }
    return true;
  }

  getCookieExpiry(cookies: Cookie[]): Date | null {
    const expiresMs = this.getCookieExpiryMs(cookies);
    if (expiresMs === null) return null;
    return new Date(expiresMs);
  }

  private getCookieExpiryMs(cookies: Cookie[]): number | null {
    for (const cookie of cookies) {
      if (cookie.name === "__Secure-1PSIDTS" && cookie.expires > 0) {
        return cookie.expires * 1000;
      }
    }
    return null;
  }
}
