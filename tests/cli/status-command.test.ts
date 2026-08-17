import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { StatusCommand } from "../../src/cli/commands/status-command.ts";
import type { CliCommandContext } from "../../src/cli/command-registry.ts";
import type { ProfileLifecycle } from "../../src/services/profile-lifecycle.ts";

describe("StatusCommand", () => {
  let command: StatusCommand;
  let context: CliCommandContext;
  let manageProfiles: ReturnType<typeof mock>;
  let lifecycle: ProfileLifecycle;

  beforeEach(() => {
    command = new StatusCommand();
    manageProfiles = mock(async () => undefined);
    lifecycle = { manageProfiles } as unknown as ProfileLifecycle;
    context = {
      verbose: false,
      profileLifecycle: lifecycle,
    } as unknown as CliCommandContext;
  });

  afterEach(() => {
    mock.restore();
  });

  test("has correct name and description", () => {
    expect(command.name).toBe("status");
    expect(command.description).toBe("Show configuration and profile status");
  });

  describe("execute", () => {
    test("delegates to the status action", async () => {
      await command.execute([], context);
      expect(manageProfiles).toHaveBeenCalledWith("status", { verbose: false });
    });

    test("exits with code 2 when the module signals no profiles", async () => {
      manageProfiles.mockResolvedValueOnce({ exitCode: 2 });
      const exitSpy = spyOn(process, "exit").mockImplementation((code?: number) => {
        throw new Error(`process.exit(${code})`);
      });

      await expect(command.execute([], context)).rejects.toThrow("process.exit(2)");
      expect(exitSpy).toHaveBeenCalledWith(2);

      exitSpy.mockRestore();
    });

    test("does not exit when profiles exist", async () => {
      manageProfiles.mockResolvedValueOnce(undefined);
      const exitSpy = spyOn(process, "exit").mockImplementation(() => {});

      await command.execute([], context);

      expect(exitSpy).not.toHaveBeenCalled();
      exitSpy.mockRestore();
    });
  });

  describe("--verbose", () => {
    test("delegates verbose flag to the status action", async () => {
      await command.execute(["--verbose"], context);
      expect(manageProfiles).toHaveBeenCalledWith("status", { verbose: true });
    });

    test("omits verbose by default", async () => {
      await command.execute([], context);
      expect(manageProfiles).toHaveBeenCalledWith("status", { verbose: false });
    });

    test("--help documents --verbose", async () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});

      await command.execute(["--help"], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("--verbose");
      expect(manageProfiles).not.toHaveBeenCalled();

      logSpy.mockRestore();
    });
  });

  describe("--help", () => {
    test("shows usage and does not dispatch", async () => {
      const logSpy = spyOn(console, "log").mockImplementation(() => {});

      await command.execute(["--help"], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Usage: gemiterm status");
      expect(manageProfiles).not.toHaveBeenCalled();

      logSpy.mockRestore();
    });
  });
});
