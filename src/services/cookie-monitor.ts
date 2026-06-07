import type { Cookie } from "../core/types.ts";
import type { Logger } from "../infrastructure/logger.ts";
import type { PlaywrightCliDriver } from "./playwright-cli-driver.ts";

const POLL_INTERVAL_MS = 2_000;
const DEFAULT_TIMEOUT_MS = 300_000;
export const BROWSER_CLOSED_FAILURE_THRESHOLD = 5;

const REQUIRED_COOKIES = new Set(["__Secure-1PSID", "__Secure-1PSIDTS"]);

type CookiesFoundCallback = (cookies: Cookie[]) => void;
type BrowserClosedCallback = () => void;

export class CookieMonitorTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Cookie monitor timed out after ${timeoutMs}ms`);
    this.name = "CookieMonitorTimeoutError";
  }
}

export class BrowserClosedError extends Error {
  constructor() {
    super("Browser was closed before login completed.");
    this.name = "BrowserClosedError";
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
  private consecutiveFailures = 0;
  private onBrowserClosedRef: BrowserClosedCallback | null = null;
  private failureThreshold = BROWSER_CLOSED_FAILURE_THRESHOLD;
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
    onBrowserClosed?: BrowserClosedCallback,
    options: { failureThreshold?: number } = {},
  ): Promise<void> {
    if (this._started) {
      this.logger.warn("CookieMonitor already started, ignoring duplicate start call");
      return;
    }

    this._started = true;
    this._stopped = false;
    this.consecutiveFailures = 0;
    this.onBrowserClosedRef = onBrowserClosed ?? null;
    this.failureThreshold = options.failureThreshold ?? BROWSER_CLOSED_FAILURE_THRESHOLD;
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

    await this.poll(session, onCookiesFound);
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
      const result = await this.driver.evalJs(
        session,
        `(() => {
          const url = window.location.href;
          const onApp = url.includes("gemini.google.com/app");
          const textarea = document.querySelector('textarea[aria-label*="prompt" i]');
          return JSON.stringify({ onApp, hasPrompt: !!textarea });
        })()`,
      );

      const parsed = JSON.parse(result) as { onApp: boolean; hasPrompt: boolean };
      const loggedIn = parsed.onApp || parsed.hasPrompt;
      if (loggedIn) {
        this.logger.info(
          `Login signal detected: onApp=${parsed.onApp} hasPrompt=${parsed.hasPrompt}`,
        );
      }
      return loggedIn;
    } catch (err) {
      this.logger.debug(`checkLoggedIn eval failed: ${err}`);
      return false;
    }
  }

  async checkCookies(session: string): Promise<Cookie[]> {
    try {
      const cookies = await this.driver.cookieList(session);
      const authCookies = cookies.filter((c) => REQUIRED_COOKIES.has(c.name));

      if (authCookies.length === REQUIRED_COOKIES.size) {
        this.logger.info(`Found all required auth cookies: ${authCookies.map((c) => c.name).join(", ")}`);
        return authCookies;
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

    let isLoggedIn = false;
    try {
      isLoggedIn = await this.checkLoggedIn(session);
    } catch {
      this.registerFailure();
      return;
    }

    if (isLoggedIn) {
      this.consecutiveFailures = 0;
    } else {
      this.registerFailure();
      return;
    }

    let authCookies: Cookie[] = [];
    try {
      authCookies = await this.checkCookies(session);
    } catch {
      this.registerFailure();
      return;
    }

    if (authCookies.length < REQUIRED_COOKIES.size) {
      this.registerFailure();
      return;
    }

    this.consecutiveFailures = 0;
    this.stop();
    onCookiesFound(authCookies);
  }

  private registerFailure(): void {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.failureThreshold) {
      this.logger.warn(
        `Browser appears closed (${this.consecutiveFailures} consecutive poll failures)`,
      );
      const cb = this.onBrowserClosedRef;
      this.stop();
      cb?.();
    }
  }
}
