import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { AuthCommand } from "../../src/cli/commands/auth-command.ts";
import type { CliCommandContext } from "../../src/cli/command-registry.ts";
import * as configModule from "../../src/infrastructure/config.ts";

describe("AuthCommand", () => {
  let command: AuthCommand;
  let context: CliCommandContext;
  let listSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    command = new AuthCommand();
    context = { verbose: false };
    listSpy = spyOn(configModule, "listProfiles").mockReturnValue([]);
  });

  afterEach(() => {
    mock.restore();
    listSpy.mockRestore();
  });

  test("has correct name and description", () => {
    expect(command.name).toBe("login");
    expect(command.description).toBe("Authenticate with Google Gemini");
  });

  describe("execute", () => {
    test("authenticates with default profile when no profiles exist", async () => {
      listSpy.mockReturnValue([]);

      const authSpy = spyOn(command as any, "authenticateWithProfile").mockResolvedValue(undefined);
      await command.execute([], context);

      expect(authSpy).toHaveBeenCalledWith(
        expect.anything(),
        "default",
        expect.anything(),
        true,
      );
    });

    test("authenticates directly when only one profile exists", async () => {
      listSpy.mockReturnValue(["my-profile"]);

      const authSpy = spyOn(command as any, "authenticateWithProfile").mockResolvedValue(undefined);
      await command.execute([], context);

      expect(authSpy).toHaveBeenCalledWith(
        expect.anything(),
        "my-profile",
        expect.anything(),
        false,
      );
    });

    test("shows profile menu when multiple profiles exist", async () => {
      listSpy.mockReturnValue(["p1", "p2"]);

      const menuSpy = spyOn(command as any, "showProfileMenu").mockResolvedValue(null);
      await command.execute([], context);

      expect(menuSpy).toHaveBeenCalled();
    });

    test("authenticates selected profile from menu", async () => {
      listSpy.mockReturnValue(["p1", "p2"]);

      const menuSpy = spyOn(command as any, "showProfileMenu").mockResolvedValue({
        type: "auth",
        profileName: "p2",
      });
      const authSpy = spyOn(command as any, "authenticateWithProfile").mockResolvedValue(undefined);

      await command.execute([], context);

      expect(authSpy).toHaveBeenCalledWith(
        expect.anything(),
        "p2",
        expect.anything(),
        false,
      );
    });

    test("exits when X is selected in profile menu", async () => {
      listSpy.mockReturnValue(["p1", "p2"]);

      const promptSpy = spyOn(command as any, "promptInput").mockResolvedValue("X");
      const logSpy = spyOn(console, "log").mockImplementation(() => {});

      await command.execute([], context);

      expect(promptSpy).toHaveBeenCalledWith("Select an option");
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Continuing with current default"));
      logSpy.mockRestore();
    });

    test("throws on invalid profile name when adding", async () => {
      listSpy.mockReturnValue(["p1", "p2"]);

      const promptSpy = spyOn(command as any, "promptInput").mockImplementation(
        (prompt: string) => {
          if (prompt.includes("Select")) return Promise.resolve("A");
          if (prompt.includes("Enter profile name")) return Promise.resolve("bad name!!");
          return Promise.resolve("");
        },
      );

      await expect(command.execute([], context)).rejects.toThrow("invalid characters");
    });

    test("throws when deleting nonexistent profile", async () => {
      listSpy.mockReturnValue(["p1", "p2"]);

      const promptSpy = spyOn(command as any, "promptInput").mockImplementation(
        (prompt: string) => {
          if (prompt.includes("Select")) return Promise.resolve("D");
          if (prompt.includes("Enter profile name to delete")) return Promise.resolve("ghost");
          return Promise.resolve("");
        },
      );

      await expect(command.execute([], context)).rejects.toThrow("does not exist");
    });

    test("cancels deletion when user answers no", async () => {
      listSpy.mockReturnValue(["p1", "p2"]);

      const promptSpy = spyOn(command as any, "promptInput").mockImplementation(
        (prompt: string) => {
          if (prompt.includes("Select")) return Promise.resolve("D");
          if (prompt.includes("Enter profile name to delete")) return Promise.resolve("p1");
          if (prompt.includes("Delete profile")) return Promise.resolve("n");
          return Promise.resolve("");
        },
      );

      await command.execute([], context);
    });

    test("renames profile and authenticates with new name", async () => {
      listSpy.mockReturnValue(["p1", "p2"]);

      const authSpy = spyOn(command as any, "authenticateWithProfile").mockResolvedValue(undefined);
      const mockRename = mock(() => {});

      const { ProfileManager } = await import("../../src/infrastructure/storage.ts");
      const origProto = ProfileManager.prototype.rename;
      ProfileManager.prototype.rename = mockRename;

      try {
        const promptSpy = spyOn(command as any, "promptInput").mockImplementation(
          (prompt: string) => {
            if (prompt.includes("Select")) return Promise.resolve("R");
            if (prompt.includes("current profile name")) return Promise.resolve("p1");
            if (prompt.includes("new profile name")) return Promise.resolve("p1-new");
            return Promise.resolve("");
          },
        );

        await command.execute([], context);

        expect(mockRename).toHaveBeenCalledWith("p1", "p1-new");
        expect(authSpy).toHaveBeenCalledWith(
          expect.anything(),
          "p1-new",
          expect.anything(),
          false,
        );
      } finally {
        ProfileManager.prototype.rename = origProto;
      }
    });

    test("set default for a profile", async () => {
      listSpy.mockReturnValue(["p1", "p2"]);

      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const setDefaultSpy = spyOn(configModule, "setDefaultProfileName").mockImplementation(() => {});
      const mockSetDefault = mock(() => {});

      const { ProfileManager } = await import("../../src/infrastructure/storage.ts");
      const origProto = ProfileManager.prototype.setDefault;
      ProfileManager.prototype.setDefault = mockSetDefault;

      try {
        const promptSpy = spyOn(command as any, "promptInput").mockImplementation(
          (prompt: string) => {
            if (prompt.includes("Select")) return Promise.resolve("S");
            if (prompt.includes("Enter profile name to set as default")) return Promise.resolve("p2");
            return Promise.resolve("");
          },
        );

        await command.execute([], context);

        expect(mockSetDefault).toHaveBeenCalledWith("p2");
        expect(setDefaultSpy).toHaveBeenCalledWith("p2");
      } finally {
        ProfileManager.prototype.setDefault = origProto;
        logSpy.mockRestore();
      }
    });
  });

  describe("showProfileMenu", () => {
    test("returns null for unknown option", async () => {
      const promptSpy = spyOn(command as any, "promptInput").mockResolvedValue("Z");

      const result = await (command as any).showProfileMenu(["p1"], {
        getStatus: () => ({ name: "p1", exists: true, isActive: true, expiresAt: null, isDefault: true }),
      } as any);

      expect(result).toBeNull();
    });
  });
});
