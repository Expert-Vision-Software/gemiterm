import type { Cookie } from "../core/types.ts";
import type { Logger } from "../infrastructure/logger.ts";
import { SessionValidationError } from "../core/errors.ts";
import { COMPANION_COOKIE_NAMES, GEMINI_APP_URL, PSIDTS_COOKIE_NAME, PSID_COOKIE_NAME } from "./auth-constants.ts";

function domainMatches(host: string, cookieDomain: string): boolean {
  const attribute = cookieDomain.startsWith(".") ? cookieDomain.slice(1) : cookieDomain;
  if (attribute === "") {
    return false;
  }
  return host === attribute || host.endsWith(`.${attribute}`);
}

function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (cookiePath === "") {
    return true;
  }
  if (requestPath === cookiePath) {
    return true;
  }
  if (requestPath.startsWith(cookiePath)) {
    return cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/";
  }
  return false;
}

function parseUrl(url: string): { host: string; path: string } {
  const parsed = new URL(url);
  return { host: parsed.hostname, path: parsed.pathname === "" ? "/" : parsed.pathname };
}

export function isRoutableTo(cookie: Cookie, url: string): boolean {
  const { host, path } = parseUrl(url);
  if (cookie.expires > 0 && cookie.expires * 1000 <= Date.now()) {
    return false;
  }
  return domainMatches(host, cookie.domain) && pathMatches(path, cookie.path);
}

export interface CookieValidatorDeps {
  logger: Logger;
}

export class CookieValidator {
  private companionWarned = false;
  private readonly logger: Logger;

  constructor(deps: CookieValidatorDeps) {
    this.logger = deps.logger;
  }

  validate(cookies: Cookie[]): void {
    const psid = cookies.find((c) => c.name === PSID_COOKIE_NAME);
    if (!psid) {
      throw new SessionValidationError(
        `Missing required cookie ${PSID_COOKIE_NAME}. Run 'gemiterm auth' to authenticate.`,
      );
    }

    const psidts = cookies.find((c) => c.name === PSIDTS_COOKIE_NAME);
    if (!psidts) {
      throw new SessionValidationError(
        `Missing required cookie ${PSIDTS_COOKIE_NAME}. Run 'gemiterm auth' to authenticate.`,
      );
    }

    const routable = cookies.some((c) => c.name === PSIDTS_COOKIE_NAME && isRoutableTo(c, GEMINI_APP_URL));
    if (!routable) {
      throw new SessionValidationError(
        `Cookie ${PSIDTS_COOKIE_NAME} is expired or not routable to ${GEMINI_APP_URL}. Run 'gemiterm auth' to authenticate.`,
      );
    }

    this.warnOnMissingCompanions(cookies);
  }

  private warnOnMissingCompanions(cookies: Cookie[]): void {
    if (this.companionWarned) {
      return;
    }
    const present = new Set(cookies.map((c) => c.name));
    const hasAnyCompanion = COMPANION_COOKIE_NAMES.some((name) => present.has(name));
    if (!hasAnyCompanion) {
      this.companionWarned = true;
      this.logger.warn(
        `Session jar has none of the companion cookies (${COMPANION_COOKIE_NAMES.join(", ")}). ` +
          "Un-ablated surfaces may misbehave; run 'gemiterm auth' to capture a full jar.",
      );
    }
  }
}
