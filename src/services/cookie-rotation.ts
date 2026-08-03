import type { Logger } from "../infrastructure/logger.ts";
import type { Cookie } from "../core/types.ts";
import { getFileMtime } from "../infrastructure/io.ts";
import { getProfilePath } from "../infrastructure/path-utils.ts";
import type { CookieStorage } from "../infrastructure/storage.ts";

const ROTATE_COOKIES_URL = "https://accounts.google.com/RotateCookies";
const ROTATE_COOKIES_BODY = JSON.stringify([0, "-0000000000000000000"]);
const DISK_MTIME_GUARD_MS = 600_000;
const COOKIE_NAMES_OF_INTEREST = new Set(["__Secure-1PSIDTS", "__Secure-3PSIDTS", "SIDCC"]);

const inFlightRotations: Map<string, Promise<boolean>> = new Map();

interface RotateCookiesOptions {
  cookieStorage: CookieStorage;
  logger: Logger;
  fetcher?: typeof fetch;
  now?: () => number;
}

interface RotateCookiesHandle {
  cookieStorage: CookieStorage;
  logger: Logger;
  fetcher: typeof fetch;
  now: () => number;
}

function buildCookieHeader(cookies: Cookie[]): string {
  return cookies
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

function isGoogleDomainCookie(cookie: Cookie): boolean {
  const d = cookie.domain;
  if (!d) return false;
  const normalized = d.startsWith(".") ? d : `.${d}`;
  return normalized === ".google.com";
}

function shouldSkipForDiskMtime(profileName: string, now: number): boolean {
  const mtime = getFileMtime(getProfilePath(profileName));
  if (mtime === null) return false;
  return now - mtime.getTime() < DISK_MTIME_GUARD_MS;
}

function parseSetCookieHeader(header: string | string[] | undefined): Map<string, string> {
  const out = new Map<string, string>();
  if (!header) return out;
  const list = Array.isArray(header) ? header : [header];
  for (const raw of list) {
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
): Promise<boolean> {
  const { cookieStorage, logger, fetcher, now } = handle;

  if (isCookieRotationDisabled()) {
    logger.debug(`rotateCookies: skipped (GEMITERM_SKIP_ROTATE_COOKIES is set) for profile '${profileName}'`);
    return false;
  }

  if (shouldSkipForDiskMtime(profileName, now())) {
    logger.debug(`rotateCookies: skipped (storage_state.json mtime within ${DISK_MTIME_GUARD_MS}ms) for profile '${profileName}'`);
    return false;
  }

  let stored: Cookie[];
  try {
    stored = cookieStorage.load(profileName);
  } catch (err) {
    logger.debug(`rotateCookies: load failed for profile '${profileName}': ${err}`);
    return false;
  }

  const googleCookies = stored.filter(isGoogleDomainCookie);
  if (googleCookies.length === 0) {
    logger.debug(`rotateCookies: no .google.com cookies for profile '${profileName}'`);
    return false;
  }

  const cookieHeader = buildCookieHeader(googleCookies);

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
    return false;
  }

  if (response.status !== 200) {
    logger.debug(`rotateCookies: non-200 status ${response.status} for profile '${profileName}'`);
    return false;
  }

  const setCookieHeader = response.headers.get("set-cookie");
  const updated = parseSetCookieHeader(setCookieHeader ?? undefined);

  const storedPsidts = findCookie(stored, "__Secure-1PSIDTS");
  const newPsidts = updated.get("__Secure-1PSIDTS");
  if (!newPsidts || !storedPsidts) {
    logger.debug(`rotateCookies: no fresh __Secure-1PSIDTS in response for profile '${profileName}'`);
    return false;
  }
  if (newPsidts === storedPsidts.value) {
    logger.debug(`rotateCookies: __Secure-1PSIDTS unchanged for profile '${profileName}'`);
    return false;
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
    return false;
  }

  try {
    cookieStorage.save(profileName, next);
  } catch (err) {
    logger.debug(`rotateCookies: save failed for profile '${profileName}': ${err}`);
    return false;
  }
  return true;
}

export function _resetInFlightRotationsForTests(): void {
  inFlightRotations.clear();
}

export async function rotateCookies(
  profileName: string,
  options: RotateCookiesOptions,
): Promise<boolean> {
  const inFlight = inFlightRotations.get(profileName);
  if (inFlight) return inFlight;

  const handle: RotateCookiesHandle = {
    cookieStorage: options.cookieStorage,
    logger: options.logger,
    fetcher: options.fetcher ?? fetch,
    now: options.now ?? Date.now,
  };

  const promise = performRotateCookies(profileName, handle)
    .catch((err) => {
      options.logger.debug(`rotateCookies: unexpected error for profile '${profileName}': ${err}`);
      return false;
    })
    .finally(() => {
      inFlightRotations.delete(profileName);
    });
  inFlightRotations.set(profileName, promise);
  return promise;
}
