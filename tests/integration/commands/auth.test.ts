import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { AuthCommand } from "../../../src/cli/commands/auth-command.ts";
import type { CliCommandContext } from "../../../src/cli/command-registry.ts";
import { ProfileLifecycle } from "../../../src/services/profile-lifecycle.ts";
import { CookieStorage, ProfileManager } from "../../../src/infrastructure/storage.ts";
import type { CookieSession } from "../../../src/auth/cookie-session.ts";
import { Logger } from "../../../src/infrastructure/logger.ts";
import { setupTestConfig, teardownTestConfig } from "../../setup.ts";
import * as configModule from "../../../src/infrastructure/config.ts";

let promptsModule: typeof import("../../../src/cli/utils/prompts.ts");

describe("auth command integration", () => {
  let command: AuthCommand;
  let context: CliCommandContext;
  let logSpy: ReturnType<typeof spyOn>;
  let originalEnv: Record<string, string | undefined>;
  let cookieSession: CookieSession;

  beforeEach(async () => {
    command = new AuthCommand();
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    originalEnv = {
      GEMITERM_CONFIG_DIR: process.env.GEMITERM_CONFIG_DIR,
    };
    const configDir = setupTestConfig("auth-integration");

    const cookieStorage = new CookieStorage();
    const profileManager = new ProfileManager(cookieStorage);
    cookieSession = {
      captureLogin: mock(async () => ({ cookies: [], expiresAt: null })),
    } as unknown as CookieSession;

    const lifecycle = new ProfileLifecycle({
      profileManager,
      cookieSession,
      logger: new Logger("test"),
    });

    context = {
      verbose: false,
      profileLifecycle: lifecycle,
    } as unknown as CliCommandContext;

    promptsModule = await import("../../../src/cli/utils/prompts.ts");
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

      await command.execute([], context);

      expect(cookieSession.captureLogin).toHaveBeenCalledWith("default");
    });

    test("authenticates with the only profile when one exists", async () => {
      spyOn(configModule, "listProfiles").mockReturnValue(["solo"]);

      await command.execute([], context);

      expect(cookieSession.captureLogin).toHaveBeenCalledWith("solo");
    });

    test("propagates authentication errors", async () => {
      spyOn(configModule, "listProfiles").mockReturnValue(["default"]);
      (cookieSession.captureLogin as ReturnType<typeof mock>).mockRejectedValueOnce(
        new Error("Browser launch failed"),
      );

      await expect(command.execute([], context)).rejects.toThrow("Browser launch failed");
    });

    test("propagates LoginCancelledError unchanged (caller decides exit semantics)", async () => {
      spyOn(configModule, "listProfiles").mockReturnValue(["default"]);
      const { LoginCancelledError } = await import("../../../src/core/errors.ts");
      (cookieSession.captureLogin as ReturnType<typeof mock>).mockRejectedValueOnce(
        new LoginCancelledError(),
      );

      await expect(command.execute([], context)).rejects.toBeInstanceOf(LoginCancelledError);
    });
  });

  describe("profile selection menu", () => {
    test("displays profile menu when multiple profiles exist", async () => {
      const profiles = ["work", "personal", "dev"];
      spyOn(configModule, "listProfiles").mockReturnValue(profiles);
      spyOn(promptsModule, "text").mockResolvedValue("X");

      await command.execute([], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Profile Management");
    });

    test("menu shows all profile options", async () => {
      const profiles = ["alpha", "beta"];
      spyOn(configModule, "listProfiles").mockReturnValue(profiles);
      spyOn(promptsModule, "text").mockResolvedValue("X");

      await command.execute([], context);

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

    test("selecting a profile from menu triggers authentication", async () => {
      spyOn(configModule, "listProfiles").mockReturnValue(["p1", "p2"]);
      spyOn(promptsModule, "text").mockImplementation((opts: { message: string }) => {
        if (opts.message === "Select an option") return Promise.resolve("A");
        if (opts.message === "Enter profile name") return Promise.resolve("p3");
        return Promise.resolve("");
      });

      await command.execute([], context);

      expect(cookieSession.captureLogin).toHaveBeenCalledWith("p3");
    });

    test("exiting menu continues with default profile", async () => {
      spyOn(configModule, "listProfiles").mockReturnValue(["p1", "p2"]);
      spyOn(promptsModule, "text").mockResolvedValue("X");

      await command.execute([], context);

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Continuing with current default");
    });

    test("adding profile from menu triggers auth with new name", async () => {
      spyOn(configModule, "listProfiles").mockReturnValue(["existing", "other"]);
      spyOn(promptsModule, "text").mockImplementation((opts: { message: string }) => {
        if (opts.message === "Select an option") return Promise.resolve("A");
        if (opts.message === "Enter profile name") return Promise.resolve("brand-new");
        return Promise.resolve("");
      });

      await command.execute([], context);

      expect(cookieSession.captureLogin).toHaveBeenCalledWith("brand-new");
    });
  });
});
