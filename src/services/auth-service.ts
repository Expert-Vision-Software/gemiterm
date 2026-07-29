import chalk from "chalk";
import type { Cookie, AuthResult } from "../core/types.ts";
import type { Logger } from "../infrastructure/logger.ts";
import type { PlaywrightCliDriver } from "./playwright-cli-driver.ts";
import type { CookieMonitor } from "./cookie-monitor.ts";
import type { CookieStorage } from "../infrastructure/storage.ts";
import { ensureConfigDir, getDefaultProfileName } from "../infrastructure/config.ts";
import { validateProfileName } from "../infrastructure/validators.ts";
import { getProfilePath } from "../infrastructure/path-utils.ts";
import { existsFile } from "../infrastructure/io.ts";
import { isRunningElevated, ElevationError } from "../infrastructure/elevation.ts";

const GEMINI_AUTH_URL = "https://gemini.google.com/app";
const DEFAULT_AUTH_TIMEOUT_MS = 300_000;

export interface AuthServiceDeps {
  driver: PlaywrightCliDriver;
  cookieMonitor: CookieMonitor;
  cookieStorage: CookieStorage;
  logger: Logger;
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
  private readonly logger: Logger;

  constructor(deps: AuthServiceDeps) {
    this.driver = deps.driver;
    this.cookieMonitor = deps.cookieMonitor;
    this.cookieStorage = deps.cookieStorage;
    this.logger = deps.logger;
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

  private getCookieExpiry(cookies: Cookie[]): Date | null {
    for (const cookie of cookies) {
      if (cookie.name === "__Secure-1PSIDTS" && cookie.expires > 0) {
        return new Date(cookie.expires * 1000);
      }
    }
    return null;
  }
}
