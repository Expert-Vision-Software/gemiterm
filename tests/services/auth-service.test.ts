import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import {
  AuthService,
  AuthServiceTimeoutError,
} from "../../src/services/auth-service.ts";
import { Logger } from "../../src/infrastructure/logger.ts";
import type { Cookie } from "../../src/core/types.ts";
import type { CookieStorage } from "../../src/infrastructure/storage.ts";

function createMockDriver() {
  return {
    openHeaded: mock(async (_url: string, _profile: string, _session?: string) => {}),
    closeSession: mock(async (_session: string) => {}),
    closeAll: mock(async () => {}),
  };
}

function createMockCookieMonitor() {
  return {
    start: mock(
      async (
        _session: string,
        _onCookiesFound: (cookies: Cookie[]) => void,
        _timeoutMs?: number,
      ) => {},
    ),
    stop: mock(() => {}),
    isRunning: false,
  };
}

function createMockCookieStorage() {
  return {
    save: mock((_profileName: string, _cookies: Cookie[]) => {}),
    load: mock((_profileName: string) => [] as Cookie[]),
    delete: mock((_profileName: string) => {}),
    list: mock(() => [] as string[]),
  };
}

function createTestLogger(): Logger {
  const logger = new Logger("test");
  Logger.setVerbose(true);
  return logger;
}

