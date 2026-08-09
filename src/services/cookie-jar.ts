import type { Cookie } from "../core/types.ts";
import type { Logger } from "../infrastructure/logger.ts";
import type { CookieStorageService } from "./cookie-storage-service.ts";

function cookieKey(c: Cookie): string {
  return `${c.name}|${c.domain}|${c.path}`;
}

export interface CookieJarDeps {
  cookieStorageService: CookieStorageService;
  logger: Logger;
}

export class CookieJar {
  private readonly cookieStorageService: CookieStorageService;
  private readonly logger: Logger;

  constructor(deps: CookieJarDeps) {
    this.cookieStorageService = deps.cookieStorageService;
    this.logger = deps.logger;
  }

  replace(profileName: string, cookies: Cookie[]): void {
    try {
      this.cookieStorageService.saveCookiesForProfile(profileName, cookies);
      this.logger.debug(`CookieJar.replace: saved ${cookies.length} cookies for profile '${profileName}'`);
    } catch (err) {
      this.logger.debug(`CookieJar.replace: failed for profile '${profileName}': ${err}`);
      throw err;
    }
  }

  upsert(profileName: string, cookies: Cookie[]): void {
    try {
      const existing = this.cookieStorageService.loadAllCookiesForProfile(profileName);
      const polledByKey = new Map(cookies.map((c) => [cookieKey(c), c]));
      const merged = existing.map((c) => polledByKey.has(cookieKey(c)) ? polledByKey.get(cookieKey(c))! : c);
      for (const c of cookies) {
        if (!existing.some((e) => cookieKey(e) === cookieKey(c))) {
          merged.push(c);
        }
      }
      this.cookieStorageService.saveCookiesForProfile(profileName, merged);
      this.logger.debug(`CookieJar.upsert: merged ${cookies.length} into jar for profile '${profileName}'`);
    } catch (err) {
      this.logger.debug(`CookieJar.upsert: failed for profile '${profileName}': ${err}`);
      throw err;
    }
  }
}
