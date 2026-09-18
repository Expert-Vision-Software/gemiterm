import { describe, test, expect, beforeEach, spyOn } from "bun:test";
import { InstallBrowserService, InstallBrowserError } from "../../src/services/install-browser-service.ts";
import { MissingBrowserDependenciesError, MISSING_DEPS_REMEDIATION } from "../../src/services/playwright-cli-driver.ts";

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
      const runInstallSpy = spyOn(service as any, "runInstall").mockResolvedValue("Chrome for Testing downloaded");

      await expect(service.install()).resolves.toEqual({});
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

// Issue #31: on Linux, a downloaded Chrome-for-Testing binary may still be
// unlaunchable because shared system libraries are missing. install-browser
// must verify the browser can launch before declaring success.
describe("InstallBrowserService linux launch verification (issue #31)", () => {
  function makeService(overrides: Record<string, unknown> = {}) {
    return new InstallBrowserService({
      platformDetector: () => "linux",
      launchProbe: async () => {},
      depsInstaller: async () => {},
      rootDetector: () => false,
      ...overrides,
    });
  }

  function silenceConsole() {
    const log = spyOn(console, "log").mockImplementation(() => {});
    const error = spyOn(console, "error").mockImplementation(() => {});
    return { log, error };
  }

  test("non-Linux behaviour unchanged: no launch probe, no warning", async () => {
    let probeCalls = 0;
    const service = makeService({
      platformDetector: () => "win32",
      launchProbe: async () => {
        probeCalls++;
      },
    });
    const runInstallSpy = spyOn(service as any, "runInstall").mockResolvedValue("ok");
    const consoleSpies = silenceConsole();

    const result = await service.install();

    expect(result).toEqual({});
    expect(probeCalls).toBe(0);
    runInstallSpy.mockRestore();
    consoleSpies.log.mockRestore();
    consoleSpies.error.mockRestore();
  });

  test("Linux with launchable browser: no warning", async () => {
    let probeCalls = 0;
    const service = makeService({
      launchProbe: async () => {
        probeCalls++;
      },
    });
    const runInstallSpy = spyOn(service as any, "runInstall").mockResolvedValue("ok");
    const consoleSpies = silenceConsole();

    const result = await service.install();

    expect(result).toEqual({});
    expect(probeCalls).toBe(1);
    runInstallSpy.mockRestore();
    consoleSpies.log.mockRestore();
    consoleSpies.error.mockRestore();
  });

  test("Linux with missing deps as root: warns with exact remediation, never auto-installs", async () => {
    let installerCalls = 0;
    const service = makeService({
      launchProbe: async () => {
        throw new MissingBrowserDependenciesError();
      },
      depsInstaller: async () => {
        installerCalls++;
      },
      rootDetector: () => true,
    });
    const runInstallSpy = spyOn(service as any, "runInstall").mockResolvedValue("ok");
    const consoleSpies = silenceConsole();

    const result = await service.install();

    expect(result.depsWarning).toContain("sudo npx playwright install-deps chrome-for-testing");
    expect(result.depsWarning).toContain("npx @playwright/cli install-browser --with-deps");
    expect(installerCalls).toBe(0);
    runInstallSpy.mockRestore();
    consoleSpies.log.mockRestore();
    consoleSpies.error.mockRestore();
  });

  test("Linux with missing deps non-root: attempts automatic deps installation and succeeds", async () => {
    let probeCalls = 0;
    let installerCalls = 0;
    const service = makeService({
      launchProbe: async () => {
        probeCalls++;
        if (probeCalls === 1) throw new MissingBrowserDependenciesError();
      },
      depsInstaller: async () => {
        installerCalls++;
      },
    });
    const runInstallSpy = spyOn(service as any, "runInstall").mockResolvedValue("ok");
    const consoleSpies = silenceConsole();

    const result = await service.install();

    expect(result).toEqual({});
    expect(installerCalls).toBe(1);
    expect(probeCalls).toBe(2);
    runInstallSpy.mockRestore();
    consoleSpies.log.mockRestore();
    consoleSpies.error.mockRestore();
  });

  test("Linux where automatic deps installation fails: warns with exact remediation", async () => {
    const service = makeService({
      launchProbe: async () => {
        throw new MissingBrowserDependenciesError();
      },
      depsInstaller: async () => {
        throw new Error("sudo: no tty");
      },
    });
    const runInstallSpy = spyOn(service as any, "runInstall").mockResolvedValue("ok");
    const consoleSpies = silenceConsole();

    const result = await service.install();

    expect(result.depsWarning).toBe(MISSING_DEPS_REMEDIATION);
    runInstallSpy.mockRestore();
    consoleSpies.log.mockRestore();
    consoleSpies.error.mockRestore();
  });

  test("Linux where deps install succeeds but browser still will not launch: warns", async () => {
    const service = makeService({
      launchProbe: async () => {
        throw new MissingBrowserDependenciesError();
      },
    });
    const runInstallSpy = spyOn(service as any, "runInstall").mockResolvedValue("ok");
    const consoleSpies = silenceConsole();

    const result = await service.install();

    expect(result.depsWarning).toBe(MISSING_DEPS_REMEDIATION);
    runInstallSpy.mockRestore();
    consoleSpies.log.mockRestore();
    consoleSpies.error.mockRestore();
  });

  test("Linux with unrelated launch-probe failure: throws InstallBrowserError", async () => {
    const service = makeService({
      launchProbe: async () => {
        throw new Error("daemon exploded");
      },
    });
    const runInstallSpy = spyOn(service as any, "runInstall").mockResolvedValue("ok");

    await expect(service.install()).rejects.toBeInstanceOf(InstallBrowserError);
    runInstallSpy.mockRestore();
  });
});
