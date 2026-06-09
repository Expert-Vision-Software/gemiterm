import { ensureDir, existsFile, readJsonFile, writeTextFile, removeDir, renameDir } from "./io.ts";
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
  for (const cookie of cookies) {
    if (cookie.name === "__Secure-1PSIDTS" && cookie.expires > 0) {
      return cookie.expires * 1000;
    }
  }
  return null;
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
  save(profileName: string, cookies: Cookie[]): void {
    const filePath = getProfilePath(profileName);
    const state: StorageState = { cookies };
    writeTextFile(filePath, JSON.stringify(state, null, 2));
  }

  load(profileName: string): Cookie[] {
    const filePath = getProfilePath(profileName);
    if (!existsFile(filePath)) {
      throw new Error(
        `No storage state found for profile '${profileName}'. Run 'gemiterm auth' to authenticate.`,
      );
    }
    const state = readJsonFile<StorageState>(filePath);
    return state.cookies ?? [];
  }

  delete(profileName: string): void {
    const dir = getProfileDir(profileName);
    removeDir(dir);
  }

  list(): string[] {
    return listProfiles();
  }
}

export class ProfileManager {
  private readonly cookieStorage: CookieStorage;

  constructor(cookieStorage?: CookieStorage) {
    this.cookieStorage = cookieStorage ?? new CookieStorage();
  }

  create(profileName: string): void {
    const dir = getProfileDir(profileName);
    if (existsFile(dir)) {
      throw new Error(`Profile '${profileName}' already exists.`);
    }
    const isFirst = listProfiles().length === 0;
    ensureDir(dir);
    if (isFirst) {
      setDefaultProfileName(profileName);
    }
  }

  delete(name: string): void {
    this.cookieStorage.delete(name);
    if (getDefaultProfileName() === name) {
      const remaining = listProfiles();
      if (remaining.length > 0) {
        setDefaultProfileName(remaining[0]);
      } else {
        const marker = getDefaultProfileMarkerPath();
        if (existsFile(marker)) {
          removeDir(marker);
        }
      }
    }
  }

  rename(oldName: string, newName: string): void {
    const oldDir = getProfileDir(oldName);
    const newDir = getProfileDir(newName);
    if (!existsFile(oldDir)) {
      throw new Error(`Profile '${oldName}' does not exist.`);
    }
    if (existsFile(newDir)) {
      throw new Error(`Profile '${newName}' already exists.`);
    }
    renameDir(oldDir, newDir);
    if (getDefaultProfileName() === oldName) {
      setDefaultProfileName(newName);
    }
  }

  setDefault(name: string): void {
    if (!existsFile(getProfileDir(name))) {
      throw new Error(`Profile '${name}' does not exist.`);
    }
    setDefaultProfileName(name);
  }

  getDefault(): string {
    return getDefaultProfileName();
  }

  list(): string[] {
    return listProfiles();
  }

  getStatus(name: string): ProfileStatus {
    const defaultName = getDefaultProfileName();
    const filePath = getProfilePath(name);
    if (!existsFile(filePath)) {
      return {
        name,
        exists: false,
        isActive: false,
        expiresAt: null,
        isDefault: name === defaultName,
      };
    }
    try {
      const cookies = this.cookieStorage.load(name);
      const isActive = validateCookies(cookies) && checkCookieFreshness(cookies);
      const expiresMs = getCookieExpiryTimestamp(cookies);
      let expiresAt: string | null = null;
      if (expiresMs !== null) {
        expiresAt = new Date(expiresMs).toISOString();
      }
      return {
        name,
        exists: true,
        isActive,
        expiresAt,
        isDefault: name === defaultName,
      };
    } catch {
      return {
        name,
        exists: true,
        isActive: false,
        expiresAt: null,
        isDefault: name === defaultName,
      };
    }
  }

  getAllStatuses(): ProfileStatus[] {
    const defaultName = getDefaultProfileName();
    const profiles = listProfiles();
    return profiles.map((name) => {
      const status = this.getStatus(name);
      return { ...status, isDefault: name === defaultName };
    });
  }

  hasValidCookies(profileName: string): boolean {
    try {
      const cookies = this.cookieStorage.load(profileName);
      return validateCookies(cookies) && checkCookieFreshness(cookies);
    } catch {
      return false;
    }
  }

  loadCookiesForApi(profileName: string): { secure1psid: string; secure1psidts: string | null } {
    const cookies = this.cookieStorage.load(profileName);
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
