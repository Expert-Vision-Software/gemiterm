import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  CookieMonitor,
  CookieMonitorTimeoutError,
  BrowserClosedError,
  BROWSER_CLOSED_FAILURE_THRESHOLD,
} from "../../src/services/cookie-monitor.ts";
import { Logger } from "../../src/infrastructure/logger.ts";
import type { Cookie } from "../../src/core/types.ts";

function createMockDriver() {
  return {
    evalJs: mock(async (_session: string, _expression: string) => "false"),
    cookieList: mock(async (_session: string) => [] as Cookie[]),
  };
}

function createTestLogger(): Logger {
  const logger = new Logger("test");
  Logger.setVerbose(true);
  return logger;
}

const authCookies: Cookie[] = [
  {
    name: "__Secure-1PSID",
    value: "psid-val",
    domain: ".google.com",
    path: "/",
    expires: -1,
    httpOnly: true,
    secure: true,
    sameSite: "None",
  },
  {
    name: "__Secure-1PSIDTS",
    value: "ts-val",
    domain: ".google.com",
    path: "/",
    expires: -1,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  },
];

describe("CookieMonitor", () => {
  let driver: ReturnType<typeof createMockDriver>;
  let logger: Logger;

  beforeEach(() => {
    driver = createMockDriver();
    logger = createTestLogger();
  });

  afterEach(() => {
    mock.restore();
    Logger.setVerbose(false);
  });

  describe("checkLoggedIn", () => {
    test("returns true when eval returns 'true' (sign-out link present)", async () => {
      driver.evalJs.mockResolvedValueOnce("true");

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const result = await monitor.checkLoggedIn("sess1");
      expect(result).toBe(true);
    });

    test("returns false when eval returns 'false' (no sign-out link)", async () => {
      driver.evalJs.mockResolvedValueOnce("false");

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const result = await monitor.checkLoggedIn("sess1");
      expect(result).toBe(false);
    });

    test("returns true when eval returns 'true' with surrounding whitespace", async () => {
      driver.evalJs.mockResolvedValueOnce("  true  \n");

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const result = await monitor.checkLoggedIn("sess1");
      expect(result).toBe(true);
    });

    test("returns false when eval throws", async () => {
      driver.evalJs.mockRejectedValueOnce(new Error("browser closed"));

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const result = await monitor.checkLoggedIn("sess1");
      expect(result).toBe(false);
    });
  });

  describe("checkCookies", () => {
    test("returns auth cookies when both required cookies present", async () => {
      driver.cookieList.mockResolvedValueOnce(authCookies);

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const result = await monitor.checkCookies("sess1");
      expect(result).toHaveLength(2);
      expect(result.map((c) => c.name)).toEqual(["__Secure-1PSID", "__Secure-1PSIDTS"]);
    });

    test("returns empty array when only one cookie present", async () => {
      driver.cookieList.mockResolvedValueOnce([authCookies[0]!]);

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const result = await monitor.checkCookies("sess1");
      expect(result).toEqual([]);
    });

    test("returns empty array when no cookies present", async () => {
      driver.cookieList.mockResolvedValueOnce([]);

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const result = await monitor.checkCookies("sess1");
      expect(result).toEqual([]);
    });

    test("returns empty array when cookieList throws", async () => {
      driver.cookieList.mockRejectedValueOnce(new Error("session error"));

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const result = await monitor.checkCookies("sess1");
      expect(result).toEqual([]);
    });
  });

  describe("start / stop lifecycle", () => {
    test("calls onCookiesFound when both cookies detected immediately", async () => {
      driver.evalJs.mockResolvedValueOnce("true");
      driver.cookieList.mockResolvedValueOnce(authCookies);

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const callback = mock((_cookies: Cookie[]) => {});

      await monitor.start("sess1", callback);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(monitor.isRunning).toBe(false);
    });

    test("stop() prevents further polling", async () => {
      driver.evalJs.mockResolvedValue("false");

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const callback = mock((_cookies: Cookie[]) => {});

      const startPromise = monitor.start("sess1", callback, 10_000);
      monitor.stop();
      await startPromise;

      expect(callback).toHaveBeenCalledTimes(0);
      expect(monitor.isRunning).toBe(false);
    });

    test("does not call onCookiesFound if eval returns 'false' (not logged in)", async () => {
      driver.evalJs.mockResolvedValueOnce("false");

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const callback = mock((_cookies: Cookie[]) => {});

      const startPromise = monitor.start("sess1", callback, 10_000);
      monitor.stop();
      await startPromise;

      expect(callback).toHaveBeenCalledTimes(0);
    });

    test("stop() is idempotent", () => {
      const monitor = new CookieMonitor({ driver: driver as never, logger });
      monitor.stop();
      monitor.stop();
      monitor.stop();
      expect(monitor.isRunning).toBe(false);
    });
  });

  describe("browser-closed detection", () => {
    test("invokes onBrowserClosed after threshold consecutive eval throws", async () => {
      driver.evalJs.mockRejectedValue(new Error("session gone"));

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const onCookiesFound = mock((_cookies: Cookie[]) => {});
      const onBrowserClosed = mock(() => {});

      await monitor.start("sess1", onCookiesFound, 60_000, onBrowserClosed, { failureThreshold: 1 });
      expect(onBrowserClosed).toHaveBeenCalledTimes(1);
      expect(onCookiesFound).toHaveBeenCalledTimes(0);
    });

    test("does not invoke onBrowserClosed when threshold is not reached", async () => {
      driver.evalJs.mockRejectedValue(new Error("session gone"));

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const onCookiesFound = mock((_cookies: Cookie[]) => {});
      const onBrowserClosed = mock(() => {});

      await monitor.start("sess1", onCookiesFound, 60_000, onBrowserClosed, { failureThreshold: 5 });
      expect(onBrowserClosed).toHaveBeenCalledTimes(0);
    });

    test("invokes onBrowserClosed when cookieList throws past threshold", async () => {
      driver.evalJs.mockResolvedValue("true");
      driver.cookieList.mockRejectedValue(new Error("cookies unreachable"));

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const onCookiesFound = mock((_cookies: Cookie[]) => {});
      const onBrowserClosed = mock(() => {});

      await monitor.start("sess1", onCookiesFound, 60_000, onBrowserClosed, { failureThreshold: 1 });
      expect(onBrowserClosed).toHaveBeenCalledTimes(1);
    });

    test("does not invoke onBrowserClosed when eval succeeds and cookies present", async () => {
      driver.evalJs.mockResolvedValueOnce("true");
      driver.cookieList.mockResolvedValueOnce(authCookies);

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const onCookiesFound = mock((_cookies: Cookie[]) => {});
      const onBrowserClosed = mock(() => {});

      await monitor.start("sess1", onCookiesFound, 60_000, onBrowserClosed, { failureThreshold: 1 });
      expect(onBrowserClosed).toHaveBeenCalledTimes(0);
      expect(onCookiesFound).toHaveBeenCalledTimes(1);
    });

    test("REGRESSION: does not register failure when eval returns 'false' repeatedly", async () => {
      driver.evalJs.mockResolvedValue("false");
      driver.cookieList.mockResolvedValue([]);

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const onCookiesFound = mock((_cookies: Cookie[]) => {});
      const onBrowserClosed = mock(() => {});

      await monitor.start("sess1", onCookiesFound, 60_000, onBrowserClosed, { failureThreshold: 1 });
      expect(onBrowserClosed).toHaveBeenCalledTimes(0);
      expect(onCookiesFound).toHaveBeenCalledTimes(0);
    });

    test("does not invoke onBrowserClosed when a transient eval throw is followed by 'false'", async () => {
      driver.evalJs
        .mockRejectedValueOnce(new Error("transient"))
        .mockResolvedValue("false");
      driver.cookieList.mockResolvedValue([]);

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const onCookiesFound = mock((_cookies: Cookie[]) => {});
      const onBrowserClosed = mock(() => {});

      await monitor.start("sess1", onCookiesFound, 60_000, onBrowserClosed, { failureThreshold: 2 });
      expect(onBrowserClosed).toHaveBeenCalledTimes(0);
    });

    test("BROWSER_CLOSED_FAILURE_THRESHOLD constant is exported and positive", () => {
      expect(BROWSER_CLOSED_FAILURE_THRESHOLD).toBeGreaterThan(0);
    });

    test("BrowserClosedError is exported with correct name", () => {
      const e = new BrowserClosedError();
      expect(e.name).toBe("BrowserClosedError");
    });
  });
});
