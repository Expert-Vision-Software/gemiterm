import { describe, test, expect, mock } from "bun:test";
import { buildFullStack } from "../helpers/full-stack-fixture.ts";
import type { Cookie } from "../../src/core/types.ts";

const farFuture = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;

function makeBaseCookie(name: string, value: string, domain = ".google.com"): Cookie {
  return {
    name,
    value,
    domain,
    path: "/",
    expires: farFuture,
    httpOnly: true,
    secure: true,
    sameSite: "Lax" as const,
  };
}

function makePsid(value = "psid-test-value"): Cookie {
  return makeBaseCookie("__Secure-1PSID", value);
}

function makePsidts(value = "psidts-test-value"): Cookie {
  return makeBaseCookie("__Secure-1PSIDTS", value);
}

function makeCompanions(): Cookie[] {
  return [
    makeBaseCookie("SID", "sid-test"),
    makeBaseCookie("HSID", "hsid-test"),
    makeBaseCookie("SSID", "ssid-test"),
    makeBaseCookie("APISID", "apisid-test"),
    makeBaseCookie("SAPISID", "sapisid-test"),
    makeBaseCookie("SIDCC", "sidcc-test"),
    makeBaseCookie("__Secure-3PSID", "3psid-test"),
  ];
}

function makeFullJar(psidValue = "psid-test-value"): Cookie[] {
  return [makePsid(psidValue), makePsidts(), ...makeCompanions()];
}

function makeTrimmedJar(): Cookie[] {
  return [makePsid(), makePsidts()];
}

