import chalk from "chalk";
import { createInterface } from "node:readline";
import type { Cookie, AuthResult } from "../core/types.ts";
import type { Logger } from "../infrastructure/logger.ts";
import type { PlaywrightCliDriver } from "./playwright-cli-driver.ts";
import type { CookieMonitor } from "./cookie-monitor.ts";
import type { CookieStorage } from "../infrastructure/storage.ts";
import { ensureConfigDir, getDefaultProfileName } from "../infrastructure/config.ts";
import { validateProfileName } from "../infrastructure/validators.ts";

const GEMINI_AUTH_URL = "https://gemini.google.com";
const DEFAULT_AUTH_TIMEOUT_MS = 300_000;
const SESSION_PREFIX = "auth";

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

    this.logger.info(`Starting authentication for profile: ${name}`);

    this.promptUser();
    await this.waitForEnter();
    await this.launchBrowser(name);
    this.startCookieMonitor(name);
    const cookies = await this.waitForCookies(name, DEFAULT_AUTH_TIMEOUT_MS);
    await this.extractCookies(name, cookies);
    const expiresAt = this.getCookieExpiry(cookies);
    this.confirmAuthSuccess(cookies.length, expiresAt);
    await this.closeBrowser(name);

    return { cookies, expiresAt };
  }

  promptUser(): void {
    console.log(chalk.cyan("Press Enter to launch browser..."));
  }

  async waitForEnter(): Promise<void> {
    return new Promise<void>((resolve) => {
      const rl = createInterface({ input: process.stdin });
      rl.question("", () => {
        rl.close();
        resolve();
      });
    });
  }

  async launchBrowser(profileName: string): Promise<void> {
    const sessionName = this.getSessionName(profileName);
    this.logger.info(`Launching browser for profile: ${profileName}`);
    await this.driver.openHeaded(GEMINI_AUTH_URL, profileName, sessionName);
  }

  startCookieMonitor(profileName: string): void {
    const sessionName = this.getSessionName(profileName);
    this.logger.info(`Cookie monitor target session: ${sessionName}`);
  }

  async waitForCookies(profileName: string, timeoutMs = DEFAULT_AUTH_TIMEOUT_MS): Promise<Cookie[]> {
    const sessionName = this.getSessionName(profileName);

    return new Promise<Cookie[]>((resolve, reject) => {
      this.logger.info(`Waiting for auth cookies (timeout: ${timeoutMs}ms)...`);

      const timeoutHandle = setTimeout(() => {
        this.cookieMonitor.stop();
        reject(new AuthServiceTimeoutError(timeoutMs));
      }, timeoutMs);

      this.cookieMonitor.start(sessionName, (cookies) => {
        clearTimeout(timeoutHandle);
        resolve(cookies);
      }, timeoutMs);
    });
  }

  async extractCookies(profileName: string, cookies: Cookie[]): Promise<void> {
    ensureConfigDir();
    this.logger.info(`Saving ${cookies.length} cookies for profile: ${profileName}`);
    this.cookieStorage.save(profileName, cookies);
  }

  confirmAuthSuccess(cookieCount: number, expiresAt: Date | null): void {
    console.log(chalk.green(`\nAuthentication successful! (${cookieCount} cookies captured)`));
    if (expiresAt) {
      console.log(chalk.dim(`Session expires: ${expiresAt.toLocaleString()}`));
    }
  }

  async closeBrowser(profileName: string): Promise<void> {
    this.logger.info(`Closing browser for profile: ${profileName}`);
    try {
      await this.driver.closeAll();
    } catch (err) {
      this.logger.warn(`Failed to close browser: ${err}`);
    }
  }

  private getSessionName(profileName: string): string {
    return `${SESSION_PREFIX}-${profileName}`;
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
