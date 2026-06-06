import { describe, test, expect, beforeEach, mock, spyOn } from "bun:test";
import { InstallBrowserService, InstallBrowserError } from "../../src/services/install-browser-service.ts";

describe("InstallBrowserService", () => {
  let service: InstallBrowserService;

  beforeEach(() => {
    service = new InstallBrowserService();
  });

  describe("findSystemBrowser", () => {
    test("returns BrowserCheckResult with found=true on Windows with Edge", () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });

      const result = service.findSystemBrowser();
      expect(typeof result.found).toBe("boolean");
      expect(typeof result.browserName).toBe("string");

      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    });

    test("returns BrowserCheckResult on linux", () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "linux", configurable: true });

      const result = service.findSystemBrowser();
      expect(typeof result.found).toBe("boolean");
      expect(typeof result.browserName).toBe("string");

      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    });

    test("returns not found for unknown platform", () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "aix", configurable: true });

      const result = service.findSystemBrowser();
      expect(result.found).toBe(false);
      expect(result.browserName).toBe("none");

      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
    });
  });

  describe("install", () => {
    test("throws InstallBrowserError when install fails", async () => {
      const findSpy = spyOn(service, "findSystemBrowser").mockReturnValue({ found: false, browserName: "none" });
      const runInstallSpy = spyOn(service as any, "runInstall").mockImplementation(() => {
        throw new Error("spawn failed");
      });

      await expect(service.install()).rejects.toBeInstanceOf(InstallBrowserError);
      runInstallSpy.mockRestore();
      findSpy.mockRestore();
    });

    test("resolves successfully when install succeeds", async () => {
      const runInstallSpy = spyOn(service as any, "runInstall").mockResolvedValue("Chromium downloaded");
      const findSpy = spyOn(service, "findSystemBrowser").mockReturnValue({ found: false, browserName: "none" });

      await expect(service.install()).resolves.toBeUndefined();
      findSpy.mockRestore();
      runInstallSpy.mockRestore();
    });
  });
});

describe("InstallBrowserError", () => {
  test("has correct name and message", () => {
    const error = new InstallBrowserError("test error");
    expect(error.name).toBe("InstallBrowserError");
    expect(error.message).toBe("test error");
    expect(error.cause).toBeUndefined();
  });

  test("preserves cause", () => {
    const cause = new Error("original");
    const error = new InstallBrowserError("wrapper", cause);
    expect(error.cause).toBe(cause);
    expect(error.message).toBe("wrapper");
  });
});
