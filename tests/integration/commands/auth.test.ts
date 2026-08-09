import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { AuthCommand } from "../../../src/cli/commands/auth-command.ts";
import { Mediator } from "../../../src/core/mediator.ts";
import type { CliCommandContext } from "../../../src/cli/command-registry.ts";
import { COMMAND_TYPES } from "../../../src/core/command-handlers.ts";
import { setupTestConfig, teardownTestConfig } from "../../setup.ts";
import * as configModule from "../../../src/infrastructure/config.ts";

function registerAllHandlers(mediator: Mediator, overrides?: {
  authHandler?: { commandType: string; handle: ReturnType<typeof mock> };
}) {
  const authHandler = overrides?.authHandler ?? {
    commandType: COMMAND_TYPES.AUTHENTICATE,
    handle: mock(async () => ({ success: true, cookieCount: 0, expiresAt: null })),
  };
  mediator.registerCommandHandler(authHandler as any);
  mediator.registerCommandHandler({
    commandType: COMMAND_TYPES.DELETE_PROFILE,
    handle: mock(async () => ({ success: true })),
  } as any);
  mediator.registerCommandHandler({
    commandType: COMMAND_TYPES.RENAME_PROFILE,
    handle: mock(async () => ({ success: true })),
  } as any);
  mediator.registerCommandHandler({
    commandType: COMMAND_TYPES.SET_DEFAULT_PROFILE,
    handle: mock(async () => ({ success: true })),
  } as any);
}

