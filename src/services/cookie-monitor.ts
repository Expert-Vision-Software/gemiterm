import type { Cookie } from "../core/types.ts";
import type { Logger } from "../infrastructure/logger.ts";
import type { PlaywrightCliDriver } from "./playwright-cli-driver.ts";

const POLL_INTERVAL_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 300_000;

const REQUIRED_COOKIES = new Set(["__Secure-1PSID", "__Secure-1PSIDTS"]);

const LOGIN_PROBE_JS = `document.querySelector('a[href^="https://accounts.google.com/SignOutOptions"]') !== null`;

type CookiesFoundCallback = (cookies: Cookie[]) => void;

export class CookieMonitorTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Cookie monitor timed out after ${timeoutMs}ms`);
    this.name = "CookieMonitorTimeoutError";
  }
}

export class CookieMonitorNotStartedError extends Error {
  constructor() {
    super("Cookie monitor has not been started");
    this.name = "CookieMonitorNotStartedError";
  }
}

export interface CookieMonitorDeps {
  driver: PlaywrightCliDriver;
  logger: Logger;
}

export class CookieMonitor {
  private pollingHandle: ReturnType<typeof setInterval> | null = null;
  private timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  private _stopped = false;
  private _started = false;
  private readonly driver: PlaywrightCliDriver;
  private readonly logger: Logger;

  constructor(deps: CookieMonitorDeps) {
    this.driver = deps.driver;
    this.logger = deps.logger;
  }

  get isRunning(): boolean {
    return this._started && !this._stopped;
  }

  async start(
    session: string,
    onCookiesFound: CookiesFoundCallback,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<void> {
    if (this._started) {
      this.logger.warn("CookieMonitor already started, ignoring duplicate start call");
      return;
    }

    this._started = true;
    this._stopped = false;
    this.logger.info(`Cookie monitor started for session '${session}' (timeout: ${timeoutMs}ms)`);

    this.timeoutHandle = setTimeout(() => {
      this.logger.warn("Cookie monitor hard timeout reached");
      this.stop();
    }, timeoutMs);
    this.timeoutHandle.unref();

    this.pollingHandle = setInterval(async () => {
      if (this._stopped) return;
      await this.poll(session, onCookiesFound);
    }, POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this._stopped) return;
    this._stopped = true;

    if (this.pollingHandle !== null) {
      clearInterval(this.pollingHandle);
      this.pollingHandle = null;
    }

    if (this.timeoutHandle !== null) {
      clearTimeout(this.timeoutHandle);
      this.timeoutHandle = null;
    }

    this.logger.info("Cookie monitor stopped");
  }

  async checkLoggedIn(session: string): Promise<boolean> {
    try {
      const result = await this.driver.evalJs(session, LOGIN_PROBE_JS);
      const loggedIn = result.trim() === "true";
      if (loggedIn) {
        this.logger.info("Login detected via sign-out link");
      }
      return loggedIn;
    } catch (err) {
      this.logger.debug(`checkLoggedIn eval failed: ${err}`);
      return false;
    }
  }

  async checkCookies(session: string): Promise<Cookie[]> {
    try {
      const cookies = await this.driver.cookieListFromState(session);
      const authCookies = cookies.filter((c) => REQUIRED_COOKIES.has(c.name));

      if (authCookies.length === REQUIRED_COOKIES.size) {
        this.logger.info(`Found all required auth cookies: ${authCookies.map((c) => c.name).join(", ")}`);
        return cookies;
      }

      this.logger.debug(
        `Auth cookies not yet complete (have: ${authCookies.map((c) => c.name).join(", ") ?? "none"})`,
      );
      return [];
    } catch (err) {
      this.logger.debug(`checkCookies failed: ${err}`);
      return [];
    }
  }

  private async poll(
    session: string,
    onCookiesFound: CookiesFoundCallback,
  ): Promise<void> {
    if (this._stopped) return;

    let signal: string;
    try {
      signal = await this.driver.evalJs(session, LOGIN_PROBE_JS);
    } catch {
      return;
    }

    if (signal.trim() !== "true") {
      return;
    }

    let cookies: Cookie[];
    try {
      cookies = await this.driver.cookieListFromState(session);
    } catch {
      return;
    }

    const authCookies = cookies.filter((c) => REQUIRED_COOKIES.has(c.name));
    if (authCookies.length < REQUIRED_COOKIES.size) {
      return;
    }

    this.stop();
    onCookiesFound(cookies);
  }
}