function makeAuthCookies(): Cookie[] {
  const farFuture = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  return [
    {
      name: "__Secure-1PSID",
      value: "test-psid-value",
      domain: ".google.com",
      path: "/",
      expires: -1,
      httpOnly: true,
      secure: true,
      sameSite: "None",
    },
    {
      name: "__Secure-1PSIDTS",
      value: "test-psidts-value",
      domain: ".google.com",
      path: "/",
      expires: farFuture,
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ];
}

function buildService(
  driver: ReturnType<typeof createMockDriver>,
  cookieMonitor: ReturnType<typeof createMockCookieMonitor>,
  cookieStorage: ReturnType<typeof createMockCookieStorage>,
  logger: Logger,
) {
  return new AuthService({
    driver: driver as never,
    cookieMonitor: cookieMonitor as never,
    cookieStorage: cookieStorage as never,
    logger,
  });
}

describe("AuthService", () => {
  let driver: ReturnType<typeof createMockDriver>;
  let cookieMonitor: ReturnType<typeof createMockCookieMonitor>;
  let cookieStorage: ReturnType<typeof createMockCookieStorage>;
  let logger: Logger;

  beforeEach(() => {
    driver = createMockDriver();
    cookieMonitor = createMockCookieMonitor();
    cookieStorage = createMockCookieStorage();
    logger = createTestLogger();
  });

  afterEach(() => {
    mock.restore();
    Logger.setVerbose(false);
  });

  describe("authenticate", () => {
    test("completes full auth flow and returns cookies", async () => {
      const authCookies = makeAuthCookies();
      cookieMonitor.start.mockImplementationOnce(
        async (_session, callback) => {
          callback(authCookies);
        },
      );

      const logSpy = spyOn(console, "log").mockImplementation(() => {});

      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);
      const result = await svc.authenticate("test-profile");

      expect(result.cookies).toHaveLength(2);
      expect(result.cookies[0]!.name).toBe("__Secure-1PSID");
      expect(result.expiresAt).not.toBeNull();
      expect(driver.openHeaded).toHaveBeenCalledTimes(1);
      expect(cookieMonitor.start).toHaveBeenCalledTimes(1);
      expect(cookieStorage.save).toHaveBeenCalledTimes(1);
      expect(driver.closeSession).toHaveBeenCalledTimes(1);
      expect(driver.closeSession).toHaveBeenCalledWith("test-profile");
      expect(driver.closeAll).not.toHaveBeenCalled();
      logSpy.mockRestore();
    });

    test("rejects on timeout", async () => {
      cookieMonitor.start.mockImplementationOnce(
        async () => {
          // never invokes callback -> hard timeout fires
        },
      );

      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);

      await expect(svc.waitForLogin("default", 50)).rejects.toBeInstanceOf(
        AuthServiceTimeoutError,
      );
    });

    test("calls closeBrowser in finally even when waitForLogin throws", async () => {
      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);
      const spy = spyOn(svc, "waitForLogin").mockRejectedValueOnce(new Error("boom"));

      await expect(svc.authenticate("test-profile")).rejects.toThrow("boom");
      expect(driver.closeSession).toHaveBeenCalledWith("test-profile");
      spy.mockRestore();
    });

    test("throws on invalid profile name", async () => {
      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);
      await expect(svc.authenticate("bad name!")).rejects.toThrow("invalid characters");
    });
  });

  describe("notifyUser", () => {
    test("prints the URL and a hint about auto-detection", () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});

      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);
      svc.notifyUser("default");

      const all = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(all).toContain("Opening headed browser");
      expect(all).toContain("https://gemini.google.com/app");
      expect(all).toContain("auto-detect");
      logSpy.mockRestore();
    });
  });

  describe("launchBrowser", () => {
    test("calls openHeaded with app URL, profile name as both profile and session", async () => {
      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);

      await svc.launchBrowser("my-profile");

      expect(driver.openHeaded).toHaveBeenCalledTimes(1);
      expect(driver.openHeaded).toHaveBeenCalledWith(
        "https://gemini.google.com/app",
        "my-profile",
        "my-profile",
      );
    });
  });

  describe("waitForLogin", () => {
    test("resolves with cookies when monitor callback fires", async () => {
      const authCookies = makeAuthCookies();
      cookieMonitor.start.mockImplementationOnce(
        async (_session, callback) => {
          callback(authCookies);
        },
      );

      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);
      const cookies = await svc.waitForLogin("default", 60_000);
      expect(cookies).toHaveLength(2);
      expect(cookies[0]!.name).toBe("__Secure-1PSID");
    });

    test("rejects with AuthServiceTimeoutError on hard timeout", async () => {
      cookieMonitor.start.mockImplementationOnce(async () => {});

      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);

      await expect(svc.waitForLogin("default", 50)).rejects.toBeInstanceOf(
        AuthServiceTimeoutError,
      );
    });

    test("stops cookie monitor on timeout", async () => {
      cookieMonitor.start.mockImplementationOnce(async () => {});

      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);

      try {
        await svc.waitForLogin("default", 50);
      } catch {
        // expected
      }

      expect(cookieMonitor.stop).toHaveBeenCalled();
    });

    test("does not double-resolve when timeout and callback race", async () => {
      cookieMonitor.start.mockImplementationOnce(
        async (_session, callback) => {
          // schedule callback AND let the timeout race
          setTimeout(() => callback(makeAuthCookies()), 5);
        },
      );

      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);
      const cookies = await svc.waitForLogin("default", 200);
      expect(cookies).toHaveLength(2);
    });
  });

  describe("extractCookies", () => {
    test("saves cookies via cookieStorage", async () => {
      const cookies = makeAuthCookies();
      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);

      await svc.extractCookies("default", cookies);

      expect(cookieStorage.save).toHaveBeenCalledTimes(1);
      expect(cookieStorage.save).toHaveBeenCalledWith("default", cookies);
    });
  });

  describe("confirmAuthSuccess", () => {
    test("prints success messages, expiry, and __Secure-1PSID check", () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});

      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);
      svc.confirmAuthSuccess(2, new Date("2026-12-31T00:00:00Z"), makeAuthCookies());

      const all = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(all).toContain("Login auto-detected");
      expect(all).toContain("Authentication successful");
      expect(all).toContain("2 cookies");
      expect(all).toContain("Session expires");
      expect(all).toContain("__Secure-1PSID");
      logSpy.mockRestore();
    });

    test("prints success without expiry when expiresAt is null", () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});

      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);
      svc.confirmAuthSuccess(1, null, []);

      const all = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(all).toContain("Authentication successful");
      expect(all).toContain("1 cookies");
      expect(all).not.toContain("Session expires");
      logSpy.mockRestore();
    });

    test("indicates missing __Secure-1PSID cookie when absent", () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});

      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);
      svc.confirmAuthSuccess(0, null, []);

      const all = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(all).toContain("__Secure-1PSID");
      expect(all).toContain("❌");
      logSpy.mockRestore();
    });
  });

  describe("closeBrowser", () => {
    test("calls closeSession on the driver with the profile name", async () => {
      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);

      await svc.closeBrowser("default");

      expect(driver.closeSession).toHaveBeenCalledTimes(1);
      expect(driver.closeSession).toHaveBeenCalledWith("default");
    });

    test("does not throw when closeSession fails", async () => {
      driver.closeSession.mockRejectedValueOnce(new Error("browser already closed"));

      const svc = buildService(driver, cookieMonitor, cookieStorage, logger);

      await expect(svc.closeBrowser("default")).resolves.toBeUndefined();
    });
  });
});
