import { ensureDir, existsFile, getFileMtime, readJsonFile, writeTextFile, removeDir, renameDir } from "./io.ts";
import type { Cookie, ProfileStatus } from "../core/types.ts";
import {
  getProfilePath,
  getProfileDir,
  getDefaultProfileMarkerPath,
} from "./path-utils.ts";
import {
  getDefaultProfileName,
  setDefaultProfileName,
  listProfiles,
} from "./config.ts";

const COOKIE_EXPIRY_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

interface StorageState {
  cookies: Cookie[];
}

function validateCookies(cookies: Cookie[]): boolean {
  const names = new Set(cookies.map((c) => c.name));
  return names.has("__Secure-1PSID") && names.has("__Secure-1PSIDTS");
}

function getCookieExpiryTimestamp(cookies: Cookie[]): number | null {
  let maxExpiry: number | null = null;
  for (const cookie of cookies) {
    if (
      (cookie.name === "__Secure-1PSID" || cookie.name === "__Secure-1PSIDTS") &&
      cookie.expires > 0
    ) {
      const ms = cookie.expires * 1000;
      if (maxExpiry === null || ms > maxExpiry) {
        maxExpiry = ms;
      }
    }
  }
  return maxExpiry;
}

function checkCookieFreshness(cookies: Cookie[]): boolean {
  for (const cookie of cookies) {
    if (cookie.name === "__Secure-1PSIDTS" && cookie.expires > 0) {
      const threshold = Date.now() + COOKIE_EXPIRY_THRESHOLD_MS;
      if (cookie.expires * 1000 < threshold) return false;
    }
  }
  return true;
}

export class CookieStorage {
  async save(profileName: string, cookies: Cookie[]): Promise<void> {
    const filePath = getProfilePath(profileName);
    const state: StorageState = { cookies };
    await writeTextFile(filePath, JSON.stringify(state, null, 2));
  }

  async load(profileName: string): Promise<Cookie[]> {
    const filePath = getProfilePath(profileName);
    if (!(await existsFile(filePath))) {
      throw new Error(
        `No storage state found for profile '${profileName}'. Run 'gemiterm auth' to authenticate.`,
      );
    }
    const state = await readJsonFile<StorageState>(filePath);
    return state.cookies ?? [];
  }

  async delete(profileName: string): Promise<void> {
    const dir = getProfileDir(profileName);
    await removeDir(dir);
  }

  async list(): Promise<string[]> {
    return await listProfiles();
  }
}

export class ProfileManager {
  private readonly cookieStorage: CookieStorage;

  constructor(cookieStorage?: CookieStorage) {
    this.cookieStorage = cookieStorage ?? new CookieStorage();
  }

  async create(profileName: string): Promise<void> {
    const dir = getProfileDir(profileName);
    if (await existsFile(dir)) {
      throw new Error(`Profile '${profileName}' already exists.`);
    }
    const isFirst = (await listProfiles()).length === 0;
    await ensureDir(dir);
    if (isFirst) {
      await setDefaultProfileName(profileName);
    }
  }

  async delete(name: string): Promise<void> {
    await this.cookieStorage.delete(name);
    if ((await getDefaultProfileName()) === name) {
      const remaining = await listProfiles();
      if (remaining.length > 0) {
        await setDefaultProfileName(remaining[0]);
      } else {
        const marker = getDefaultProfileMarkerPath();
        if (await existsFile(marker)) {
          await removeDir(marker);
        }
      }
    }
  }

  async rename(oldName: string, newName: string): Promise<void> {
    const oldDir = getProfileDir(oldName);
    const newDir = getProfileDir(newName);
    if (!(await existsFile(oldDir))) {
      throw new Error(`Profile '${oldName}' does not exist.`);
    }
    if (await existsFile(newDir)) {
      throw new Error(`Profile '${newName}' already exists.`);
    }
    await renameDir(oldDir, newDir);
    if ((await getDefaultProfileName()) === oldName) {
      await setDefaultProfileName(newName);
    }
  }

  async setDefault(name: string): Promise<void> {
    if (!(await existsFile(getProfileDir(name)))) {
      throw new Error(`Profile '${name}' does not exist.`);
    }
    await setDefaultProfileName(name);
  }

  async getDefault(): Promise<string> {
    return await getDefaultProfileName();
  }

  async list(): Promise<string[]> {
    return await listProfiles();
  }

  async getStatus(name: string): Promise<ProfileStatus> {
    const defaultName = await getDefaultProfileName();
    const filePath = getProfilePath(name);
    const lastUsedAt = (await getFileMtime(filePath))?.toISOString() ?? null;
    if (!(await existsFile(filePath))) {
      return {
        name,
        exists: false,
        isActive: false,
        expiresAt: null,
        lastUsedAt,
        isDefault: name === defaultName,
      };
    }
    try {
      const cookies = await this.cookieStorage.load(name);
      const hasValidCookies = validateCookies(cookies);
      const expiresMs = getCookieExpiryTimestamp(cookies);
      const isActive = hasValidCookies && (expiresMs === null || expiresMs > Date.now());
      let expiresAt: string | null = null;
      if (expiresMs !== null) {
        expiresAt = new Date(expiresMs).toISOString();
      }
      return {
        name,
        exists: true,
        isActive,
        expiresAt,
        lastUsedAt,
        isDefault: name === defaultName,
      };
    } catch {
      return {
        name,
        exists: true,
        isActive: false,
        expiresAt: null,
        lastUsedAt,
        isDefault: name === defaultName,
      };
    }
  }

  async getAllStatuses(): Promise<ProfileStatus[]> {
    const defaultName = await getDefaultProfileName();
    const profiles = await listProfiles();
    const statuses: ProfileStatus[] = [];
    for (const name of profiles) {
      const status = await this.getStatus(name);
      statuses.push({ ...status, isDefault: name === defaultName });
    }
    return statuses;
  }

  async hasValidCookies(profileName: string): Promise<boolean> {
    try {
      const cookies = await this.cookieStorage.load(profileName);
      return validateCookies(cookies) && checkCookieFreshness(cookies);
    } catch {
      return false;
    }
  }

  async loadCookiesForApi(profileName: string): Promise<{ secure1psid: string; secure1psidts: string | null }> {
    const cookies = await this.cookieStorage.load(profileName);
    if (!checkCookieFreshness(cookies)) {
      throw new Error(
        `Session for profile '${profileName}' appears expired. Run 'gemiterm auth' to re-authenticate.`,
      );
    }
    const map = new Map(cookies.map((c) => [c.name, c.value]));
    const secure1psid = map.get("__Secure-1PSID");
    if (!secure1psid) {
      throw new Error(`Missing required cookie __Secure-1PSID for profile '${profileName}'.`);
    }
    return {
      secure1psid,
      secure1psidts: map.get("__Secure-1PSIDTS") ?? null,
    };
  }
}
