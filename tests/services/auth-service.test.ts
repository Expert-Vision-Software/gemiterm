import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from "bun:test";
import { AuthService, AuthServiceTimeoutError } from "../../src/services/auth-service.ts";
import { Logger } from "../../src/infrastructure/logger.ts";
import type { Cookie } from "../../src/core/types.ts";
import type { CookieStorage } from "../../src/infrastructure/storage.ts";

function createMockDriver() {
  return {
    openHeaded: mock(async (_url: string, _profile: string, _session?: string) => {}),
    closeAll: mock(async () => {}),
  };
}

function createMockCookieMonitor() {
  return {
    start: mock(async (_session: string, _callback: (cookies: Cookie[]) => void, _timeout?: number) => {}),
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

      cookieMonitor.start.mockImplementation(async (_session, callback) => {
        callback(authCookies);
      });

      const promptSpy = spyOn(console, "log").mockImplementation(() => {});

      process.env.GEMITERM_CONFIG_DIR = "";
      const svc = new AuthService({
        driver: driver as never,
        cookieMonitor: cookieMonitor as never,
        cookieStorage: cookieStorage as never,
        logger,
      });

      spyOn(svc, "waitForEnter").mockResolvedValue(undefined);

      const result = await svc.authenticate("test-profile");

      expect(result.cookies).toHaveLength(2);
      expect(result.cookies[0].name).toBe("__Secure-1PSID");
      expect(result.expiresAt).not.toBeNull();
      expect(driver.openHeaded).toHaveBeenCalledTimes(1);
      expect(cookieMonitor.start).toHaveBeenCalledTimes(1);
      expect(cookieStorage.save).toHaveBeenCalledTimes(1);
      expect(driver.closeAll).toHaveBeenCalledTimes(1);
      promptSpy.mockRestore();
      delete process.env.GEMITERM_CONFIG_DIR;
    });

    test("rejects on timeout", async () => {
      cookieMonitor.start.mockImplementation(async () => {
        // never calls callback -> timeout
      });

      const svc = new AuthService({
        driver: driver as never,
        cookieMonitor: cookieMonitor as never,
        cookieStorage: cookieStorage as never,
        logger,
      });

      await expect(svc.waitForCookies("default", 100)).rejects.toThrow(
        AuthServiceTimeoutError,
      );
    });

    test("throws on invalid profile name", async () => {
      const svc = new AuthService({
        driver: driver as never,
        cookieMonitor: cookieMonitor as never,
        cookieStorage: cookieStorage as never,
        logger,
      });

      await expect(svc.authenticate("bad name!")).rejects.toThrow("invalid characters");
    });
  });

  describe("promptUser", () => {
    test("prints the prompt message", () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});

      const svc = new AuthService({
        driver: driver as never,
        cookieMonitor: cookieMonitor as never,
        cookieStorage: cookieStorage as never,
        logger,
      });

      svc.promptUser();
      expect(logSpy).toHaveBeenCalledTimes(1);
      const msg = logSpy.mock.calls[0][0] as string;
      expect(msg).toContain("Press Enter to launch browser...");
      logSpy.mockRestore();
    });
  });

  describe("launchBrowser", () => {
    test("calls openHeaded with correct URL, profile and session", async () => {
      const svc = new AuthService({
        driver: driver as never,
        cookieMonitor: cookieMonitor as never,
        cookieStorage: cookieStorage as never,
        logger,
      });

      await svc.launchBrowser("my-profile");

      expect(driver.openHeaded).toHaveBeenCalledTimes(1);
      expect(driver.openHeaded).toHaveBeenCalledWith(
        "https://gemini.google.com",
        "my-profile",
        "auth-my-profile",
      );
    });
  });

  describe("startCookieMonitor", () => {
    test("logs the target session name", () => {
      const infoSpy = spyOn(logger, "info").mockImplementation(() => {});

      const svc = new AuthService({
        driver: driver as never,
        cookieMonitor: cookieMonitor as never,
        cookieStorage: cookieStorage as never,
        logger,
      });

      svc.startCookieMonitor("default");
      expect(infoSpy).toHaveBeenCalledWith(
        "Cookie monitor target session: auth-default",
      );
      infoSpy.mockRestore();
    });
  });

  describe("waitForCookies", () => {
    test("resolves with cookies when monitor callback fires", async () => {
      const authCookies = makeAuthCookies();

      cookieMonitor.start.mockImplementation(async (_session, callback) => {
        callback(authCookies);
      });

      const svc = new AuthService({
        driver: driver as never,
        cookieMonitor: cookieMonitor as never,
        cookieStorage: cookieStorage as never,
        logger,
      });

      const cookies = await svc.waitForCookies("default");
      expect(cookies).toHaveLength(2);
      expect(cookies[0].name).toBe("__Secure-1PSID");
    });

    test("rejects with AuthServiceTimeoutError on timeout", async () => {
      cookieMonitor.start.mockImplementation(async () => {});

      const svc = new AuthService({
        driver: driver as never,
        cookieMonitor: cookieMonitor as never,
        cookieStorage: cookieStorage as never,
        logger,
      });

      await expect(svc.waitForCookies("default", 50)).rejects.toBeInstanceOf(
        AuthServiceTimeoutError,
      );
    });

    test("stops cookie monitor on timeout", async () => {
      cookieMonitor.start.mockImplementation(async () => {});

      const svc = new AuthService({
        driver: driver as never,
        cookieMonitor: cookieMonitor as never,
        cookieStorage: cookieStorage as never,
        logger,
      });

      try {
        await svc.waitForCookies("default", 50);
      } catch {
        // expected
      }

      expect(cookieMonitor.stop).toHaveBeenCalled();
    });
  });

  describe("extractCookies", () => {
    test("saves cookies via cookieStorage", async () => {
      const cookies = makeAuthCookies();

      const svc = new AuthService({
        driver: driver as never,
        cookieMonitor: cookieMonitor as never,
        cookieStorage: cookieStorage as never,
        logger,
      });

      await svc.extractCookies("default", cookies);

      expect(cookieStorage.save).toHaveBeenCalledTimes(1);
      expect(cookieStorage.save).toHaveBeenCalledWith("default", cookies);
    });
  });

  describe("confirmAuthSuccess", () => {
    test("prints success message with cookie count", () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});

      const svc = new AuthService({
        driver: driver as never,
        cookieMonitor: cookieMonitor as never,
        cookieStorage: cookieStorage as never,
        logger,
      });

      svc.confirmAuthSuccess(2, new Date("2026-12-31T00:00:00Z"));

      expect(logSpy).toHaveBeenCalledTimes(2);
      expect(logSpy.mock.calls[0][0]).toContain("Authentication successful!");
      expect(logSpy.mock.calls[0][0]).toContain("2 cookies");
      expect(logSpy.mock.calls[1][0]).toContain("Session expires:");
      logSpy.mockRestore();
    });

    test("prints success without expiry when expiresAt is null", () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});

      const svc = new AuthService({
        driver: driver as never,
        cookieMonitor: cookieMonitor as never,
        cookieStorage: cookieStorage as never,
        logger,
      });

      svc.confirmAuthSuccess(1, null);

      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0][0]).toContain("Authentication successful!");
      expect(logSpy.mock.calls[0][0]).toContain("1 cookies");
      logSpy.mockRestore();
    });
  });

  describe("closeBrowser", () => {
    test("calls closeAll on the driver", async () => {
      const svc = new AuthService({
        driver: driver as never,
        cookieMonitor: cookieMonitor as never,
        cookieStorage: cookieStorage as never,
        logger,
      });

      await svc.closeBrowser("default");

      expect(driver.closeAll).toHaveBeenCalledTimes(1);
    });

    test("does not throw when closeAll fails", async () => {
      driver.closeAll.mockRejectedValue(new Error("browser already closed"));

      const svc = new AuthService({
        driver: driver as never,
        cookieMonitor: cookieMonitor as never,
        cookieStorage: cookieStorage as never,
        logger,
      });

      await expect(svc.closeBrowser("default")).resolves.toBeUndefined();
    });
  });
});
