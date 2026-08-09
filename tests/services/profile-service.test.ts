import { describe, test, expect, mock } from "bun:test";
import { ProfileService } from "../../src/services/profile-service.ts";
import type { AuthService } from "../../src/services/auth-service.ts";
import type { ProfileManager } from "../../src/infrastructure/storage.ts";
import type { AuthResult, Cookie } from "../../src/core/types.ts";

function makeMockCookies(): Cookie[] {
  const farFuture = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
  return [
    {
      name: "__Secure-1PSID",
      value: "test-psid-value",
      domain: ".google.com",
      path: "/",
      expires: farFuture,
      httpOnly: true,
      secure: true,
      sameSite: "Lax" as const,
    },
    {
      name: "__Secure-1PSIDTS",
      value: "test-psidts-value",
      domain: ".google.com",
      path: "/",
      expires: farFuture,
      httpOnly: true,
      secure: true,
      sameSite: "Lax" as const,
    },
  ];
}

function makeMockAuthResult(): AuthResult {
  return { cookies: makeMockCookies(), expiresAt: new Date("2030-01-01") };
}

function createMocks() {
  const mockAuthService = {
    authenticate: mock(async (_profileName: string) => makeMockAuthResult()),
    renew: mock(async (_profileName: string) => makeMockAuthResult()),
  } as unknown as AuthService;

  const mockProfileManager = {
    create: mock(() => {}),
    delete: mock(() => {}),
    rename: mock(() => {}),
    setDefault: mock(() => {}),
    getDefault: mock(() => "default"),
    list: mock(() => ["default"]),
    getStatus: mock(() => ({ name: "default", exists: true, isActive: true, expiresAt: "2030-01-01T00:00:00.000Z", isDefault: true })),
    getAllStatuses: mock(() => [{ name: "default", exists: true, isActive: true, expiresAt: "2030-01-01T00:00:00.000Z", isDefault: true }]),
    hasValidCookies: mock(() => true),
  } as unknown as ProfileManager;

  const svc = new ProfileService(mockAuthService, mockProfileManager);

  return { svc, mockAuthService, mockProfileManager };
}

describe("ProfileService", () => {
  describe("authenticate", () => {
    test("delegates to authService.authenticate by default", async () => {
      const { svc, mockAuthService } = createMocks();
      const result = await svc.authenticate("default");

      expect(mockAuthService.authenticate).toHaveBeenCalledWith("default");
      expect(mockAuthService.renew).not.toHaveBeenCalled();
      expect(result.cookies).toHaveLength(2);
    });

    test("delegates to authService.renew when renew option is true", async () => {
      const { svc, mockAuthService } = createMocks();
      const result = await svc.authenticate("default", { renew: true });

      expect(mockAuthService.renew).toHaveBeenCalledWith("default");
      expect(mockAuthService.authenticate).not.toHaveBeenCalled();
      expect(result.cookies).toHaveLength(2);
    });
  });

  describe("deleteProfile", () => {
    test("delegates to profileManager.delete", async () => {
      const { svc, mockProfileManager } = createMocks();
      await svc.deleteProfile("to-delete");

      expect(mockProfileManager.delete).toHaveBeenCalledWith("to-delete");
    });
  });

  describe("renameProfile", () => {
    test("delegates to profileManager.rename", async () => {
      const { svc, mockProfileManager } = createMocks();
      await svc.renameProfile("old", "new");

      expect(mockProfileManager.rename).toHaveBeenCalledWith("old", "new");
    });
  });

  describe("setDefaultProfile", () => {
    test("delegates to profileManager.setDefault and setDefaultProfileName", async () => {
      const { svc, mockProfileManager } = createMocks();
      await svc.setDefaultProfile("p2");

      expect(mockProfileManager.setDefault).toHaveBeenCalledWith("p2");
    });
  });

  describe("listProfileStatuses", () => {
    test("delegates to profileManager.getAllStatuses", () => {
      const { svc, mockProfileManager } = createMocks();
      const statuses = svc.listProfileStatuses();

      expect(mockProfileManager.getAllStatuses).toHaveBeenCalled();
      expect(statuses).toHaveLength(1);
      expect(statuses[0].name).toBe("default");
    });
  });

  describe("listProfiles", () => {
    test("returns profile names", () => {
      const { svc } = createMocks();
      const profiles = svc.listProfiles();

      expect(profiles).toContain("default");
    });
  });
});
