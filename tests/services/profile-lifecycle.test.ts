import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { ProfileLifecycle } from "../../src/services/profile-lifecycle.ts";
import type { ProfileStatus } from "../../src/core/types.ts";
import type { Logger } from "../../src/infrastructure/logger.ts";
import type { ProfileManager } from "../../src/infrastructure/storage.ts";
import type { CookieSession } from "../../src/auth/cookie-session.ts";
import { GemitermError } from "../../src/core/errors.ts";
import * as configModule from "../../src/infrastructure/config.ts";
import * as formattersModule from "../../src/infrastructure/formatters.ts";

interface FakeLogger extends Logger {
  debug: ReturnType<typeof mock>;
  info: ReturnType<typeof mock>;
  warn: ReturnType<typeof mock>;
  error: ReturnType<typeof mock>;
}

interface LifecycleHarness {
  lifecycle: ProfileLifecycle;
  profileManager: ProfileManager;
  cookieSession: CookieSession;
  logger: FakeLogger;
  logSpy: ReturnType<typeof spyOn>;
}

function makeStatus(name: string, overrides: Partial<ProfileStatus> = {}): ProfileStatus {
  return {
    name,
    exists: true,
    isActive: true,
    expiresAt: null,
    isDefault: false,
    ...overrides,
  };
}

function makeProfileManager(overrides: Partial<ProfileManager> = {}): ProfileManager {
  return {
    getStatus: mock((name: string) => makeStatus(name)),
    create: mock(() => {}),
    delete: mock(() => {}),
    rename: mock(() => {}),
    setDefault: mock(() => {}),
    ...overrides,
  } as unknown as ProfileManager;
}

function makeCookieSession(overrides: Partial<CookieSession> = {}): CookieSession {
  return {
    captureLogin: mock(async () => ({ cookies: [], expiresAt: null })),
    ...overrides,
  } as unknown as CookieSession;
}

function makeLogger(): FakeLogger {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  } as unknown as FakeLogger;
}

function makeLifecycle(
  overrides: {
    profileManager?: ProfileManager;
    cookieSession?: CookieSession;
    logger?: FakeLogger;
  } = {},
): LifecycleHarness {
  const logger = overrides.logger ?? makeLogger();
  const profileManager = overrides.profileManager ?? makeProfileManager();
  const cookieSession = overrides.cookieSession ?? makeCookieSession();
  const lifecycle = new ProfileLifecycle({
    profileManager,
    cookieSession,
    logger,
  });
  const logSpy = spyOn(console, "log").mockImplementation(() => {});
  return { lifecycle, profileManager, cookieSession, logger, logSpy };
}

let promptsModule: typeof import("../../src/cli/utils/prompts.ts");

beforeEach(async () => {
  promptsModule = await import("../../src/cli/utils/prompts.ts");
  spyOn(configModule, "listProfiles").mockReturnValue([]);
  spyOn(configModule, "getDefaultProfileName").mockReturnValue("default");
  spyOn(configModule, "setDefaultProfileName").mockImplementation(() => {});
  spyOn(configModule, "getConfigDir").mockReturnValue("/tmp/gemiterm");
  spyOn(configModule, "ensureConfigDir").mockImplementation(() => {});
  spyOn(formattersModule, "formatProfileTable").mockReturnValue("TABLE");
});

afterEach(() => {
  mock.restore();
});

