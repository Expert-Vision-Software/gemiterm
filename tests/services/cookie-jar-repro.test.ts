import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProfileAuthManager } from "../../src/services/profile-auth-manager.ts";
import { ProfileManager, CookieStorage } from "../../src/infrastructure/storage.ts";
import { CookieStorageService } from "../../src/services/cookie-storage-service.ts";
import { Logger } from "../../src/infrastructure/logger.ts";
import type { Cookie } from "../../src/core/types.ts";
import type { IGeminiClientService } from "../../src/core/command-handlers.ts";

const TEST_DIR = join(tmpdir(), "gemiterm-test-cookie-jar-repro");
const logger = new Logger("test");
const PROFILE = "default";

function farFuture(): number {
  return Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
}

function cookie(name: string, domain: string, value = `redacted-${name.toLowerCase()}`): Cookie {
  return {
    name,
    value,
    domain,
    path: "/",
    expires: farFuture(),
    httpOnly: true,
    secure: true,
    sameSite: "Lax" as const,
  };
}

function makeDegradedJar(): Cookie[] {
  return [
    cookie("__Secure-1PSID", ".google.com"),
    cookie("__Secure-1PSIDTS", ".google.com"),
    cookie("__Secure-1PSID", ".youtube.com"),
    cookie("__Secure-1PSIDTS", ".youtube.com"),
  ];
}

function makeFullJar(): Cookie[] {
  return [
    cookie("__Secure-1PSID", ".google.com"),
    cookie("__Secure-1PSIDTS", ".google.com"),
    cookie("__Secure-3PSID", ".google.com"),
    cookie("__Secure-3PSIDTS", ".google.com"),
    cookie("SID", ".google.com"),
    cookie("HSID", ".google.com"),
    cookie("SSID", ".google.com"),
    cookie("APISID", ".google.com"),
    cookie("SAPISID", ".google.com"),
    cookie("SIDCC", ".google.com"),
    cookie("NID", ".google.com"),
    cookie("__Secure-1PSID", ".youtube.com"),
  ];
}

const COMPANION_COOKIES = ["SID", "HSID", "SSID"];
const SAMPLE_CHATS = [
  { id: "c_repro_1", title: "repro chat one", isPinned: false, timestamp: Date.now() },
  { id: "c_repro_2", title: "repro chat two", isPinned: true, timestamp: Date.now() },
];

function jarHasCompanions(jar: Cookie[]): boolean {
  const names = new Set(jar.map((c) => c.name));
  return COMPANION_COOKIES.every((n) => names.has(n));
}

function makeCookieAwareClient(storage: CookieStorage, profileName: string): IGeminiClientService {
  const client = {
    models: mock(async () => ["gemini-2.5-flash"]),
    listChats: mock(async () =>
      jarHasCompanions(storage.load(profileName)) ? SAMPLE_CHATS : [],
    ),
    deleteChat: mock(async () => {}),
    sendMessage: mock(async () => ""),
    startNewChat: mock(async () => ({ response: "", conversationId: "" })),
    profileHasConversation: mock(async () => false),
    async forProfile() {
      return client;
    },
  };
  return client as unknown as IGeminiClientService;
}

function buildManager(
  storage: CookieStorage,
  profileManager: ProfileManager,
  client: IGeminiClientService,
): ProfileAuthManager {
  const cookieStorageService = new CookieStorageService({ cookieStorage: storage, logger });
  return new ProfileAuthManager({
    profileManager,
    cookieStorageService,
    logger,
    geminiClient: client,
    silentRefresh: mock(async () => false),
  });
}

beforeEach(() => {
  process.env.GEMITERM_CONFIG_DIR = TEST_DIR;
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.GEMITERM_CONFIG_DIR;
});

describe("cookie-jar repro harness — 4-cookie degradation symptom", () => {
  test("degraded 4-cookie jar is deemed authenticated yet listChats returns empty", async () => {
    const storage = new CookieStorage();
    const profileManager = new ProfileManager(storage);
    profileManager.create(PROFILE);
    storage.save(PROFILE, makeDegradedJar());

    const client = makeCookieAwareClient(storage, PROFILE);
    const mgr = buildManager(storage, profileManager, client);

    const cookies = await mgr.ensureAuthenticated(PROFILE);

    expect(cookies.secure_1psid).toBeTruthy();
    expect(storage.load(PROFILE)).toHaveLength(4);

    const chats = await client.listChats();
    expect(chats).toEqual([]);
  });

  test("PSIDTS-only refresh via inline merge cannot restore listChats", async () => {
    const storage = new CookieStorage();
    const profileManager = new ProfileManager(storage);
    profileManager.create(PROFILE);
    const degraded = makeDegradedJar();
    storage.save(PROFILE, degraded);

    const client = makeCookieAwareClient(storage, PROFILE);

    expect(await client.listChats()).toEqual([]);

    const polledPsidtsOnly = degraded
      .filter((c) => c.name === "__Secure-1PSIDTS")
      .map((c) => ({ ...c, value: "redacted-refreshed-psidts" }));
    const merged = degraded.map((c) => {
      const match = polledPsidtsOnly.find((pc) => pc.name === c.name && pc.domain === c.domain && pc.path === c.path);
      return match ? { ...c, value: match.value } : c;
    });
    storage.save(PROFILE, merged);

    expect(merged).toHaveLength(4);
    expect(await client.listChats()).toEqual([]);
  });

  test("full 12-cookie jar returns chats (known-good contrast)", async () => {
    const storage = new CookieStorage();
    const profileManager = new ProfileManager(storage);
    profileManager.create(PROFILE);
    storage.save(PROFILE, makeFullJar());

    const client = makeCookieAwareClient(storage, PROFILE);
    const mgr = buildManager(storage, profileManager, client);

    await mgr.ensureAuthenticated(PROFILE);

    const chats = await client.listChats();
    expect(chats).toHaveLength(SAMPLE_CHATS.length);
  });
});
