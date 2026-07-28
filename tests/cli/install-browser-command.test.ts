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
    const spy = spyOn(InstallBrowserService.prototype, "install").mockResolvedValue(undefined);

    await expect(command.execute([], { verbose: false })).resolves.toBeUndefined();
    spy.mockRestore();
  });
});