describe("ProfileLifecycle", () => {
  describe("manageProfiles dispatch", () => {
    test("rejects an unknown action with a GemitermError listing valid actions", async () => {
      const { lifecycle } = makeLifecycle();

      await expect(
        lifecycle.manageProfiles("bogus" as never, {}),
      ).rejects.toBeInstanceOf(GemitermError);

      await expect(
        lifecycle.manageProfiles("bogus" as never, {}),
      ).rejects.toThrow("Unknown profile action 'bogus'");
    });
  });

  describe("list action", () => {
    test("renders the table with the default marker", async () => {
      const profileManager = makeProfileManager({
        getStatus: mock((name: string) => makeStatus(name, { isActive: name === "work" })),
      });
      const { lifecycle, logSpy } = makeLifecycle({ profileManager });

      spyOn(configModule, "listProfiles").mockReturnValue(["work", "personal"]);
      spyOn(configModule, "getDefaultProfileName").mockReturnValue("work");

      await lifecycle.manageProfiles("list", {});

      expect(profileManager.getStatus).toHaveBeenCalledWith("work");
      expect(profileManager.getStatus).toHaveBeenCalledWith("personal");

      const tableArg = (formattersModule.formatProfileTable as ReturnType<typeof mock>).mock
        .calls[0][0] as ProfileStatus[];
      expect(tableArg).toHaveLength(2);
      expect(tableArg.find((s) => s.name === "work")?.isDefault).toBe(true);
      expect(tableArg.find((s) => s.name === "personal")?.isDefault).toBe(false);

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Profiles"));
    });

    test("prints guidance when no profiles exist", async () => {
      const { lifecycle, logSpy } = makeLifecycle();

      spyOn(configModule, "listProfiles").mockReturnValue([]);

      await lifecycle.manageProfiles("list", {});

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("No profiles found"),
      );
    });
  });

  describe("status action", () => {
    test("prints configuration and profile sections and logs active count", async () => {
      const profileManager = makeProfileManager();
      const { lifecycle, logSpy, logger } = makeLifecycle({ profileManager });

      spyOn(configModule, "listProfiles").mockReturnValue(["work"]);
      spyOn(configModule, "getDefaultProfileName").mockReturnValue("work");

      await lifecycle.manageProfiles("status", {});

      const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Configuration");
      expect(output).toContain("Directory: /tmp/gemiterm");
      expect(output).toContain("Profiles");

      expect(logger.info).toHaveBeenCalledWith("1 of 1 profile(s) active");
    });

    test("signals exit code 2 when no profiles exist", async () => {
      const { lifecycle, logSpy } = makeLifecycle();

      spyOn(configModule, "listProfiles").mockReturnValue([]);

      const result = await lifecycle.manageProfiles("status", {});

      expect(result).toEqual({ exitCode: 2 });
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("No profiles found"),
      );
    });

    test("logs no-valid-sessions message when profiles exist but none are active", async () => {
      const profileManager = makeProfileManager({
        getStatus: mock((name: string) => makeStatus(name, { isActive: false })),
      });
      const { lifecycle, logger } = makeLifecycle({ profileManager });

      spyOn(configModule, "listProfiles").mockReturnValue(["expired"]);
      spyOn(configModule, "getDefaultProfileName").mockReturnValue("expired");

      await lifecycle.manageProfiles("status", {});

      expect(logger.info).toHaveBeenCalledWith(
        "No profiles have valid sessions. Run 'gemiterm login' to authenticate.",
      );
    });
  });

  describe("create action", () => {
    test("rejects invalid names before creating", async () => {
      const profileManager = makeProfileManager();
      const { lifecycle } = makeLifecycle({ profileManager });

      await expect(
        lifecycle.manageProfiles("create", { name: "bad name!" }),
      ).rejects.toThrow("invalid characters");

      expect(profileManager.create).not.toHaveBeenCalled();
    });

    test("creates the profile and delegates the login flow", async () => {
      const profileManager = makeProfileManager();
      const cookieSession = makeCookieSession();
      const { lifecycle } = makeLifecycle({ profileManager, cookieSession });

      spyOn(configModule, "listProfiles").mockReturnValue([]);

      await lifecycle.manageProfiles("create", { name: "new-profile" });

      expect(profileManager.create).toHaveBeenCalledWith("new-profile");
      expect(cookieSession.captureLogin).toHaveBeenCalledWith("new-profile");
    });

    test("throws when the profile already exists", async () => {
      const profileManager = makeProfileManager();
      const { lifecycle } = makeLifecycle({ profileManager });

      spyOn(configModule, "listProfiles").mockReturnValue(["existing"]);

      await expect(
        lifecycle.manageProfiles("create", { name: "existing" }),
      ).rejects.toThrow("already exists");
    });
  });

  describe("delete action", () => {
    test("prints Cancelled. and skips deletion when declined", async () => {
      const profileManager = makeProfileManager();
      const { lifecycle, logSpy } = makeLifecycle({ profileManager });

      spyOn(configModule, "listProfiles").mockReturnValue(["work"]);
      spyOn(promptsModule, "text").mockResolvedValue("n");

      await lifecycle.manageProfiles("delete", { name: "work" });

      expect(profileManager.delete).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("Cancelled."));
    });

    test("deletes the profile when confirmed", async () => {
      const profileManager = makeProfileManager();
      const { lifecycle } = makeLifecycle({ profileManager });

      spyOn(configModule, "listProfiles").mockReturnValue(["work"]);
      spyOn(promptsModule, "text").mockResolvedValue("y");

      await lifecycle.manageProfiles("delete", { name: "work" });

      expect(profileManager.delete).toHaveBeenCalledWith("work");
    });

    test("skips the prompt when skipConfirm is set", async () => {
      const profileManager = makeProfileManager();
      const { lifecycle } = makeLifecycle({ profileManager });

      spyOn(configModule, "listProfiles").mockReturnValue(["work"]);
      const textSpy = spyOn(promptsModule, "text");

      await lifecycle.manageProfiles("delete", { name: "work", skipConfirm: true });

      expect(textSpy).not.toHaveBeenCalled();
      expect(profileManager.delete).toHaveBeenCalledWith("work");
    });

    test("throws when the profile does not exist", async () => {
      const { lifecycle } = makeLifecycle();

      spyOn(configModule, "listProfiles").mockReturnValue([]);

      await expect(
        lifecycle.manageProfiles("delete", { name: "ghost" }),
      ).rejects.toThrow("does not exist");
    });
  });

  describe("rename action", () => {
    test("renames the profile", async () => {
      const profileManager = makeProfileManager();
      const { lifecycle } = makeLifecycle({ profileManager });

      spyOn(configModule, "listProfiles").mockReturnValue(["old"]);

      await lifecycle.manageProfiles("rename", { oldName: "old", newName: "new" });

      expect(profileManager.rename).toHaveBeenCalledWith("old", "new");
    });

    test("validates the new name", async () => {
      const { lifecycle } = makeLifecycle();

      spyOn(configModule, "listProfiles").mockReturnValue(["old"]);

      await expect(
        lifecycle.manageProfiles("rename", { oldName: "old", newName: "bad name!" }),
      ).rejects.toThrow("invalid characters");
    });

    test("throws when renaming to an existing name", async () => {
      const { lifecycle } = makeLifecycle();

      spyOn(configModule, "listProfiles").mockReturnValue(["old", "new"]);

      await expect(
        lifecycle.manageProfiles("rename", { oldName: "old", newName: "new" }),
      ).rejects.toThrow("already exists");
    });
  });

  describe("set-default action", () => {
    test("updates both marker surfaces", async () => {
      const profileManager = makeProfileManager();
      const { lifecycle } = makeLifecycle({ profileManager });
      const setDefaultSpy = spyOn(configModule, "setDefaultProfileName");

      spyOn(configModule, "listProfiles").mockReturnValue(["p1", "p2"]);

      await lifecycle.manageProfiles("set-default", { name: "p2" });

      expect(profileManager.setDefault).toHaveBeenCalledWith("p2");
      expect(setDefaultSpy).toHaveBeenCalledWith("p2");
    });
  });

  describe("auth action", () => {
    test("creates and authenticates the default profile when none exist", async () => {
      const profileManager = makeProfileManager();
      const cookieSession = makeCookieSession();
      const { lifecycle } = makeLifecycle({ profileManager, cookieSession });

      spyOn(configModule, "listProfiles").mockReturnValue([]);
      spyOn(configModule, "getDefaultProfileName").mockReturnValue("default");

      await lifecycle.manageProfiles("auth", {});

      expect(profileManager.create).toHaveBeenCalledWith("default");
      expect(cookieSession.captureLogin).toHaveBeenCalledWith("default");
    });

    test("authenticates the single profile directly", async () => {
      const profileManager = makeProfileManager();
      const cookieSession = makeCookieSession();
      const { lifecycle } = makeLifecycle({ profileManager, cookieSession });

      spyOn(configModule, "listProfiles").mockReturnValue(["solo"]);

      await lifecycle.manageProfiles("auth", {});

      expect(profileManager.create).not.toHaveBeenCalled();
      expect(cookieSession.captureLogin).toHaveBeenCalledWith("solo");
    });

    test("renews a named profile", async () => {
      const cookieSession = makeCookieSession();
      const { lifecycle } = makeLifecycle({ cookieSession });

      spyOn(configModule, "listProfiles").mockReturnValue(["p1"]);

      await lifecycle.manageProfiles("auth", { renewProfile: "p1" });

      expect(cookieSession.captureLogin).toHaveBeenCalledWith("p1", { mode: "renew" });
    });

    test("authenticates directly when a profileName is provided", async () => {
      const cookieSession = makeCookieSession();
      const { lifecycle } = makeLifecycle({ cookieSession });

      spyOn(configModule, "listProfiles").mockReturnValue(["p1", "p2"]);

      await lifecycle.manageProfiles("auth", { profileName: "p1" });

      expect(cookieSession.captureLogin).toHaveBeenCalledWith("p1");
    });

    test("shows the menu and exits with the default when X is selected", async () => {
      const profileManager = makeProfileManager({
        getStatus: mock((name: string) => makeStatus(name, { isDefault: name === "p1" })),
      });
      const cookieSession = makeCookieSession();
      const { lifecycle, logSpy } = makeLifecycle({ profileManager, cookieSession });

      spyOn(configModule, "listProfiles").mockReturnValue(["p1", "p2"]);
      spyOn(promptsModule, "text").mockResolvedValue("X");

      await lifecycle.manageProfiles("auth", {});

      expect(cookieSession.captureLogin).not.toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("Continuing with current default"),
      );
    });
  });

  describe("warn-and-continue", () => {
    test("one unreadable profile does not abort the table", async () => {
      const profileManager = makeProfileManager({
        getStatus: mock((name: string) => {
          if (name === "broken") throw new Error("unreadable storage");
          return makeStatus(name);
        }),
      });
      const { lifecycle, logger } = makeLifecycle({ profileManager });

      spyOn(configModule, "listProfiles").mockReturnValue(["broken", "work", "personal"]);
      spyOn(configModule, "getDefaultProfileName").mockReturnValue("work");

      await lifecycle.manageProfiles("list", {});

      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("broken"));

      const tableArg = (formattersModule.formatProfileTable as ReturnType<typeof mock>).mock
        .calls[0][0] as ProfileStatus[];
      expect(tableArg.map((s) => s.name)).toEqual(["work", "personal"]);
    });

    test("all profiles failing still completes without throwing", async () => {
      const profileManager = makeProfileManager({
        getStatus: mock(() => {
          throw new Error("unreadable storage");
        }),
      });
      const { lifecycle, logger } = makeLifecycle({ profileManager });

      spyOn(configModule, "listProfiles").mockReturnValue(["a", "b"]);

      await expect(lifecycle.manageProfiles("list", {})).resolves.toBeUndefined();

      expect(logger.warn).toHaveBeenCalledTimes(2);
    });
  });
});
