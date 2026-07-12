import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { AuthCommand } from "../../src/cli/commands/auth-command.ts";
import { Mediator } from "../../src/core/mediator.ts";
import type { CliCommandContext } from "../../src/cli/command-registry.ts";
import * as configModule from "../../src/infrastructure/config.ts";

describe("AuthCommand", () => {
  let command: AuthCommand;
  let context: CliCommandContext;
  let listSpy: ReturnType<typeof spyOn>;
  let defaultProfileSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    command = new AuthCommand();
    context = { verbose: false, mediator: new Mediator() };
    listSpy = spyOn(configModule, "listProfiles").mockReturnValue([]);
    defaultProfileSpy = spyOn(configModule, "getDefaultProfileName").mockReturnValue("default");
  });

  afterEach(() => {
    mock.restore();
    listSpy.mockRestore();
    defaultProfileSpy.mockRestore();
  });

  test("has correct name and description", () => {
    expect(command.name).toBe("auth");
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

    test("authenticates directly to profile when profileName is provided", async () => {
      listSpy.mockReturnValue(["p1", "p2"]);

      const authSpy = spyOn(command as any, "authenticateWithProfile").mockResolvedValue(undefined);
      await command.execute(["p1"], context);

      expect(authSpy).toHaveBeenCalledWith(
        expect.anything(),
        "p1",
        expect.anything(),
        false,
      );
    });

    test("throws when profileName does not exist", async () => {
      listSpy.mockReturnValue(["p1", "p2"]);

      await expect(command.execute(["ghost"], context)).rejects.toThrow("does not exist");
    });
  });

  describe("--list flag", () => {
    test("lists profiles non-interactively", async () => {
      listSpy.mockReturnValue(["p1", "p2"]);

      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      const mockGetStatus = mock(() => ({
        name: "p1",
        exists: true,
        isActive: true,
        expiresAt: null,
        isDefault: true,
      }));

      const { ProfileManager } = await import("../../src/infrastructure/storage.ts");
      const origProto = ProfileManager.prototype.getStatus;
      ProfileManager.prototype.getStatus = mockGetStatus;

      try {
        await command.execute(["--list"], context);

        expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Profiles"));
      } finally {
        ProfileManager.prototype.getStatus = origProto;
        logSpy.mockRestore();
      }
    });

    test("shows message when no profiles exist with --list", async () => {
      listSpy.mockReturnValue([]);

      const logSpy = spyOn(console, "log").mockImplementation(() => {});
      await command.execute(["--list"], context);

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("No profiles found"));
      logSpy.mockRestore();
    });
  });

  describe("--add flag", () => {
    test("creates profile and authenticates with --add", async () => {
      listSpy.mockReturnValue(["existing"]);
      defaultProfileSpy.mockReturnValue("existing");

      const createSpy = mock(() => {});
      const { ProfileManager } = await import("../../src/infrastructure/storage.ts");
      const origCreate = ProfileManager.prototype.create;
      ProfileManager.prototype.create = createSpy;

      try {
        const authSpy = spyOn(command as any, "authenticateWithProfile").mockResolvedValue(undefined);
        await command.execute(["--add", "new-profile"], context);

        expect(createSpy).toHaveBeenCalledWith("new-profile");
        expect(authSpy).toHaveBeenCalledWith(
          expect.anything(),
          "new-profile",
          expect.anything(),
          false,
        );
      } finally {
        ProfileManager.prototype.create = origCreate;
      }
    });

    test("throws when adding profile that already exists", async () => {
      listSpy.mockReturnValue(["existing"]);

      await expect(command.execute(["--add", "existing"], context)).rejects.toThrow("already exists");
    });

    test("throws when adding profile with invalid name", async () => {
      listSpy.mockReturnValue(["existing"]);

      await expect(command.execute(["--add", "bad name!!"], context)).rejects.toThrow("invalid");
    });
  });

  describe("--delete flag", () => {
    test("prompts for confirmation when deleting without --yes", async () => {
      listSpy.mockReturnValue(["p1"]);

      const mockDelete = mock(() => {});
      const { ProfileManager } = await import("../../src/infrastructure/storage.ts");
      const origDelete = ProfileManager.prototype.delete;
      ProfileManager.prototype.delete = mockDelete;

      try {
        const confirmSpy = spyOn(command as any, "promptInput").mockResolvedValue("n");
        await command.execute(["--delete", "p1"], context);

        expect(mockDelete).not.toHaveBeenCalled();
        confirmSpy.mockRestore();
      } finally {
        ProfileManager.prototype.delete = origDelete;
      }
    });

    test("deletes profile when confirmed", async () => {
      listSpy.mockReturnValue(["p1"]);

      const mockDelete = mock(() => {});
      const { ProfileManager } = await import("../../src/infrastructure/storage.ts");
      const origDelete = ProfileManager.prototype.delete;
      ProfileManager.prototype.delete = mockDelete;

      try {
        const confirmSpy = spyOn(command as any, "promptInput").mockResolvedValue("y");
        await command.execute(["--delete", "p1"], context);

        expect(mockDelete).toHaveBeenCalledWith("p1");
        confirmSpy.mockRestore();
      } finally {
        ProfileManager.prototype.delete = origDelete;
      }
    });

    test("deletes without confirmation when --yes is passed", async () => {
      listSpy.mockReturnValue(["p1"]);

      const mockDelete = mock(() => {});
      const { ProfileManager } = await import("../../src/infrastructure/storage.ts");
      const origDelete = ProfileManager.prototype.delete;
      ProfileManager.prototype.delete = mockDelete;

      try {
        await command.execute(["--delete", "p1", "--yes"], context);

        expect(mockDelete).toHaveBeenCalledWith("p1");
      } finally {
        ProfileManager.prototype.delete = origDelete;
      }
    });

    test("throws when deleting nonexistent profile", async () => {
      listSpy.mockReturnValue(["p1"]);

      await expect(command.execute(["--delete", "ghost"], context)).rejects.toThrow("does not exist");
    });
  });

  describe("--rename flag", () => {
    test("renames profile with --rename", async () => {
      listSpy.mockReturnValue(["p1", "p2"]);

      const mockRename = mock(() => {});
      const { ProfileManager } = await import("../../src/infrastructure/storage.ts");
      const origRename = ProfileManager.prototype.rename;
      ProfileManager.prototype.rename = mockRename;

      try {
        await command.execute(["--rename", "p1", "p1-renamed"], context);

        expect(mockRename).toHaveBeenCalledWith("p1", "p1-renamed");
      } finally {
        ProfileManager.prototype.rename = origRename;
      }
    });

    test("throws when renaming nonexistent profile", async () => {
      listSpy.mockReturnValue(["p1"]);

      await expect(command.execute(["--rename", "ghost", "new-name"], context)).rejects.toThrow("does not exist");
    });

    test("throws when renaming to existing profile name", async () => {
      listSpy.mockReturnValue(["p1", "p2"]);

      await expect(command.execute(["--rename", "p1", "p2"], context)).rejects.toThrow("already exists");
    });

    test("throws when new name is invalid", async () => {
      listSpy.mockReturnValue(["p1"]);

      await expect(command.execute(["--rename", "p1", "bad name!!"], context)).rejects.toThrow("invalid");
    });
  });

  describe("--default flag", () => {
    test("sets default profile with --default", async () => {
      listSpy.mockReturnValue(["p1", "p2"]);

      const mockSetDefault = mock(() => {});
      const { ProfileManager } = await import("../../src/infrastructure/storage.ts");
      const origSetDefault = ProfileManager.prototype.setDefault;
      ProfileManager.prototype.setDefault = mockSetDefault;

      const setDefaultSpy = spyOn(configModule, "setDefaultProfileName").mockImplementation(() => {});

      try {
        await command.execute(["--default", "p2"], context);

        expect(mockSetDefault).toHaveBeenCalledWith("p2");
        expect(setDefaultSpy).toHaveBeenCalledWith("p2");
      } finally {
        ProfileManager.prototype.setDefault = origSetDefault;
        setDefaultSpy.mockRestore();
      }
    });

    test("throws when setting default for nonexistent profile", async () => {
      listSpy.mockReturnValue(["p1"]);

      await expect(command.execute(["--default", "ghost"], context)).rejects.toThrow("does not exist");
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
