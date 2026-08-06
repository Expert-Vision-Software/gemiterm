import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { StatusCommand } from "../../src/cli/commands/status-command.ts";
import { Mediator } from "../../src/core/mediator.ts";
import type { CliCommandContext } from "../../src/cli/command-registry.ts";
import * as configModule from "../../src/infrastructure/config.ts";
import * as pathUtilsModule from "../../src/infrastructure/path-utils.ts";

describe("StatusCommand", () => {
  let command: StatusCommand;
  let context: CliCommandContext;
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    command = new StatusCommand();
    context = { verbose: false, mediator: new Mediator() };
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

    test("--verbose displays cookie details and storage paths", async () => {
      spyOn(configModule, "listProfiles").mockReturnValue(["work"]);
      spyOn(configModule, "getConfigDir").mockReturnValue("/home/user/.config/gemiterm");
      spyOn(configModule, "ensureConfigDir").mockImplementation(() => {});
      spyOn(configModule, "getDefaultProfileName").mockReturnValue("work");
      spyOn(pathUtilsModule, "getProfileDir").mockImplementation(
        (name: string) => `/home/user/.config/gemiterm/profiles/${name}`,
      );

      const logOutput: string[] = [];
      spyOn(console, "log").mockImplementation((...args) => {
        logOutput.push(args.join(" "));
      });

      const { ProfileManager, CookieStorage } = await import("../../src/infrastructure/storage.ts");
      const origGetStatus = ProfileManager.prototype.getStatus;
      const origLoad = CookieStorage.prototype.load;
      ProfileManager.prototype.getStatus = mock(() => ({
        name: "work",
        exists: true,
        isActive: true,
        expiresAt: "2026-08-12T00:00:00.000Z",
        isDefault: true,
      }));
      CookieStorage.prototype.load = mock(() => [
        {
          name: "__Secure-1PSID",
          value: "v1",
          domain: ".google.com",
          path: "/",
          expires: 0,
          httpOnly: true,
          secure: true,
          sameSite: "None",
        },
        {
          name: "__Secure-1PSIDTS",
          value: "v2",
          domain: ".google.com",
          path: "/",
          expires: Math.floor(Date.now() / 1000) + 5 * 24 * 3600,
          httpOnly: false,
          secure: true,
          sameSite: "None",
        },
      ]);

      try {
        await command.execute(["--verbose"], context);

        const combined = logOutput.join("\n");
        expect(combined).toContain("Cookies");
        expect(combined).toContain("Storage");
        expect(combined).toContain("/home/user/.config/gemiterm/profiles/work");
        expect(combined).toMatch(/\d+ cookies/);
        expect(combined).not.toContain("no storage state");
      } finally {
        ProfileManager.prototype.getStatus = origGetStatus;
        CookieStorage.prototype.load = origLoad;
      }
    });

    test("--verbose reports session-only cookies when PSIDTS has no expiry", async () => {
      spyOn(configModule, "listProfiles").mockReturnValue(["work"]);
      spyOn(configModule, "getConfigDir").mockReturnValue("/home/user/.config/gemiterm");
      spyOn(configModule, "ensureConfigDir").mockImplementation(() => {});
      spyOn(configModule, "getDefaultProfileName").mockReturnValue("work");
      spyOn(pathUtilsModule, "getProfileDir").mockImplementation(
        (name: string) => `/home/user/.config/gemiterm/profiles/${name}`,
      );

      const logOutput: string[] = [];
      spyOn(console, "log").mockImplementation((...args) => {
        logOutput.push(args.join(" "));
      });

      const { ProfileManager, CookieStorage } = await import("../../src/infrastructure/storage.ts");
      const origGetStatus = ProfileManager.prototype.getStatus;
      const origLoad = CookieStorage.prototype.load;
      ProfileManager.prototype.getStatus = mock(() => ({
        name: "work",
        exists: true,
        isActive: true,
        expiresAt: null,
        isDefault: true,
      }));
      CookieStorage.prototype.load = mock(() => [
        {
          name: "__Secure-1PSID",
          value: "v1",
          domain: ".google.com",
          path: "/",
          expires: 0,
          httpOnly: true,
          secure: true,
          sameSite: "None",
        },
        {
          name: "__Secure-1PSIDTS",
          value: "v2",
          domain: ".google.com",
          path: "/",
          expires: 0,
          httpOnly: false,
          secure: true,
          sameSite: "None",
        },
      ]);

      try {
        await command.execute(["-v"], context);

        const combined = logOutput.join("\n");
        expect(combined).toContain("session-only");
      } finally {
        ProfileManager.prototype.getStatus = origGetStatus;
        CookieStorage.prototype.load = origLoad;
      }
    });
  });
});
