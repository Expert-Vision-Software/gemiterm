import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { StatusCommand } from "../../../src/cli/commands/status-command.ts";
import { ProfileLifecycle } from "../../../src/services/profile-lifecycle.ts";
import { CookieStorage, ProfileManager } from "../../../src/infrastructure/storage.ts";
import type { CookieSession, SessionProbeResult } from "../../../src/auth/cookie-session.ts";
import { Logger } from "../../../src/infrastructure/logger.ts";
import type { CliCommandContext } from "../../../src/cli/command-registry.ts";
import { setupTestConfig, teardownTestConfig } from "../../setup.ts";
import * as configModule from "../../../src/infrastructure/config.ts";
import type { ProfileStatus } from "../../../src/core/types.ts";

function getOutput(logSpy: ReturnType<typeof spyOn>): string {
  return logSpy.mock.calls.map((c) => c[0]).join("\n");
}

describe("status command integration", () => {
  let command: StatusCommand;
  let context: CliCommandContext;
  let logSpy: ReturnType<typeof spyOn>;
  let stderrSpy: ReturnType<typeof spyOn>;
  let originalEnv: Record<string, string | undefined>;
  let exitSpy: ReturnType<typeof spyOn>;
  let cookieSessionFake: {
    probeDetailed: ReturnType<typeof mock>;
    refresh: ReturnType<typeof mock>;
    recover: ReturnType<typeof mock>;
    captureLogin: ReturnType<typeof mock>;
  };

  function setupProfilesWithStatus(statuses: ProfileStatus[]): void {
    spyOn(configModule, "listProfiles").mockReturnValue(statuses.map((s) => s.name));
    spyOn(configModule, "getDefaultProfileName").mockReturnValue(
      statuses.find((s) => s.isDefault)?.name ?? statuses[0]?.name ?? "default",
    );
    spyOn(ProfileManager.prototype, "getStatus").mockImplementation(function (
      this: ProfileManager,
      name: string,
    ) {
      const found = statuses.find((s) => s.name === name);
      if (!found) {
        return { name, exists: false, isActive: false, expiresAt: null, isDefault: false };
      }
      return found;
    });
  }

  beforeEach(() => {
    command = new StatusCommand();
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
    exitSpy = spyOn(process, "exit").mockImplementation(() => {});
    originalEnv = {
      GEMITERM_CONFIG_DIR: process.env.GEMITERM_CONFIG_DIR,
    };
    const configDir = setupTestConfig("status-integration");

    const cookieStorage = new CookieStorage();
    const profileManager = new ProfileManager(cookieStorage);
    cookieSessionFake = {
      probeDetailed: mock(async (_profile: string): Promise<SessionProbeResult> => ({
        state: "live",
        chatCount: 0,
      })),
      refresh: mock(async () => ({ rotated: false })),
      recover: mock(async () => ({})),
      captureLogin: mock(async () => ({ success: true })),
    };
    const lifecycle = new ProfileLifecycle({
      profileManager,
      cookieSession: cookieSessionFake as unknown as CookieSession,
      logger: new Logger("test"),
    });

    context = {
      verbose: false,
      profileLifecycle: lifecycle,
    } as unknown as CliCommandContext;

    spyOn(configModule, "getConfigDir").mockReturnValue(configDir);
    spyOn(configModule, "ensureConfigDir").mockImplementation(() => {});
  });

  afterEach(() => {
    mock.restore();
    logSpy.mockRestore();
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
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

  describe("session probe (--verbose)", () => {
    test("--verbose renders the PROBE column from classifier states in profile order", async () => {
      setupProfilesWithStatus([
        { name: "work", exists: true, isActive: true, expiresAt: "2099-12-31T00:00:00.000Z", isDefault: true },
        { name: "personal", exists: true, isActive: true, expiresAt: "2099-06-30T00:00:00.000Z", isDefault: false },
        { name: "broken", exists: true, isActive: false, expiresAt: null, isDefault: false },
      ]);
      cookieSessionFake.probeDetailed.mockImplementation(async (name: string) => {
        if (name === "work") return { state: "live" as const, chatCount: 3 };
        if (name === "personal") return { state: "phantom" as const, chatCount: 0 };
        return { state: "dead" as const, chatCount: 0 };
      });

      await command.execute(["--verbose"], context);

      const output = getOutput(logSpy);
      expect(output).toContain("PROBE");
      expect(output).toContain("live (3)");
      expect(output).toContain("phantom");
      expect(output).toContain("dead");
      expect(output.indexOf("live (3)")).toBeLessThan(output.indexOf("phantom"));
      expect(output.indexOf("phantom")).toBeLessThan(output.indexOf("dead"));
      expect(cookieSessionFake.probeDetailed).toHaveBeenCalledTimes(3);
    });

    test("default status performs zero probes and shows no PROBE column", async () => {
      setupProfilesWithStatus([
        { name: "work", exists: true, isActive: true, expiresAt: "2099-12-31T00:00:00.000Z", isDefault: true },
        { name: "personal", exists: true, isActive: true, expiresAt: "2099-06-30T00:00:00.000Z", isDefault: false },
      ]);

      await command.execute([], context);

      expect(cookieSessionFake.probeDetailed).not.toHaveBeenCalled();
      const output = getOutput(logSpy);
      expect(output).not.toContain("PROBE");
      expect(output).toContain("NAME");
      expect(output).toContain("ACTIVE");
      expect(output).toContain("EXPIRES");
      expect(output).toContain("DEFAULT");
    });

    test("default status output is byte-identical with and without the flag wiring present", async () => {
      setupProfilesWithStatus([
        { name: "work", exists: true, isActive: true, expiresAt: "2099-12-31T00:00:00.000Z", isDefault: true },
        { name: "personal", exists: true, isActive: false, expiresAt: null, isDefault: false },
      ]);

      await command.execute([], context);
      const first = getOutput(logSpy);

      logSpy.mockRestore();
      const secondLogSpy = spyOn(console, "log").mockImplementation(() => {});
      await command.execute([], context);
      const second = getOutput(secondLogSpy);
      secondLogSpy.mockRestore();

      expect(second).toBe(first);
    });

    test("probe is read-only: no refresh/recover/captureLogin calls", async () => {
      setupProfilesWithStatus([
        { name: "work", exists: true, isActive: true, expiresAt: "2099-12-31T00:00:00.000Z", isDefault: true },
      ]);

      await command.execute(["--verbose"], context);

      expect(cookieSessionFake.probeDetailed).toHaveBeenCalledTimes(1);
      expect(cookieSessionFake.refresh).not.toHaveBeenCalled();
      expect(cookieSessionFake.recover).not.toHaveBeenCalled();
      expect(cookieSessionFake.captureLogin).not.toHaveBeenCalled();
    });

    test("probe failure renders unknown (—) and warns, never dead", async () => {
      setupProfilesWithStatus([
        { name: "work", exists: true, isActive: true, expiresAt: "2099-12-31T00:00:00.000Z", isDefault: true },
        { name: "broken", exists: true, isActive: false, expiresAt: null, isDefault: false },
      ]);
      cookieSessionFake.probeDetailed.mockImplementation(async (name: string) => {
        if (name === "broken") throw new Error("probe exploded");
        return { state: "live" as const, chatCount: 1 };
      });

      await command.execute(["--verbose"], context);

      const output = getOutput(logSpy);
      expect(output).toContain("live (1)");
      expect(output).toContain("—");
      expect(output).not.toContain("dead");
      const stderrOutput = stderrSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(stderrOutput).toContain("WARN");
      expect(stderrOutput).toContain("broken");
    });
  });
});