describe("auth command integration", () => {
  let command: AuthCommand;
  let context: CliCommandContext;
  let mediator: Mediator;
  let logSpy: ReturnType<typeof spyOn>;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    command = new AuthCommand();
    mediator = new Mediator();
    registerAllHandlers(mediator);
    context = { verbose: false, mediator };
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    originalEnv = {
      GEMITERM_CONFIG_DIR: process.env.GEMITERM_CONFIG_DIR,
    };
    const configDir = setupTestConfig("auth-integration");
    spyOn(configModule, "getConfigDir").mockReturnValue(configDir);
    spyOn(configModule, "ensureConfigDir").mockImplementation(() => {});
    spyOn(configModule, "getDefaultProfileName").mockReturnValue("default");
  });

  afterEach(() => {
    mock.restore();
    logSpy.mockRestore();
    teardownTestConfig(originalEnv);
  });

  describe("command metadata", () => {
    test("has correct name and description", () => {
      expect(command.name).toBe("auth");
      expect(command.description).toBe("Authenticate with Google Gemini");
    });
  });

  describe("auth flow with mock browser", () => {
    test("creates first profile and authenticates when no profiles exist", async () => {
      spyOn(configModule, "listProfiles").mockReturnValue([]);

      const sendSpy = spyOn(mediator, "send");
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

    test("authenticates with the only profile when one exists", async () => {
      spyOn(configModule, "listProfiles").mockReturnValue(["solo"]);

      const sendSpy = spyOn(mediator, "send");
      await command.execute([], context);

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: COMMAND_TYPES.AUTHENTICATE,
          payload: expect.objectContaining({
            profileName: "solo",
          }),
        }),
      );
    });

    test("propagates authentication errors", async () => {
      spyOn(configModule, "listProfiles").mockReturnValue(["default"]);
      const faultMediator = new Mediator();
      const errorHandler = {
        commandType: COMMAND_TYPES.AUTHENTICATE,
        handle: mock(async () => {
          throw new Error("Browser launch failed");
        }),
      };
      faultMediator.registerCommandHandler(errorHandler as any);
      faultMediator.registerCommandHandler({
        commandType: COMMAND_TYPES.DELETE_PROFILE,
        handle: mock(async () => ({ success: true })),
      } as any);
      faultMediator.registerCommandHandler({
        commandType: COMMAND_TYPES.RENAME_PROFILE,
        handle: mock(async () => ({ success: true })),
      } as any);
      faultMediator.registerCommandHandler({
        commandType: COMMAND_TYPES.SET_DEFAULT_PROFILE,
        handle: mock(async () => ({ success: true })),
      } as any);
      const faultContext = { verbose: false as const, mediator: faultMediator };

      await expect(command.execute([], faultContext)).rejects.toThrow("Browser launch failed");
    });
  });

  describe("profile selection menu", () => {
    test("displays profile menu when multiple profiles exist", async () => {
      const profiles = ["work", "personal", "dev"];

      spyOn(configModule, "listProfiles").mockReturnValue(profiles);
      const menuSpy = spyOn(command as any, "showProfileMenu").mockResolvedValue(null);

      await command.execute([], context);

      expect(menuSpy).toHaveBeenCalled();
    });

    test("menu shows all profile options", async () => {
      const profiles = ["alpha", "beta"];
      spyOn(command as any, "promptInput").mockResolvedValue("X");

      const mockProfileManager = {
        getStatus: mock((name: string) => ({
          name,
          exists: true,
          isActive: true,
          expiresAt: null,
          isDefault: name === "alpha",
        })),
        create: mock(() => {}),
        delete: mock(() => {}),
        rename: mock(() => {}),
        setDefault: mock(() => {}),
      };

      await (command as any).showProfileMenu(profiles, mockProfileManager, mediator);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("[A]");
      expect(output).toContain("Add new profile");
      expect(output).toContain("[D]");
      expect(output).toContain("Delete profile");
      expect(output).toContain("[S]");
      expect(output).toContain("Set default");
      expect(output).toContain("[R]");
      expect(output).toContain("Rename profile");
      expect(output).toContain("[X]");
      expect(output).toContain("Exit");
    });

    test("selecting a profile from menu triggers authentication via mediator", async () => {
      spyOn(configModule, "listProfiles")
        .mockReturnValueOnce(["p1", "p2"])
        .mockReturnValueOnce(["p1", "p2"]);

      spyOn(command as any, "promptInput").mockImplementation(
        (prompt: string) => {
          if (prompt.includes("Select")) return Promise.resolve("A");
          if (prompt.includes("Enter profile name")) return Promise.resolve("p3");
          return Promise.resolve("");
        },
      );

      const sendSpy = spyOn(mediator, "send");
      await command.execute([], context);

      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: COMMAND_TYPES.AUTHENTICATE,
          payload: expect.objectContaining({
            profileName: "p3",
            create: true,
          }),
        }),
      );
    });

    test("exiting menu continues with default profile", async () => {
      spyOn(configModule, "listProfiles").mockReturnValue(["p1", "p2"]);
      spyOn(command as any, "showProfileMenu").mockResolvedValue(null);

      await command.execute([], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Continuing with current default");
    });

    test("adding profile from menu triggers auth with new name", async () => {
      const profiles = ["existing"];
      const newProfileName = "brand-new";

      spyOn(configModule, "listProfiles").mockReturnValue(profiles);

      const mockProfileManager = {
        create: mock(() => {}),
        getStatus: mock(() => ({
          name: "existing",
          exists: true,
          isActive: true,
          expiresAt: null,
          isDefault: true,
        })),
        delete: mock(() => {}),
        rename: mock(() => {}),
        setDefault: mock(() => {}),
      };

      spyOn(command as any, "promptInput").mockImplementation(
        (prompt: string) => {
          if (prompt.includes("Select")) return Promise.resolve("A");
          if (prompt.includes("Enter profile name")) return Promise.resolve(newProfileName);
          return Promise.resolve("");
        },
      );

      const sendSpy = spyOn(mediator, "send");

      const result = await (command as any).showProfileMenu(profiles, mockProfileManager, mediator);

      expect(result).toEqual({ type: "auth", profileName: newProfileName });
      expect(sendSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: COMMAND_TYPES.AUTHENTICATE,
          payload: expect.objectContaining({
            profileName: newProfileName,
            create: true,
          }),
        }),
      );
    });
  });
});