describe("Phase 0 regression net", () => {
  describe("Full jar round-trip", () => {
    test("ensureAuthenticated succeeds when the jar is complete", async () => {
      const { profileAuthManager, teardown } = buildFullStack({
        profileName: "roundtrip",
        seedCookies: makeFullJar(),
      });

      const cookies = await profileAuthManager.ensureAuthenticated("roundtrip");

      expect(cookies.secure_1psid).toBe("psid-test-value");
      expect(cookies.secure_1psidts).toBe("psidts-test-value");

      teardown();
    });

    test("listChats returns at least one chat when companions are present", async () => {
      const { profileAuthManager, geminiClient, teardown } = buildFullStack({
        profileName: "roundtrip",
        seedCookies: makeFullJar(),
      });

      await profileAuthManager.ensureAuthenticated("roundtrip");

      const chats = await geminiClient.listChats();
      expect(chats.length).toBeGreaterThanOrEqual(1);
      expect(chats[0].id).toBe("chat-001");

      teardown();
    });

    test("full round-trip: ensureAuthenticated → listChats → sendMessage → fetchChat", async () => {
      const { profileAuthManager, geminiClient, teardown } = buildFullStack({
        profileName: "roundtrip",
        seedCookies: makeFullJar(),
      });

      const cookies = await profileAuthManager.ensureAuthenticated("roundtrip");
      expect(cookies.secure_1psid).toBe("psid-test-value");

      const chats = await geminiClient.listChats();
      expect(chats.length).toBe(1);

      const response = await geminiClient.sendMessage("chat-001", "Hello");
      expect(response).toBe("Hello from the regression net");

      teardown();
    });
  });

  describe("Phantom-auth detection", () => {
    test("trimmed jar: models succeeds but listChats returns empty", async () => {
      const { profileAuthManager, geminiClient, teardown } = buildFullStack({
        profileName: "phantom",
        seedCookies: makeTrimmedJar(),
      });

      const cookies = await profileAuthManager.ensureAuthenticated("phantom");
      expect(cookies.secure_1psid).toBe("psid-test-value");

      expect(geminiClient._modelsFn).toHaveBeenCalled();

      const chats = await geminiClient.listChats();
      expect(chats.length).toBe(0);

      teardown();
    });

    test("trimmed jar: ensureAuthenticated reports valid but jar lacks companions", async () => {
      const { profileAuthManager, cookieStorageService, teardown } = buildFullStack({
        profileName: "phantom",
        seedCookies: makeTrimmedJar(),
      });

      const cookies = await profileAuthManager.ensureAuthenticated("phantom");
      expect(cookies.secure_1psid).toBe("psid-test-value");

      const all = cookieStorageService.loadAllCookiesForProfile("phantom");
      const companionCount = all.filter((c) => !["__Secure-1PSID", "__Secure-1PSIDTS"].includes(c.name)).length;
      expect(companionCount).toBe(0);

      teardown();
    });
  });

  describe("Profile routing", () => {
    test("ensureAuthenticated for a named profile returns that profile's cookies", async () => {
      const fixtureA = buildFullStack({
        profileName: "alpha",
        seedCookies: makeFullJar("alpha-psid"),
      });

      const cookiesA = await fixtureA.profileAuthManager.ensureAuthenticated("alpha");
      expect(cookiesA.secure_1psid).toBe("alpha-psid");

      const fixtureB = buildFullStack({
        profileName: "beta",
        seedCookies: makeFullJar("beta-psid"),
      });

      const cookiesB = await fixtureB.profileAuthManager.ensureAuthenticated("beta");
      expect(cookiesB.secure_1psid).toBe("beta-psid");

      expect(cookiesA.secure_1psid).not.toBe(cookiesB.secure_1psid);

      fixtureA.teardown();
      fixtureB.teardown();
    });

    test("ensureAuthenticated for profile A loads cookies from profile A's jar, not default", async () => {
      const { profileManager, cookieStorage, profileAuthManager, teardown } = buildFullStack({
        profileName: "default",
        seedCookies: makeFullJar("default-psid"),
      });

      profileManager.create("work");
      cookieStorage.save("work", makeFullJar("work-psid"));

      const defaultCookies = await profileAuthManager.ensureAuthenticated("default");
      expect(defaultCookies.secure_1psid).toBe("default-psid");

      const workCookies = await profileAuthManager.ensureAuthenticated("work");
      expect(workCookies.secure_1psid).toBe("work-psid");

      teardown();
    });
  });

  describe("Jar completeness after ensureAuthenticated", () => {
    test("full jar: all companions preserved after ensureAuthenticated", async () => {
      const { profileAuthManager, cookieStorageService, teardown } = buildFullStack({
        profileName: "complete",
        seedCookies: makeFullJar(),
      });

      await profileAuthManager.ensureAuthenticated("complete");

      const all = cookieStorageService.loadAllCookiesForProfile("complete");
      const names = new Set(all.map((c) => c.name));

      expect(names.has("__Secure-1PSID")).toBe(true);
      expect(names.has("__Secure-1PSIDTS")).toBe(true);
      expect(names.has("SID")).toBe(true);
      expect(names.has("HSID")).toBe(true);
      expect(names.has("SSID")).toBe(true);

      teardown();
    });
  });

  describe("Conversation threading", () => {
    test("sendMessage(cid) returns a response for the given conversation id", async () => {
      const { profileAuthManager, geminiClient, teardown } = buildFullStack({
        profileName: "threading",
        seedCookies: makeFullJar(),
      });

      await profileAuthManager.ensureAuthenticated("threading");

      const response = await geminiClient.sendMessage("existing-cid", "Continue this");
      expect(response).toBe("Hello from the regression net");
      expect(typeof response).toBe("string");

      teardown();
    });

    test("startNewChat returns a conversation id for the new chat", async () => {
      const { profileAuthManager, geminiClient, teardown } = buildFullStack({
        profileName: "newchat",
        seedCookies: makeFullJar(),
      });

      await profileAuthManager.ensureAuthenticated("newchat");

      const result = await geminiClient.startNewChat("Hello world");
      expect(result.response).toBe("Hello from the regression net");
      expect(result.conversationId).toBe("new-cid-001");

      teardown();
    });
  });
});
