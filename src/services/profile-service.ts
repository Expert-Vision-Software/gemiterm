import type { AuthResult, ProfileStatus, Cookie } from "../core/types.ts";
import type { Logger } from "../infrastructure/logger.ts";
import type { ProfileManager } from "../infrastructure/storage.ts";
import { validateProfileName } from "../infrastructure/validators.ts";
import { ensureConfigDir, getDefaultProfileName } from "../infrastructure/config.ts";
import { AuthenticationError, GemitermError } from "../core/errors.ts";

export class ProfileService {
  private readonly profileManager: ProfileManager;
  private readonly logger: Logger;

  constructor(profileManager: ProfileManager, logger: Logger) {
    this.profileManager = profileManager;
    this.logger = logger;
  }

  async authenticate(profileName?: string): Promise<AuthResult> {
    const name = profileName ?? getDefaultProfileName();
    validateProfileName(name);

    ensureConfigDir();
    const profiles = this.profileManager.list();

    if (!profiles.includes(name)) {
      this.profileManager.create(name);
      this.logger.info(`Created new profile: ${name}`);
    }

    if (!this.profileManager.hasRequiredCookies(name)) {
      throw new AuthenticationError(
        `No valid session for profile '${name}'. Run 'gemiterm login' to authenticate.`,
      );
    }

    this.logger.info(`Authenticated with profile: ${name}`);
    const cookies = this.profileManager.loadCookiesForApi(name);
    const expiresMs = this.getCookieExpiryForProfile(name);

    return {
      cookies: this.buildCookieArray(cookies),
      expiresAt: expiresMs !== null ? new Date(expiresMs) : null,
    };
  }

  async getProfileStatuses(): Promise<ProfileStatus[]> {
    ensureConfigDir();
    return this.profileManager.getAllStatuses();
  }

  async getAuthStatus(): Promise<{ authenticated: boolean; profileName: string | null }> {
    const defaultName = getDefaultProfileName();
    if (!defaultName) {
      return { authenticated: false, profileName: null };
    }
    const isValid = this.profileManager.hasRequiredCookies(defaultName);
    return { authenticated: isValid, profileName: isValid ? defaultName : null };
  }

  async deleteProfile(name: string): Promise<void> {
    validateProfileName(name);
    const profiles = this.profileManager.list();
    if (!profiles.includes(name)) {
      throw new GemitermError(`Profile '${name}' does not exist.`);
    }
    this.profileManager.delete(name);
    this.logger.info(`Deleted profile: ${name}`);
  }

  async renameProfile(oldName: string, newName: string): Promise<void> {
    validateProfileName(oldName);
    validateProfileName(newName);
    this.profileManager.rename(oldName, newName);
    this.logger.info(`Renamed profile: ${oldName} → ${newName}`);
  }

  async setDefaultProfile(name: string): Promise<void> {
    validateProfileName(name);
    this.profileManager.setDefault(name);
    this.logger.info(`Set default profile: ${name}`);
  }

  private getCookieExpiryForProfile(profileName: string): number | null {
    try {
      const status = this.profileManager.getStatus(profileName);
      if (!status.expiresAt) return null;
      return Date.parse(status.expiresAt);
    } catch {
      return null;
    }
  }

  private buildCookieArray(
    cookies: { secure1psid: string; secure1psidts: string | null },
  ): Cookie[] {
    const result: Cookie[] = [
      {
        name: "__Secure-1PSID",
        value: cookies.secure1psid,
        domain: ".google.com",
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: "None",
      },
    ];
    if (cookies.secure1psidts) {
      result.push({
        name: "__Secure-1PSIDTS",
        value: cookies.secure1psidts,
        domain: ".google.com",
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: "None",
      });
    }
    return result;
  }
}
