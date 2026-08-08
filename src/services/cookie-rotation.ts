import type { Logger } from "../infrastructure/logger.ts";
import type { Cookie } from "../core/types.ts";
import type { CookieStorage } from "../infrastructure/storage.ts";
import type { CookieStorageService } from "./cookie-storage-service.ts";

const ROTATE_COOKIES_URL = "https://accounts.google.com/RotateCookies";
const ROTATE_COOKIES_BODY = JSON.stringify([0, "-0000000000000000000"]);
const ROTATE_COOKIES_THROTTLE_MS = 600_000;
export const COOKIE_NAMES_OF_INTEREST = new Set(["__Secure-1PSIDTS", "__Secure-3PSIDTS", "SIDCC"]);

// In-process throttle: the earliest a profile will POST to RotateCookies again. Keyed off
// the last actual POST time (not the jar file mtime, which persistRefreshedCookies touches
// on every API call). Per-process: the auth-daemon/REPL are throttled; one-shot CLI commands
// always rotate (and thus surface 401s on dead sessions).
const lastRotatePostAt: Map<string, number> = new Map();

export interface RotateCookiesResult {
  rotated: boolean;
  attempted: boolean;
  sessionInvalid?: boolean;
}

const inFlightRotations: Map<string, Promise<RotateCookiesResult>> = new Map();

interface RotateCookiesOptions {
  cookieStorage: CookieStorage;
  cookieStorageService: CookieStorageService;
  logger: Logger;
  fetcher?: typeof fetch;
  now?: () => number;
}

interface RotateCookiesHandle {
  cookieStorage: CookieStorage;
  cookieStorageService: CookieStorageService;
  logger: Logger;
  fetcher: typeof fetch;
  now: () => number;
}

function buildCookieHeader(cookies: Cookie[]): string {
  return cookies
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

export function isGoogleDomainCookie(cookie: Cookie): boolean {
  const d = cookie.domain;
  if (!d) return false;
  const normalized = d.startsWith(".") ? d : `.${d}`;
  return normalized === ".google.com";
}

function shouldSkipForThrottle(profileName: string, now: number): boolean {
  const last = lastRotatePostAt.get(profileName);
  if (last === undefined) return false;
  return now - last < ROTATE_COOKIES_THROTTLE_MS;
}

function parseSetCookieHeader(headers: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of headers) {
    const first = raw.split(";")[0] ?? "";
    const eq = first.indexOf("=");
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    if (name) out.set(name, value);
  }
  return out;
}

function findCookie(cookies: Cookie[], name: string): Cookie | undefined {
  return cookies.find((c) => c.name === name);
}

function isCookieRotationDisabled(): boolean {
  const v = process.env.GEMITERM_SKIP_ROTATE_COOKIES;
  if (typeof v !== "string" || v.length === 0) return false;
  return v !== "0" && v.toLowerCase() !== "false";
}

async function performRotateCookies(
  profileName: string,
  handle: RotateCookiesHandle,
): Promise<RotateCookiesResult> {
  const { cookieStorage, cookieStorageService, logger, fetcher, now } = handle;

  if (isCookieRotationDisabled()) {
    logger.debug(`rotateCookies: skipped (GEMITERM_SKIP_ROTATE_COOKIES is set) for profile '${profileName}'`);
    return { rotated: false, attempted: false };
  }

  const nowMs = now();
  if (shouldSkipForThrottle(profileName, nowMs)) {
    logger.debug(`rotateCookies: skipped (throttled; last POST within ${ROTATE_COOKIES_THROTTLE_MS}ms) for profile '${profileName}'`);
    return { rotated: false, attempted: false };
  }

  let stored: Cookie[];
  try {
    stored = cookieStorage.load(profileName);
  } catch (err) {
    logger.debug(`rotateCookies: load failed for profile '${profileName}': ${err}`);
    return { rotated: false, attempted: false };
  }

  const googleCookies = stored.filter(isGoogleDomainCookie);
  if (googleCookies.length === 0) {
    logger.debug(`rotateCookies: no .google.com cookies for profile '${profileName}'`);
    return { rotated: false, attempted: false };
  }

  const cookieHeader = buildCookieHeader(googleCookies);

  lastRotatePostAt.set(profileName, nowMs);
  let response: Response;
  try {
    response = await fetcher(ROTATE_COOKIES_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Origin": "https://accounts.google.com",
        "Cookie": cookieHeader,
      },
      body: ROTATE_COOKIES_BODY,
    });
  } catch (err) {
    logger.debug(`rotateCookies: fetch failed for profile '${profileName}': ${err}`);
    return { rotated: false, attempted: false };
  }

  if (response.status !== 200) {
    const sessionInvalid = response.status === 401 || response.status === 403;
    logger.debug(`rotateCookies: non-200 status ${response.status} for profile '${profileName}'`);
    return sessionInvalid
      ? { rotated: false, attempted: false, sessionInvalid: true }
      : { rotated: false, attempted: false };
  }

  const setCookieHeaders = response.headers.getSetCookie();
  const updated = parseSetCookieHeader(setCookieHeaders);

  const storedPsidts = findCookie(stored, "__Secure-1PSIDTS");
  const newPsidts = updated.get("__Secure-1PSIDTS");
  if (!newPsidts || !storedPsidts) {
    logger.debug(`rotateCookies: no fresh __Secure-1PSIDTS in response for profile '${profileName}'`);
    return { rotated: false, attempted: true };
  }
  if (newPsidts === storedPsidts.value) {
    logger.debug(`rotateCookies: __Secure-1PSIDTS unchanged for profile '${profileName}'`);
    return { rotated: false, attempted: true };
  }

  let merged = false;
  const next = stored.map((c) => {
    if (COOKIE_NAMES_OF_INTEREST.has(c.name) && updated.has(c.name) && updated.get(c.name) !== c.value) {
      merged = true;
      return { ...c, value: updated.get(c.name)! };
    }
    return c;
  });
  if (!merged) {
    return { rotated: false, attempted: true };
  }

  try {
    cookieStorageService.saveCookiesForProfile(profileName, next);
  } catch (err) {
    logger.debug(`rotateCookies: save failed for profile '${profileName}': ${err}`);
    return { rotated: false, attempted: true };
  }
  return { rotated: true, attempted: true };
}

export function _resetRotationStateForTests(): void {
  inFlightRotations.clear();
  lastRotatePostAt.clear();
}

export async function rotateCookies(
  profileName: string,
  options: RotateCookiesOptions,
): Promise<RotateCookiesResult> {
  const inFlight = inFlightRotations.get(profileName);
  if (inFlight) return inFlight;

  const handle: RotateCookiesHandle = {
    cookieStorage: options.cookieStorage,
    cookieStorageService: options.cookieStorageService,
    logger: options.logger,
    fetcher: options.fetcher ?? fetch,
    now: options.now ?? Date.now,
  };

  const promise = performRotateCookies(profileName, handle)
    .catch((err) => {
      options.logger.debug(`rotateCookies: unexpected error for profile '${profileName}': ${err}`);
      return { rotated: false, attempted: false } as RotateCookiesResult;
    })
    .finally(() => {
      inFlightRotations.delete(profileName);
    });
  inFlightRotations.set(profileName, promise);
  return promise;
}
