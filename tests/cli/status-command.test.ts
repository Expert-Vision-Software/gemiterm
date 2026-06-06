import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { StatusCommand } from "../../src/cli/commands/status-command.ts";
import type { CliCommandContext } from "../../src/cli/command-registry.ts";
import * as configModule from "../../src/infrastructure/config.ts";

describe("StatusCommand", () => {
  let command: StatusCommand;
  let context: CliCommandContext;
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    command = new StatusCommand();
    context = { verbose: false };
    exitSpy = spyOn(process, "exit").mockImplementation((code?: number) => {
      throw new Error(`process.exit(${code})`);
    });
  });

  afterEach(() => {
    mock.restore();
    exitSpy.mockRestore();
  });

  test("has correct name and description", () => {
    expect(command.name).toBe("status");
    expect(command.description).toBe("Show configuration and profile status");
  });

  describe("execute", () => {
    test("exits with code 2 when no profiles exist", async () => {
      spyOn(configModule, "listProfiles").mockReturnValue([]);
      spyOn(configModule, "getConfigDir").mockReturnValue("/tmp/gemiterm");
      spyOn(configModule, "ensureConfigDir").mockImplementation(() => {});
      spyOn(configModule, "getDefaultProfileName").mockReturnValue("default");
      spyOn(console, "log").mockImplementation(() => {});

      await expect(command.execute([], context)).rejects.toThrow("process.exit(2)");
    });

    test("displays config directory and profile table", async () => {
      spyOn(configModule, "listProfiles").mockReturnValue(["default"]);
      spyOn(configModule, "getConfigDir").mockReturnValue("/home/user/.config/gemiterm");
      spyOn(configModule, "ensureConfigDir").mockImplementation(() => {});
      spyOn(configModule, "getDefaultProfileName").mockReturnValue("default");

      const logOutput: string[] = [];
      spyOn(console, "log").mockImplementation((...args) => {
        logOutput.push(args.join(" "));
      });

      const { ProfileManager } = await import("../../src/infrastructure/storage.ts");
      const mockGetStatus = mock(() => ({
        name: "default",
        exists: true,
        isActive: true,
        expiresAt: "2026-07-01T00:00:00.000Z",
        isDefault: true,
      }));
      const origProto = ProfileManager.prototype.getStatus;
      ProfileManager.prototype.getStatus = mockGetStatus;

      try {
        await command.execute([], context);

        const combined = logOutput.join("\n");
        expect(combined).toContain("Configuration");
        expect(combined).toContain("/home/user/.config/gemiterm");
        expect(combined).toContain("Profiles");
        expect(combined).toContain("default");
      } finally {
        ProfileManager.prototype.getStatus = origProto;
      }
    });

    test("displays multiple profiles with correct default marker", async () => {
      spyOn(configModule, "listProfiles").mockReturnValue(["work", "personal"]);
      spyOn(configModule, "getConfigDir").mockReturnValue("/home/user/.config/gemiterm");
      spyOn(configModule, "ensureConfigDir").mockImplementation(() => {});
      spyOn(configModule, "getDefaultProfileName").mockReturnValue("work");

      const logOutput: string[] = [];
      spyOn(console, "log").mockImplementation((...args) => {
        logOutput.push(args.join(" "));
      });

      const { ProfileManager } = await import("../../src/infrastructure/storage.ts");
      const statuses = {
        work: { name: "work", exists: true, isActive: true, expiresAt: "2026-08-01T00:00:00.000Z", isDefault: true },
        personal: { name: "personal", exists: true, isActive: false, expiresAt: null, isDefault: false },
      };
      const origProto = ProfileManager.prototype.getStatus;
      ProfileManager.prototype.getStatus = mock((name: string) => statuses[name as keyof typeof statuses]);

      try {
        await command.execute([], context);

        const combined = logOutput.join("\n");
        expect(combined).toContain("work");
        expect(combined).toContain("personal");
      } finally {
        ProfileManager.prototype.getStatus = origProto;
      }
    });
  });
});
