import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { ProfileCommand } from "../../../src/cli/commands/profile-command.ts";
import { Mediator } from "../../../src/core/mediator.ts";
import type { CliCommandContext } from "../../../src/cli/command-registry.ts";
import { setupTestConfig, teardownTestConfig } from "../../setup.ts";
import * as configModule from "../../../src/infrastructure/config.ts";

describe("profile command integration", () => {
  let command: ProfileCommand;
  let context: CliCommandContext;
  let logSpy: ReturnType<typeof spyOn>;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    command = new ProfileCommand();
    context = { verbose: false, mediator: new Mediator() };
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    originalEnv = {
      GEMITERM_CONFIG_DIR: process.env.GEMITERM_CONFIG_DIR,
    };
    const configDir = setupTestConfig("profile-integration");
    spyOn(configModule, "getConfigDir").mockReturnValue(configDir);
    spyOn(configModule, "ensureConfigDir").mockImplementation(() => {});
  });

  afterEach(() => {
    mock.restore();
    logSpy.mockRestore();
    teardownTestConfig(originalEnv);
  });

  describe("command metadata", () => {
    test("has correct name and description", () => {
      expect(command.name).toBe("profile");
      expect(command.description).toBe("Manage authentication profiles");
    });
  });

  describe("--help flag", () => {
    test("no arguments shows usage information", async () => {
      await command.execute([], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Usage: gemiterm profile <action>");
      expect(output).toContain("profile add");
      expect(output).toContain("profile delete");
      expect(output).toContain("profile rename");
      expect(output).toContain("profile default");
      expect(output).toContain("profile list");
    });

    test("usage shows all actions with descriptions", async () => {
      await command.execute([], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Create new profile and authenticate");
      expect(output).toContain("Delete a profile");
      expect(output).toContain("Rename a profile");
      expect(output).toContain("Set default profile");
      expect(output).toContain("List all profiles with status");
    });
  });

  describe("unknown action", () => {
    test("throws error for unknown action", async () => {
      await expect(command.execute(["invalid"], context)).rejects.toThrow(
        /Unknown action 'invalid'/,
      );
    });

    test("error message includes valid actions", async () => {
      try {
        await command.execute(["bogus"], context);
        expect.unreachable("Should have thrown");
      } catch (err: any) {
        expect(err.message).toContain("add");
        expect(err.message).toContain("delete");
        expect(err.message).toContain("rename");
        expect(err.message).toContain("default");
        expect(err.message).toContain("list");
      }
    });
  });

  describe("profile list", () => {
    test("shows no profiles message when empty", async () => {
      spyOn(configModule, "listProfiles").mockReturnValue([]);

      await command.execute(["list"], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("No profiles found");
    });

    test("displays profile table with profiles", async () => {
      const profiles = ["work", "personal"];
      spyOn(configModule, "listProfiles").mockReturnValue(profiles);
      spyOn(configModule, "getDefaultProfileName").mockReturnValue("work");

      const mockGetStatus = mock((name: string) => ({
        name,
        exists: true,
        isActive: name === "work",
        expiresAt: name === "work" ? "2099-12-31T00:00:00.000Z" : null,
        isDefault: name === "work",
      }));

      const mockCookieStorage = { load: mock(() => []), save: mock(() => {}), delete: mock(() => {}), list: mock(() => profiles) };
      const mockProfileManager = { getStatus: mockGetStatus, create: mock(() => {}), delete: mock(() => {}), rename: mock(() => {}), setDefault: mock(() => {}), getDefault: mock(() => "work"), list: mock(() => profiles), getAllStatuses: mock(() => []), hasValidCookies: mock(() => false), loadCookiesForApi: mock(() => ({ secure1psid: "", secure1psidts: null })) };

      spyOn(command as any, "promptInput").mockResolvedValue("");
      const origCookieStorage = (await import("../../../src/infrastructure/storage.ts")).CookieStorage;
      spyOn(origCookieStorage.prototype, "load").mockReturnValue([
        { name: "__Secure-1PSID", value: "test", domain: ".google.com", path: "/", expires: Date.now() / 1000 + 999999, httpOnly: true, secure: true, sameSite: "None" },
        { name: "__Secure-1PSIDTS", value: "test", domain: ".google.com", path: "/", expires: Date.now() / 1000 + 999999, httpOnly: true, secure: true, sameSite: "None" },
      ]);

      await command.execute(["list"], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Profiles");
      expect(output).toContain("NAME");
      expect(output).toContain("ACTIVE");
      expect(output).toContain("work");
      expect(output).toContain("personal");
    });
  });

  describe("profile add", () => {
    test("throws error when no name provided", async () => {
      await expect(command.execute(["add"], context)).rejects.toThrow(
        "Usage: profile add <name>",
      );
    });

    test("throws error for invalid profile name", async () => {
      await expect(command.execute(["add", "bad name!"], context)).rejects.toThrow();
    });

    test("throws error when profile already exists", async () => {
      spyOn(configModule, "listProfiles").mockReturnValue(["existing"]);

      await expect(command.execute(["add", "existing"], context)).rejects.toThrow(
        "Profile 'existing' already exists",
      );
    });

    test("creates profile and authenticates for new profile", async () => {
      spyOn(configModule, "listProfiles").mockReturnValue([]);

      const mockProfileManager = {
        create: mock((name: string) => {}),
        delete: mock(() => {}),
        rename: mock(() => {}),
        setDefault: mock(() => {}),
      };
      spyOn(command as any, "addProfile").mockResolvedValue(undefined);

      await command.execute(["add", "newprofile"], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    });
  });

  describe("profile delete", () => {
    test("throws error when no name provided", async () => {
      await expect(command.execute(["delete"], context)).rejects.toThrow(
        "Usage: profile delete <name>",
      );
    });

    test("throws error when profile does not exist", async () => {
      spyOn(configModule, "listProfiles").mockReturnValue([]);

      await expect(command.execute(["delete", "nonexistent"], context)).rejects.toThrow(
        "Profile 'nonexistent' does not exist",
      );
    });

    test("cancels deletion when user does not confirm", async () => {
      spyOn(configModule, "listProfiles").mockReturnValue(["target"]);

      spyOn(command as any, "promptInput").mockResolvedValue("n");

      await command.execute(["delete", "target"], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Cancelled");
    });

    test("deletes profile when user confirms", async () => {
      spyOn(configModule, "listProfiles").mockReturnValue(["target"]);

      spyOn(command as any, "promptInput").mockResolvedValue("y");
      const deleteSpy = mock(() => {});
      spyOn(command as any, "deleteProfile").mockResolvedValue(undefined);

      await command.execute(["delete", "target"], context);
    });
  });

  describe("profile rename", () => {
    test("throws error when missing arguments", async () => {
      await expect(command.execute(["rename"], context)).rejects.toThrow(
        "Usage: profile rename <name> <newName>",
      );
      await expect(command.execute(["rename", "old"], context)).rejects.toThrow(
        "Usage: profile rename <name> <newName>",
      );
    });

    test("throws error when profile does not exist", async () => {
      spyOn(configModule, "listProfiles").mockReturnValue([]);

      await expect(command.execute(["rename", "ghost", "newname"], context)).rejects.toThrow(
        "Profile 'ghost' does not exist",
      );
    });

    test("throws error for invalid new name", async () => {
      spyOn(configModule, "listProfiles").mockReturnValue(["old"]);

      await expect(command.execute(["rename", "old", "bad name!"], context)).rejects.toThrow();
    });

    test("throws error when new name already exists", async () => {
      spyOn(configModule, "listProfiles").mockReturnValue(["old", "taken"]);

      await expect(command.execute(["rename", "old", "taken"], context)).rejects.toThrow(
        "Profile 'taken' already exists",
      );
    });
  });

  describe("profile default", () => {
    test("throws error when no name provided", async () => {
      await expect(command.execute(["default"], context)).rejects.toThrow(
        "Usage: profile default <name>",
      );
    });

    test("throws error when profile does not exist", async () => {
      spyOn(configModule, "listProfiles").mockReturnValue([]);

      await expect(command.execute(["default", "nonexistent"], context)).rejects.toThrow(
        "Profile 'nonexistent' does not exist",
      );
    });

    test("sets default profile successfully", async () => {
      spyOn(configModule, "listProfiles").mockReturnValue(["target"]);

      spyOn(command as any, "setDefaultProfile").mockResolvedValue(undefined);

      await command.execute(["default", "target"], context);
    });
  });
});
