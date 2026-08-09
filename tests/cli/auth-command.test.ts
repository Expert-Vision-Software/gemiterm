import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { AuthCommand } from "../../src/cli/commands/auth-command.ts";
import { Mediator } from "../../src/core/mediator.ts";
import type { CliCommandContext } from "../../src/cli/command-registry.ts";
import { COMMAND_TYPES } from "../../src/core/command-handlers.ts";
import * as configModule from "../../src/infrastructure/config.ts";

describe("AuthCommand", () => {
  let command: AuthCommand;
  let context: CliCommandContext;
  let mediator: Mediator;
  let listSpy: ReturnType<typeof spyOn>;
  let defaultProfileSpy: ReturnType<typeof spyOn>;

  function registerMockHandlers() {
    const authHandler = {
      commandType: COMMAND_TYPES.AUTHENTICATE,
      handle: mock(async () => ({ success: true, cookieCount: 0, expiresAt: null })),
    };
    const deleteHandler = {
      commandType: COMMAND_TYPES.DELETE_PROFILE,
      handle: mock(async () => ({ success: true })),
    };
    const renameHandler = {
      commandType: COMMAND_TYPES.RENAME_PROFILE,
      handle: mock(async () => ({ success: true })),
    };
    const defaultHandler = {
      commandType: COMMAND_TYPES.SET_DEFAULT_PROFILE,
      handle: mock(async () => ({ success: true })),
    };
    mediator.registerCommandHandler(authHandler as any);
    mediator.registerCommandHandler(deleteHandler as any);
    mediator.registerCommandHandler(renameHandler as any);
    mediator.registerCommandHandler(defaultHandler as any);
  }

  beforeEach(() => {
    command = new AuthCommand();
    mediator = new Mediator();
    registerMockHandlers();
    context = { verbose: false, mediator } as CliCommandContext;
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

      const sendSpy = spyOn(context.mediator, "send");
      await command.execute([], context);

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: COMMAND_TYPES.AUTHENTICATE,
          payload: expect.objectContaining({
            profileName: "default",
            create: true,
          }),
        }),
      );
    });

    test("authenticates directly when only one profile exists", async () => {
      listSpy.mockReturnValue(["my-profile"]);

      const sendSpy = spyOn(context.mediator, "send");
      await command.execute([], context);

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: COMMAND_TYPES.AUTHENTICATE,
          payload: expect.objectContaining({
            profileName: "my-profile",
          }),
        }),
      );
    });

    test("shows profile menu when multiple profiles exist", async () => {
      listSpy.mockReturnValue(["p1", "p2"]);

      const menuSpy = spyOn(command as any, "showProfileMenu").mockResolvedValue(null);
      await command.execute([], context);

      expect(menuSpy).toHaveBeenCalled();
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

    test("renames profile via mediator", async () => {
      listSpy.mockReturnValue(["p1", "p2"]);

      const promptSpy = spyOn(command as any, "promptInput").mockImplementation(
        (prompt: string) => {
          if (prompt.includes("Select")) return Promise.resolve("R");
          if (prompt.includes("current profile name")) return Promise.resolve("p1");
          if (prompt.includes("new profile name")) return Promise.resolve("p1-new");
          return Promise.resolve("");
        },
      );

      const sendSpy = spyOn(context.mediator, "send");
      await command.execute([], context);

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: COMMAND_TYPES.RENAME_PROFILE,
          payload: expect.objectContaining({
            oldName: "p1",
            newName: "p1-new",
          }),
        }),
      );
    });

    test("set default via mediator", async () => {
      listSpy.mockReturnValue(["p1", "p2"]);

      const promptSpy = spyOn(command as any, "promptInput").mockImplementation(
        (prompt: string) => {
          if (prompt.includes("Select")) return Promise.resolve("S");
          if (prompt.includes("Enter profile name to set as default")) return Promise.resolve("p2");
          return Promise.resolve("");
        },
      );

      const sendSpy = spyOn(context.mediator, "send");
      await command.execute([], context);

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: COMMAND_TYPES.SET_DEFAULT_PROFILE,
          payload: expect.objectContaining({
            profileName: "p2",
          }),
        }),
      );
    });

    test("authenticates directly to profile when profileName is provided", async () => {
      listSpy.mockReturnValue(["p1", "p2"]);

      const sendSpy = spyOn(context.mediator, "send");
      await command.execute(["p1"], context);

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: COMMAND_TYPES.AUTHENTICATE,
          payload: expect.objectContaining({
            profileName: "p1",
          }),
        }),
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
    test("dispatches AUTHENTICATE with create via mediator", async () => {
      listSpy.mockReturnValue(["existing"]);
      defaultProfileSpy.mockReturnValue("existing");

      const sendSpy = spyOn(context.mediator, "send");
      await command.execute(["--add", "new-profile"], context);

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: COMMAND_TYPES.AUTHENTICATE,
          payload: expect.objectContaining({
            profileName: "new-profile",
            create: true,
          }),
        }),
      );
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

      const promptSpy = spyOn(command as any, "promptInput").mockResolvedValue("n");
      const sendSpy = spyOn(context.mediator, "send");
      await command.execute(["--delete", "p1"], context);

      expect(sendSpy).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: COMMAND_TYPES.DELETE_PROFILE }),
      );
    });

    test("deletes profile when confirmed via mediator", async () => {
      listSpy.mockReturnValue(["p1"]);

      const promptSpy = spyOn(command as any, "promptInput").mockResolvedValue("y");
      const sendSpy = spyOn(context.mediator, "send");
      await command.execute(["--delete", "p1"], context);

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: COMMAND_TYPES.DELETE_PROFILE,
          payload: expect.objectContaining({
            profileName: "p1",
          }),
        }),
      );
    });

    test("deletes without confirmation when --yes is passed via mediator", async () => {
      listSpy.mockReturnValue(["p1"]);

      const sendSpy = spyOn(context.mediator, "send");
      await command.execute(["--delete", "p1", "--yes"], context);

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: COMMAND_TYPES.DELETE_PROFILE,
          payload: expect.objectContaining({
            profileName: "p1",
          }),
        }),
      );
    });

    test("throws when deleting nonexistent profile", async () => {
      listSpy.mockReturnValue(["p1"]);

      await expect(command.execute(["--delete", "ghost"], context)).rejects.toThrow("does not exist");
    });
  });

  describe("--rename flag", () => {
    test("dispatches RENAME_PROFILE via mediator", async () => {
      listSpy.mockReturnValue(["p1", "p2"]);

      const sendSpy = spyOn(context.mediator, "send");
      await command.execute(["--rename", "p1", "p1-renamed"], context);

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: COMMAND_TYPES.RENAME_PROFILE,
          payload: expect.objectContaining({
            oldName: "p1",
            newName: "p1-renamed",
          }),
        }),
      );
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
    test("dispatches SET_DEFAULT_PROFILE via mediator", async () => {
      listSpy.mockReturnValue(["p1", "p2"]);

      const sendSpy = spyOn(context.mediator, "send");
      await command.execute(["--default", "p2"], context);

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: COMMAND_TYPES.SET_DEFAULT_PROFILE,
          payload: expect.objectContaining({
            profileName: "p2",
          }),
        }),
      );
    });

    test("throws when setting default for nonexistent profile", async () => {
      listSpy.mockReturnValue(["p1"]);

      await expect(command.execute(["--default", "ghost"], context)).rejects.toThrow("does not exist");
    });
  });

  describe("--renew flag", () => {
    test("dispatches AUTHENTICATE with renew via mediator", async () => {
      listSpy.mockReturnValue(["p1", "p2"]);

      const sendSpy = spyOn(context.mediator, "send");
      await command.execute(["--renew", "p1"], context);

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: COMMAND_TYPES.AUTHENTICATE,
          payload: expect.objectContaining({
            profileName: "p1",
            renew: true,
          }),
        }),
      );
    });

    test("throws when renewing nonexistent profile", async () => {
      listSpy.mockReturnValue(["p1"]);

      await expect(command.execute(["--renew", "ghost"], context)).rejects.toThrow("does not exist");
    });

    test("works with -e short flag", async () => {
      listSpy.mockReturnValue(["p1"]);

      const sendSpy = spyOn(context.mediator, "send");
      await command.execute(["-e", "p1"], context);

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: COMMAND_TYPES.AUTHENTICATE,
          payload: expect.objectContaining({
            profileName: "p1",
            renew: true,
          }),
        }),
      );
    });
  });

  describe("showProfileMenu", () => {
    test("returns null for unknown option", async () => {
      spyOn(command as any, "promptInput").mockResolvedValue("Z");

      const result = await (command as any).showProfileMenu(["p1"], {
        getStatus: () => ({ name: "p1", exists: true, isActive: true, expiresAt: null, isDefault: true }),
      } as any, mediator);

      expect(result).toBeNull();
    });

    test("renew option [E] dispatches AUTHENTICATE with renew and returns renew type", async () => {
      let call = 0;
      spyOn(command as any, "promptInput").mockImplementation((prompt: string) => {
        call++;
        if (call === 1) return Promise.resolve("E");
        if (call === 2 && prompt.includes("renew")) return Promise.resolve("p1");
        return Promise.resolve("");
      });

      const sendSpy = spyOn(mediator, "send");

      const result = await (command as any).showProfileMenu(["p1", "p2"], {
        getStatus: () => ({ name: "p1", exists: true, isActive: true, expiresAt: null, isDefault: true }),
      } as any, mediator);

      expect(result).toEqual({ type: "renew", profileName: "p1" });
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: COMMAND_TYPES.AUTHENTICATE,
          payload: expect.objectContaining({
            profileName: "p1",
            renew: true,
          }),
        }),
      );
    });

    test("renew option [E] rejects nonexistent profile name", async () => {
      let call = 0;
      spyOn(command as any, "promptInput").mockImplementation((prompt: string) => {
        call++;
        if (call === 1) return Promise.resolve("E");
        if (call === 2 && prompt.includes("renew")) return Promise.resolve("ghost");
        return Promise.resolve("");
      });

      await expect(
        (command as any).showProfileMenu(["p1"], {
          getStatus: () => ({ name: "p1", exists: true, isActive: true, expiresAt: null, isDefault: true }),
        } as any, mediator),
      ).rejects.toThrow("does not exist");
    });

    test("add option [A] dispatches AUTHENTICATE with create", async () => {
      let call = 0;
      spyOn(command as any, "promptInput").mockImplementation((prompt: string) => {
        call++;
        if (call === 1) return Promise.resolve("A");
        if (call === 2 && prompt.includes("Enter profile name")) return Promise.resolve("new-pro");
        return Promise.resolve("");
      });

      const sendSpy = spyOn(mediator, "send");

      await (command as any).showProfileMenu(["p1"], {
        getStatus: () => ({ name: "p1", exists: true, isActive: true, expiresAt: null, isDefault: true }),
      } as any, mediator);

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: COMMAND_TYPES.AUTHENTICATE,
          payload: expect.objectContaining({
            profileName: "new-pro",
            create: true,
          }),
        }),
      );
    });
  });

  describe("interactive renew from menu", () => {
    test("renew dispatches AUTHENTICATE with renew through mediator", async () => {
      listSpy.mockReturnValue(["p1", "p2"]);

      let call = 0;
      spyOn(command as any, "promptInput").mockImplementation((prompt: string) => {
        call++;
        if (call === 1 && prompt.includes("Select")) return Promise.resolve("E");
        if (call === 2 && prompt.includes("renew")) return Promise.resolve("p1");
        return Promise.resolve("");
      });

      const sendSpy = spyOn(context.mediator, "send");
      await command.execute([], context);

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: COMMAND_TYPES.AUTHENTICATE,
          payload: expect.objectContaining({
            profileName: "p1",
            renew: true,
          }),
        }),
      );
    });
  });
});
