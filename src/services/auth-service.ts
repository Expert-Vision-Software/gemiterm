import chalk from "chalk";
import type { Cookie, AuthResult } from "../core/types.ts";
import type { Logger } from "../infrastructure/logger.ts";
import type { PlaywrightCliDriver } from "./playwright-cli-driver.ts";
import type { CookieMonitor } from "./cookie-monitor.ts";
import { CookieMonitor as CookieMonitorImpl } from "./cookie-monitor.ts";
import type { CookieStorage } from "../infrastructure/storage.ts";
import { ensureConfigDir, getDefaultProfileName } from "../infrastructure/config.ts";
import { validateProfileName } from "../infrastructure/validators.ts";
import { getProfilePath } from "../infrastructure/path-utils.ts";
import { existsFile } from "../infrastructure/io.ts";
import { isRunningElevated, ElevationError } from "../infrastructure/elevation.ts";
import { rotateCookies, isGoogleDomainCookie, COOKIE_NAMES_OF_INTEREST, type RotateCookiesResult } from "./cookie-rotation.ts";
import { CookieStorageService } from "./cookie-storage-service.ts";

const GEMINI_AUTH_URL = "https://gemini.google.com/app";
const DEFAULT_AUTH_TIMEOUT_MS = 300_000;
const SILENT_REFRESH_TIMEOUT_MS = 30_000;

export type SilentRefreshMode = "full" | "targeted";
export interface SilentRefreshOptions {
  mode?: SilentRefreshMode;
  timeoutMs?: number;
}

export function mergeCookies(existing: Cookie[], polled: Cookie[]): Cookie[] {
  const key = (c: Cookie) => `${c.name}|${c.domain}|${c.path}`;
  const polledByKey = new Map(polled.map((c) => [key(c), c]));
  const merged = existing.map((c) => polledByKey.has(key(c)) ? polledByKey.get(key(c))! : c);
  for (const c of polled) {
    if (!existing.some((e) => key(e) === key(c))) {
      merged.push(c);
    }
  }
  return merged;
}

export interface AuthServiceDeps {
  driver: PlaywrightCliDriver;
  cookieMonitor: CookieMonitor;
  cookieStorage: CookieStorage;
  cookieStorageService: CookieStorageService;
  logger: Logger;
  silentRefreshMonitorFactory?: () => CookieMonitor;
}

