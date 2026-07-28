import { describe, test, expect, beforeEach, spyOn } from "bun:test";
import { InstallBrowserService, InstallBrowserError } from "../../src/services/install-browser-service.ts";

describe("InstallBrowserService", () => {
  let service: InstallBrowserService;

  beforeEach(() => {
    service = new InstallBrowserService();
  });

  describe("install", () => {
    test("throws InstallBrowserError when install fails", async () => {
      const runInstallSpy = spyOn(service as any, "runInstall").mockImplementation(() => {
        throw new Error("spawn failed");
      });

      await expect(service.install()).rejects.toBeInstanceOf(InstallBrowserError);
      runInstallSpy.mockRestore();
    });

    test("resolves successfully when install succeeds", async () => {
      const runInstallSpy = spyOn(service as any, "runInstall").mockResolvedValue("Chromium downloaded");

      await expect(service.install()).resolves.toBeUndefined();
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
