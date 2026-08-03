import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import {
  CookieMonitor,
  CookieMonitorTimeoutError,
} from "../../src/services/cookie-monitor.ts";
import { Logger } from "../../src/infrastructure/logger.ts";
import type { Cookie } from "../../src/core/types.ts";

function createMockDriver() {
  return {
    evalJs: mock(async (_session: string, _expression: string) => "false"),
    cookieListFromState: mock(async (_session: string) => [] as Cookie[]),
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
      driver.cookieListFromState.mockResolvedValueOnce(authCookies);

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const result = await monitor.checkCookies("sess1");
      expect(result).toHaveLength(2);
      expect(result.map((c) => c.name)).toEqual(["__Secure-1PSID", "__Secure-1PSIDTS"]);
    });

    test("returns empty array when only one cookie present", async () => {
      driver.cookieListFromState.mockResolvedValueOnce([authCookies[0]!]);

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const result = await monitor.checkCookies("sess1");
      expect(result).toEqual([]);
    });

    test("returns empty array when no cookies present", async () => {
      driver.cookieListFromState.mockResolvedValueOnce([]);

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const result = await monitor.checkCookies("sess1");
      expect(result).toEqual([]);
    });

    test("returns empty array when cookieListFromState throws", async () => {
      driver.cookieListFromState.mockRejectedValueOnce(new Error("session error"));

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const result = await monitor.checkCookies("sess1");
      expect(result).toEqual([]);
    });
  });

  describe("start / stop lifecycle", () => {
    test("calls onCookiesFound once interval ticks", async () => {
      driver.evalJs.mockResolvedValue("true");
      driver.cookieListFromState.mockResolvedValue(authCookies);

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const callback = mock((_cookies: Cookie[]) => {});

      await monitor.start("sess1", callback, 10_000);
      await new Promise((r) => setTimeout(r, 2100));
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
      driver.evalJs.mockResolvedValue("false");

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const callback = mock((_cookies: Cookie[]) => {});

      const startPromise = monitor.start("sess1", callback, 10_000);
      await new Promise((r) => setTimeout(r, 100));
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

    test("does not call driver.evalJs immediately at start", async () => {
      driver.evalJs.mockResolvedValue("false");
      driver.cookieListFromState.mockResolvedValue([]);

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const callback = mock((_cookies: Cookie[]) => {});

      await monitor.start("sess1", callback, 10_000);
      expect(driver.evalJs).not.toHaveBeenCalled();
      monitor.stop();
    });

    test("calls driver.evalJs once after POLL_INTERVAL_MS", async () => {
      driver.evalJs.mockResolvedValue("false");
      driver.cookieListFromState.mockResolvedValue([]);

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const callback = mock((_cookies: Cookie[]) => {});

      await monitor.start("sess1", callback, 10_000);
      await new Promise((r) => setTimeout(r, 2100));
      expect(driver.evalJs.mock.calls.length).toBe(1);
      monitor.stop();
    });

    test("swallows repeated eval throws without rejecting", async () => {
      driver.evalJs.mockRejectedValue(new Error("session gone"));
      driver.cookieListFromState.mockResolvedValue([]);

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const callback = mock((_cookies: Cookie[]) => {});

      await expect(monitor.start("sess1", callback, 10_000)).resolves.toBeUndefined();
      await new Promise((r) => setTimeout(r, 2500));
      expect(callback).toHaveBeenCalledTimes(0);
      monitor.stop();
    });

    test("swallows repeated cookieListFromState throws without rejecting", async () => {
      driver.evalJs.mockResolvedValue("true");
      driver.cookieListFromState.mockRejectedValue(new Error("cookies unreachable"));

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const callback = mock((_cookies: Cookie[]) => {});

      await expect(monitor.start("sess1", callback, 10_000)).resolves.toBeUndefined();
      await new Promise((r) => setTimeout(r, 2500));
      expect(callback).toHaveBeenCalledTimes(0);
      monitor.stop();
    });
  });

  describe("requireRotation", () => {
    test("does not fire when PSID and PSIDTS match baseline", async () => {
      driver.evalJs.mockResolvedValue("true");
      driver.cookieListFromState.mockResolvedValue(authCookies);

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const callback = mock((_cookies: Cookie[]) => {});

      await monitor.start(
        "sess1",
        callback,
        10_000,
        { activePsid: "psid-val", activePsidts: "ts-val" },
      );
      await new Promise((r) => setTimeout(r, 2100));
      expect(callback).toHaveBeenCalledTimes(0);
      monitor.stop();
    });

    test("fires when PSID differs from baseline", async () => {
      driver.evalJs.mockResolvedValue("true");
      const rotatedCookies: Cookie[] = [
        { ...authCookies[0]!, value: "new-psid" },
        authCookies[1]!,
      ];
      driver.cookieListFromState.mockResolvedValue(rotatedCookies);

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const callback = mock((_cookies: Cookie[]) => {});

      await monitor.start(
        "sess1",
        callback,
        10_000,
        { activePsid: "psid-val", activePsidts: "ts-val" },
      );
      await new Promise((r) => setTimeout(r, 2100));
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0]![0]).toEqual(rotatedCookies);
      monitor.stop();
    });

    test("fires when PSIDTS differs from baseline", async () => {
      driver.evalJs.mockResolvedValue("true");
      const rotatedCookies: Cookie[] = [
        authCookies[0]!,
        { ...authCookies[1]!, value: "new-psidts" },
      ];
      driver.cookieListFromState.mockResolvedValue(rotatedCookies);

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const callback = mock((_cookies: Cookie[]) => {});

      await monitor.start(
        "sess1",
        callback,
        10_000,
        { activePsid: "psid-val", activePsidts: "ts-val" },
      );
      await new Promise((r) => setTimeout(r, 2100));
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0]![0]).toEqual(rotatedCookies);
      monitor.stop();
    });

    test("preserves existing behavior when requireRotation is undefined", async () => {
      driver.evalJs.mockResolvedValue("true");
      driver.cookieListFromState.mockResolvedValue(authCookies);

      const monitor = new CookieMonitor({ driver: driver as never, logger });
      const callback = mock((_cookies: Cookie[]) => {});

      await monitor.start("sess1", callback, 10_000);
      await new Promise((r) => setTimeout(r, 2100));
      expect(callback).toHaveBeenCalledTimes(1);
      expect(callback.mock.calls[0]![0]).toEqual(authCookies);
      monitor.stop();
    });
  });
});