export class AuthServiceTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Authentication timed out after ${timeoutMs}ms. No auth cookies detected.`);
    this.name = "AuthServiceTimeoutError";
  }
}

export class AuthService {
  private readonly driver: PlaywrightCliDriver;
  private readonly cookieMonitor: CookieMonitor;
  private readonly cookieStorage: CookieStorage;
  private readonly cookieStorageService: CookieStorageService;
  private readonly logger: Logger;
  private readonly silentRefreshMonitorFactory: () => CookieMonitor;

  constructor(deps: AuthServiceDeps) {
    this.driver = deps.driver;
    this.cookieMonitor = deps.cookieMonitor;
    this.cookieStorage = deps.cookieStorage;
    this.cookieStorageService = deps.cookieStorageService;
    this.logger = deps.logger;
    this.silentRefreshMonitorFactory = deps.silentRefreshMonitorFactory
      ?? (() => new CookieMonitorImpl({ driver: deps.driver, logger: deps.logger }));
  }

  async authenticate(profileName?: string): Promise<AuthResult> {
    const name = profileName ?? getDefaultProfileName();
    validateProfileName(name);

    if (isRunningElevated()) {
      throw new ElevationError();
    }

    this.logger.info(`Starting authentication for profile: ${name}`);

    try {
      this.notifyUser(name);
      await this.launchBrowser(name);

      const cookies = await this.waitForLogin(name, DEFAULT_AUTH_TIMEOUT_MS);
      await this.extractCookies(name, cookies);
      const expiresAt = this.getCookieExpiry(cookies);
      this.confirmAuthSuccess(cookies.length, expiresAt, cookies);
      return { cookies, expiresAt };
    } finally {
      await this.closeBrowser(name);
    }
  }

  async renew(profileName?: string): Promise<AuthResult> {
    const name = profileName ?? getDefaultProfileName();
    validateProfileName(name);

    if (isRunningElevated()) {
      throw new ElevationError();
    }

    this.logger.info(`Starting session renewal for profile: ${name}`);

    try {
      console.log(
        chalk.cyan(`\n🔄 Renewing session → ${GEMINI_AUTH_URL}  (profile: ${name})`),
      );
      console.log(
        chalk.dim(
          "   Loading existing cookies — if expired, log in to extend your session.\n",
        ),
      );

      await this.launchBrowser(name);

      const statePath = getProfilePath(name);
      if (existsFile(statePath)) {
        try {
          await this.driver.stateLoad(name, statePath);
          await this.driver.evalJs(name, "location.reload()");
          this.logger.info("Pre-loaded existing cookies into browser session");
        } catch (err) {
          this.logger.debug(`Could not pre-load cookies: ${err}`);
        }
      }

      const cookies = await this.waitForLogin(name, DEFAULT_AUTH_TIMEOUT_MS);
      await this.extractCookies(name, cookies);
      const expiresAt = this.getCookieExpiry(cookies);
      this.confirmRenewSuccess(cookies.length, expiresAt, cookies);
      return { cookies, expiresAt };
    } finally {
      await this.closeBrowser(name);
    }
  }

  notifyUser(profileName: string): void {
    console.log(
      chalk.cyan(`\n🔍 Opening headed browser → ${GEMINI_AUTH_URL}  (profile: ${profileName})`),
    );
    console.log(
      chalk.dim("   Log in manually — we'll auto-detect and close the browser when you're in.\n"),
    );
  }

  async launchBrowser(profileName: string): Promise<void> {
    this.logger.info(`Launching browser for profile: ${profileName}`);
    await this.driver.openHeaded(GEMINI_AUTH_URL, profileName, profileName);
  }

  async waitForLogin(profileName: string, timeoutMs: number): Promise<Cookie[]> {
    this.logger.info(`Waiting for auth cookies (timeout: ${timeoutMs}ms)...`);

    return new Promise<Cookie[]>((resolve, reject) => {
      let settled = false;

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      const timeoutHandle = setTimeout(() => {
        this.cookieMonitor.stop();
        settle(() => reject(new AuthServiceTimeoutError(timeoutMs)));
      }, timeoutMs);

      this.cookieMonitor.start(
        profileName,
        (cookies) => {
          clearTimeout(timeoutHandle);
          settle(() => resolve(cookies));
        },
        timeoutMs,
      );
    });
  }

  async extractCookies(profileName: string, cookies: Cookie[]): Promise<void> {
    ensureConfigDir();
    this.logger.info(`Saving ${cookies.length} cookies for profile: ${profileName}`);
    this.cookieStorage.save(profileName, cookies);
  }

  confirmAuthSuccess(cookieCount: number, expiresAt: Date | null, cookies: Cookie[] = []): void {
    console.log(chalk.green(`\n✅ Login auto-detected — saving state…`));
    console.log(chalk.green(`\nAuthentication successful! (${cookieCount} cookies captured)`));
    if (expiresAt) {
      console.log(chalk.dim(`Session expires: ${expiresAt.toLocaleString()}`));
    }
    const hasSid = cookies.some((c) => c.name === "__Secure-1PSID");
    console.log(chalk.dim(`   Has __Secure-1PSID: ${hasSid ? "✅" : "❌"}`));
  }

  confirmRenewSuccess(cookieCount: number, expiresAt: Date | null, cookies: Cookie[] = []): void {
    console.log(chalk.green(`\n✅ Session renewed — saving state…`));
    console.log(chalk.green(`Renewal successful! (${cookieCount} cookies captured)`));
    if (expiresAt) {
      console.log(chalk.dim(`Session expires: ${expiresAt.toLocaleString()}`));
    }
    const hasSid = cookies.some((c) => c.name === "__Secure-1PSID");
    console.log(chalk.dim(`   Has __Secure-1PSID: ${hasSid ? "✅" : "❌"}`));
  }

  async closeBrowser(profileName: string): Promise<void> {
    this.logger.info(`Closing browser for profile: ${profileName}`);
    try {
      await this.driver.closeSession(profileName);
    } catch (err) {
      this.logger.warn(`Failed to close browser: ${err}`);
    }
  }

  async rotateCookies(profileName: string): Promise<RotateCookiesResult> {
    const name = profileName ?? getDefaultProfileName();
    try {
      validateProfileName(name);
    } catch {
      return { rotated: false, attempted: false };
    }
    try {
      return await rotateCookies(name, {
        cookieStorage: this.cookieStorage,
        cookieStorageService: this.cookieStorageService,
        logger: this.logger,
      });
    } catch (err) {
      this.logger.debug(`rotateCookies failed for profile '${name}': ${err}`);
      return { rotated: false, attempted: false };
    }
  }

  async silentRefresh(
    profileName: string,
    opts: SilentRefreshOptions = {},
  ): Promise<boolean> {
    const name = profileName ?? getDefaultProfileName();
    try {
      validateProfileName(name);
    } catch {
      return false;
    }

    const mode = opts.mode ?? "full";
    const timeoutMs = opts.timeoutMs ?? SILENT_REFRESH_TIMEOUT_MS;
    this.logger.debug(`Silent refresh attempt (mode=${mode}) for profile: ${name}`);

    if (mode === "full") {
      try {
        const l1 = await rotateCookies(name, {
          cookieStorage: this.cookieStorage,
          cookieStorageService: this.cookieStorageService,
          logger: this.logger,
        });
        if (l1.rotated) {
          return true;
        }
      } catch (err) {
        this.logger.debug(`silentRefresh: L1 rotateCookies failed: ${err}`);
      }
    }

    let snapshot: { activePsid: string; activePsidts: string | null } | null = null;
    try {
      const stored = this.cookieStorage.load(name);
      const psid = stored.find((c) => c.name === "__Secure-1PSID" && isGoogleDomainCookie(c))?.value
        ?? stored.find((c) => c.name === "__Secure-1PSID")?.value
        ?? "";
      const psidts = stored.find((c) => c.name === "__Secure-1PSIDTS" && isGoogleDomainCookie(c))?.value
        ?? stored.find((c) => c.name === "__Secure-1PSIDTS")?.value
        ?? null;
      if (psid) {
        snapshot = { activePsid: psid, activePsidts: psidts };
      }
    } catch (err) {
      this.logger.debug(`silentRefresh: snapshot load failed: ${err}`);
    }

    try {
      await this.driver.openHeadless(GEMINI_AUTH_URL, name, name);

      const statePath = getProfilePath(name);
      if (existsFile(statePath)) {
        try {
          await this.driver.stateLoad(name, statePath);
        } catch (err) {
          this.logger.debug(`silentRefresh: stateLoad failed: ${err}`);
          return false;
        }
      } else {
        this.logger.debug(`silentRefresh: no existing state for profile '${name}'`);
        return false;
      }

      const cookies = await this.waitForSilentLogin(name, timeoutMs, snapshot ?? undefined);
      if (!cookies) {
        return false;
      }
      if (!snapshot) {
        this.logger.debug(`silentRefresh: no cookie baseline for profile '${name}'; cannot verify rotation`);
        return false;
      }
      const polledPsidts = cookies.find((c) => c.name === "__Secure-1PSIDTS" && isGoogleDomainCookie(c))?.value ?? null;
      const psidtsChanged = polledPsidts !== snapshot.activePsidts;
      const existing = this.cookieStorageService.loadAllCookiesForProfile(name);

      if (mode === "targeted") {
        let updated = false;
        const next = existing.map((c) => {
          if (!COOKIE_NAMES_OF_INTEREST.has(c.name)) return c;
          const browser = cookies.find((bc) =>
            bc.name === c.name && bc.domain === c.domain && bc.path === c.path,
          );
          if (browser && browser.value !== c.value) {
            updated = true;
            return { ...c, value: browser.value };
          }
          return c;
        });
        if (!updated && !psidtsChanged) {
          this.logger.debug(`silentRefresh (targeted): no PSIDTS-related cookie changed vs baseline`);
          return false;
        }
        this.cookieStorageService.saveCookiesForProfile(name, next);
        return true;
      }

      const polledPsid = cookies.find((c) => c.name === "__Secure-1PSID" && isGoogleDomainCookie(c))?.value;
      const psidChanged = polledPsid !== undefined && polledPsid !== snapshot.activePsid;
      if (!psidChanged && !psidtsChanged) {
        this.logger.debug(`silentRefresh: cookies unchanged vs baseline, treating as no rotation`);
        return false;
      }
      const merged = mergeCookies(existing, cookies);
      this.cookieStorageService.saveCookiesForProfile(name, merged);
      return true;
    } catch (err) {
      this.logger.debug(`silentRefresh: ${err}`);
      return false;
    } finally {
      await this.closeBrowser(name);
    }
  }

  private waitForSilentLogin(
    profileName: string,
    timeoutMs: number,
    requireRotation?: { activePsid: string; activePsidts: string | null },
  ): Promise<Cookie[] | null> {
    const silentMonitor = this.silentRefreshMonitorFactory();
    return new Promise<Cookie[] | null>((resolve) => {
      let settled = false;
      const settle = (value: Cookie[] | null) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      const timeoutHandle = setTimeout(() => {
        silentMonitor.stop();
        settle(null);
      }, timeoutMs);

      silentMonitor.start(
        profileName,
        (cookies) => {
          clearTimeout(timeoutHandle);
          settle(cookies);
        },
        timeoutMs,
        requireRotation,
      );
    });
  }

  private getCookieExpiry(cookies: Cookie[]): Date | null {
    for (const cookie of cookies) {
      if (cookie.name === "__Secure-1PSIDTS" && cookie.expires > 0) {
        return new Date(cookie.expires * 1000);
      }
    }
    return null;
  }
}
