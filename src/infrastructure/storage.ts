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
import { CookieSession, PRIMARY_COOKIE_NAME } from "../services/cookie-session.ts";
import { Logger } from "./logger.ts";

interface StorageState {
  cookies: Cookie[];
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
  private readonly session: CookieSession;

  constructor(cookieStorage?: CookieStorage, session?: CookieSession) {
    this.cookieStorage = cookieStorage ?? new CookieStorage();
    this.session =
      session ??
      new CookieSession({ cookieStorage: this.cookieStorage, logger: new Logger("storage") });
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
    const lastUsedAt = getFileMtime(filePath)?.toISOString() ?? null;
    if (!existsFile(filePath)) {
      return {
        name,
        exists: false,
        isActive: false,
        expiresAt: null,
        lastUsedAt,
        isDefault: name === defaultName,
      };
    }
    const status = this.session.sessionStatus(name);
    return {
      name,
      exists: true,
      isActive: status.active,
      expiresAt: status.expiresAt === null ? null : status.expiresAt.toISOString(),
      lastUsedAt,
      isDefault: name === defaultName,
    };
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
    return this.session.sessionStatus(profileName).active;
  }

  loadCookiesForApi(profileName: string): { secure1psid: string; secure1psidts: string | null } {
    const cookies = this.cookieStorage.load(profileName);
    const validation = this.session.validate(cookies);
    if (!validation.fresh) {
      throw new Error(
        `Session for profile '${profileName}' appears expired. Run 'gemiterm auth' to re-authenticate.`,
      );
    }
    if (!validation.hasPrimary) {
      throw new Error(
        `Missing required cookie ${PRIMARY_COOKIE_NAME} for profile '${profileName}'.`,
      );
    }
    return {
      secure1psid: validation.secure1psid!,
      secure1psidts: validation.secure1psidts,
    };
  }
}
