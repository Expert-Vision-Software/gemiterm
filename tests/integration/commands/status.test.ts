import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { StatusCommand } from "../../../src/cli/commands/status-command.ts";
import { Mediator } from "../../../src/core/mediator.ts";
import { ProfileManager } from "../../../src/infrastructure/storage.ts";
import type { CliCommandContext } from "../../../src/cli/command-registry.ts";
import { setupTestConfig, teardownTestConfig } from "../../setup.ts";
import * as configModule from "../../../src/infrastructure/config.ts";
import type { ProfileStatus } from "../../../src/core/types.ts";

function getOutput(logSpy: ReturnType<typeof spyOn>): string {
  return logSpy.mock.calls.map((c) => c[0]).join("\n");
}

const freshCookies = [
  { name: "__Secure-1PSID", value: "test", domain: ".google.com", path: "/", expires: Math.floor(Date.now() / 1000) + 86400 * 30, httpOnly: true, secure: true, sameSite: "None" as const },
  { name: "__Secure-1PSIDTS", value: "test", domain: ".google.com", path: "/", expires: Math.floor(Date.now() / 1000) + 86400 * 30, httpOnly: true, secure: true, sameSite: "None" as const },
];

const expiredCookies = [
  { name: "__Secure-1PSID", value: "test", domain: ".google.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "None" as const },
  { name: "__Secure-1PSIDTS", value: "test", domain: ".google.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "None" as const },
];

describe("status command integration", () => {
  let command: StatusCommand;
  let context: CliCommandContext;
  let logSpy: ReturnType<typeof spyOn>;
  let stderrSpy: ReturnType<typeof spyOn>;
  let originalEnv: Record<string, string | undefined>;
  let exitSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    command = new StatusCommand();
    context = { verbose: false, mediator: new Mediator() };
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
    exitSpy = spyOn(process, "exit").mockImplementation(() => {});
    originalEnv = {
      GEMITERM_CONFIG_DIR: process.env.GEMITERM_CONFIG_DIR,
    };
    const configDir = setupTestConfig("status-integration");
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
      expect(command.name).toBe("status");
      expect(command.description).toBe("Show configuration and profile status");
    });
  });

  describe("--help flag", () => {
    test("--help shows usage information", async () => {
      await command.execute(["--help"], context);

      const output = getOutput(logSpy);
      expect(output).toContain("Usage: gemiterm status");
      expect(output).toContain("Options:");
    });

    test("-h shows usage information", async () => {
      await command.execute(["-h"], context);

      const output = getOutput(logSpy);
      expect(output).toContain("Usage: gemiterm status");
    });

    test("help does not access config or profiles", async () => {
      const listSpy = spyOn(configModule, "listProfiles").mockReturnValue([]);
      const ensureSpy = spyOn(configModule, "ensureConfigDir").mockImplementation(() => {});

      await command.execute(["--help"], context);

      expect(listSpy).not.toHaveBeenCalled();
      expect(ensureSpy).not.toHaveBeenCalled();
    });
  });

  describe("no profiles", () => {
    test("displays message when no profiles exist", async () => {
      spyOn(configModule, "listProfiles").mockReturnValue([]);

      await command.execute([], context);

      const output = getOutput(logSpy);
      expect(output).toContain("No profiles found");
      expect(output).toContain("gemiterm login");
    });

    test("exits with code 2 when no profiles exist", async () => {
      spyOn(configModule, "listProfiles").mockReturnValue([]);

      await command.execute([], context);

      expect(exitSpy).toHaveBeenCalledWith(2);
    });
  });

  describe("profile table display", () => {
    function setupProfilesWithStatus(statuses: ProfileStatus[]): void {
      spyOn(configModule, "listProfiles").mockReturnValue(statuses.map((s) => s.name));
      spyOn(configModule, "getDefaultProfileName").mockReturnValue(
        statuses.find((s) => s.isDefault)?.name ?? statuses[0]?.name ?? "default",
      );
      spyOn(ProfileManager.prototype, "getStatus").mockImplementation(function (this: ProfileManager, name: string) {
        const found = statuses.find((s) => s.name === name);
        if (!found) {
          return { name, exists: false, isActive: false, expiresAt: null, isDefault: false };
        }
        return found;
      });
    }

    test("displays configuration header and directory", async () => {
      setupProfilesWithStatus([
        { name: "default", exists: true, isActive: true, expiresAt: "2099-12-31T00:00:00.000Z", isDefault: true },
      ]);

      await command.execute([], context);

      const output = getOutput(logSpy);
      expect(output).toContain("Configuration");
      expect(output).toContain("Directory:");
    });

    test("displays profile table with column headers", async () => {
      setupProfilesWithStatus([
        { name: "work", exists: true, isActive: true, expiresAt: "2099-12-31T00:00:00.000Z", isDefault: true },
        { name: "personal", exists: true, isActive: true, expiresAt: "2099-12-31T00:00:00.000Z", isDefault: false },
      ]);

      await command.execute([], context);

      const output = getOutput(logSpy);
      expect(output).toContain("NAME");
      expect(output).toContain("ACTIVE");
      expect(output).toContain("EXPIRES");
      expect(output).toContain("DEFAULT");
    });

    test("displays profile names in table output", async () => {
      const profiles = ["alpha", "beta"];
      setupProfilesWithStatus([
        { name: "alpha", exists: true, isActive: true, expiresAt: "2099-12-31T00:00:00.000Z", isDefault: true },
        { name: "beta", exists: true, isActive: true, expiresAt: "2099-12-31T00:00:00.000Z", isDefault: false },
      ]);

      await command.execute([], context);

      const output = getOutput(logSpy);
      for (const name of profiles) {
        expect(output).toContain(name);
      }
    });

    test("marks default profile with asterisk", async () => {
      setupProfilesWithStatus([
        { name: "default", exists: true, isActive: true, expiresAt: "2099-12-31T00:00:00.000Z", isDefault: true },
      ]);

      await command.execute([], context);

      const output = getOutput(logSpy);
      expect(output).toContain("* = default profile");
    });

    test("shows active count message on stderr", async () => {
      setupProfilesWithStatus([
        { name: "work", exists: true, isActive: true, expiresAt: "2099-12-31T00:00:00.000Z", isDefault: true },
        { name: "personal", exists: true, isActive: true, expiresAt: "2099-12-31T00:00:00.000Z", isDefault: false },
      ]);

      await command.execute([], context);

      const stderrOutput = stderrSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(stderrOutput).toContain("2 of 2 profile(s) active");
    });
  });

  describe("inactive profiles", () => {
    test("shows inactive indicator in profile table", async () => {
      spyOn(configModule, "listProfiles").mockReturnValue(["expired"]);
      spyOn(configModule, "getDefaultProfileName").mockReturnValue("expired");
      spyOn(ProfileManager.prototype, "getStatus").mockReturnValue({
        name: "expired",
        exists: true,
        isActive: false,
        expiresAt: null,
        isDefault: true,
      });

      await command.execute([], context);

      const output = getOutput(logSpy);
      expect(output).toContain("expired");
      expect(output).toContain("N/A");
    });

    test("logs no valid sessions message on stderr", async () => {
      spyOn(configModule, "listProfiles").mockReturnValue(["expired"]);
      spyOn(configModule, "getDefaultProfileName").mockReturnValue("expired");
      spyOn(ProfileManager.prototype, "getStatus").mockReturnValue({
        name: "expired",
        exists: true,
        isActive: false,
        expiresAt: null,
        isDefault: true,
      });

      await command.execute([], context);

      const stderrOutput = stderrSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(stderrOutput).toContain("No profiles have valid sessions");
    });
  });
});
