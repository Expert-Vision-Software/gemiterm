import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { CookieMonitor, CookieMonitorTimeoutError } from "../../src/services/cookie-monitor.ts";
import { Logger } from "../../src/infrastructure/logger.ts";
import type { Cookie } from "../../src/core/types.ts";

function createMockDriver() {
  return {
    evalJs: mock(async (_session: string, _expression: string) => ""),
    cookieList: mock(async (_session: string) => [] as Cookie[]),
  };
}

function createTestLogger(): Logger {
  const logger = new Logger("test");
  Logger.setVerbose(true);
  return logger;
}

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
    test("returns true when on app page with prompt textarea", async () => {
      driver.evalJs.mockResolvedValue(
        JSON.stringify({ onApp: true, hasPrompt: true }),
      );

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const result = await monitor.checkLoggedIn("sess1");
      expect(result).toBe(true);
    });

    test("returns false when not on app page", async () => {
      driver.evalJs.mockResolvedValue(
        JSON.stringify({ onApp: false, hasPrompt: false }),
      );

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const result = await monitor.checkLoggedIn("sess1");
      expect(result).toBe(false);
    });

    test("returns false when on app page but no prompt textarea", async () => {
      driver.evalJs.mockResolvedValue(
        JSON.stringify({ onApp: true, hasPrompt: false }),
      );

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const result = await monitor.checkLoggedIn("sess1");
      expect(result).toBe(false);
    });

    test("returns false when eval throws", async () => {
      driver.evalJs.mockRejectedValue(new Error("browser closed"));

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const result = await monitor.checkLoggedIn("sess1");
      expect(result).toBe(false);
    });
  });

  describe("checkCookies", () => {
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

    test("returns auth cookies when both required cookies present", async () => {
      driver.cookieList.mockResolvedValue(authCookies);

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const result = await monitor.checkCookies("sess1");
      expect(result).toHaveLength(2);
      expect(result.map((c) => c.name)).toEqual(["__Secure-1PSID", "__Secure-1PSIDTS"]);
    });

    test("returns empty array when only one cookie present", async () => {
      driver.cookieList.mockResolvedValue([authCookies[0]]);

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const result = await monitor.checkCookies("sess1");
      expect(result).toEqual([]);
    });

    test("returns empty array when no cookies present", async () => {
      driver.cookieList.mockResolvedValue([]);

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const result = await monitor.checkCookies("sess1");
      expect(result).toEqual([]);
    });

    test("returns empty array when cookieList throws", async () => {
      driver.cookieList.mockRejectedValue(new Error("session error"));

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const result = await monitor.checkCookies("sess1");
      expect(result).toEqual([]);
    });
  });

  describe("start / stop lifecycle", () => {
    test("calls onCookiesFound when both cookies detected immediately", async () => {
      driver.evalJs.mockResolvedValue(
        JSON.stringify({ onApp: true, hasPrompt: true }),
      );
      driver.cookieList.mockResolvedValue([
        {
          name: "__Secure-1PSID",
          value: "v1",
          domain: ".google.com",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: "None",
        },
        {
          name: "__Secure-1PSIDTS",
          value: "v2",
          domain: ".google.com",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: "Lax",
        },
      ]);

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const callback = mock((_cookies: Cookie[]) => {});

      await monitor.start("sess1", callback);
      expect(callback).toHaveBeenCalledTimes(1);
      expect(monitor.isRunning).toBe(false);
    });

    test("stop() prevents further polling", async () => {
      driver.evalJs.mockResolvedValue(
        JSON.stringify({ onApp: false, hasPrompt: false }),
      );

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const callback = mock((_cookies: Cookie[]) => {});

      const startPromise = monitor.start("sess1", callback, 10_000);
      monitor.stop();
      await startPromise;

      expect(callback).toHaveBeenCalledTimes(0);
      expect(monitor.isRunning).toBe(false);
    });

    test("does not call onCookiesFound if not logged in", async () => {
      driver.evalJs.mockResolvedValue(
        JSON.stringify({ onApp: false, hasPrompt: false }),
      );

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
});
