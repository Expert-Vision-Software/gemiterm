import { describe, test, expect, beforeEach, mock, spyOn } from "bun:test";
import { InstallBrowserCommand } from "../../src/cli/commands/install-browser-command.ts";
import { InstallBrowserService, InstallBrowserError } from "../../src/services/install-browser-service.ts";

describe("InstallBrowserCommand", () => {
  let command: InstallBrowserCommand;

  beforeEach(() => {
    command = new InstallBrowserCommand();
  });

  test("has correct name and description", () => {
    expect(command.name).toBe("install-browser");
    expect(command.description).toContain("Chrome for Testing");
  });

  test("implements CliCommand interface", () => {
    expect(typeof command.execute).toBe("function");
  });

  test("exits with code 1 on InstallBrowserError", async () => {
    const exitSpy = spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit");
    });

    const service = new InstallBrowserService();
    spyOn(service, "install").mockImplementation(async () => {
      throw new InstallBrowserError("install failed");
    });

    const spy = spyOn(InstallBrowserService.prototype, "install").mockImplementation(async () => {
      throw new InstallBrowserError("install failed");
    });

    await expect(command.execute([], { verbose: false })).rejects.toThrow("process.exit");

    expect(exitSpy).toHaveBeenCalledWith(1);
    spy.mockRestore();
    exitSpy.mockRestore();
  });

  test("succeeds when install completes", async () => {
    const spy = spyOn(InstallBrowserService.prototype, "install").mockResolvedValue({});

    await expect(command.execute([], { verbose: false })).resolves.toBeUndefined();
    spy.mockRestore();
  });

  test("warns with the deps remediation instead of an unqualified success (issue #31)", async () => {
    const spy = spyOn(InstallBrowserService.prototype, "install").mockResolvedValue({
      depsWarning: "sudo npx playwright install-deps chrome-for-testing",
    });
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    await expect(command.execute([], { verbose: false })).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("sudo npx playwright install-deps chrome-for-testing"));
    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining("Browser ready."));
    spy.mockRestore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
