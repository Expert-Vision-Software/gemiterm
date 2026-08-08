import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mock } from "bun:test";
import { ProfileAuthManager } from "../../src/services/profile-auth-manager.ts";
import { ProfileManager, CookieStorage } from "../../src/infrastructure/storage.ts";
import { CookieStorageService } from "../../src/services/cookie-storage-service.ts";
import { Logger } from "../../src/infrastructure/logger.ts";
import type { Cookie, ChatInfo } from "../../src/core/types.ts";
import type { IGeminiClientService } from "../../src/core/command-handlers.ts";

const COMPANION_NAMES = new Set([
  "SID", "HSID", "SSID", "APISID", "SAPISID",
  "SIDCC", "__Secure-3PSID", "NID",
]);

export interface FullStackOptions {
  profileName?: string;
  seedCookies?: Cookie[];
  logger?: Logger;
}

export interface CookieAwareFake extends IGeminiClientService {
  _modelsFn: ReturnType<typeof mock>;
  _listChatsFn: ReturnType<typeof mock>;
}

export interface FullStackFixture {
  profileName: string;
  profileManager: ProfileManager;
  cookieStorageService: CookieStorageService;
  profileAuthManager: ProfileAuthManager;
  cookieStorage: CookieStorage;
  silentRefreshSpy: ReturnType<typeof mock>;
  geminiClient: CookieAwareFake;
  teardown: () => void;
}

function hasCompanions(cookies: Cookie[]): boolean {
  return cookies.some((c) => COMPANION_NAMES.has(c.name));
}

function makeFakeChat(profileName: string): ChatInfo {
  return {
    id: "chat-001",
    title: "Test Conversation",
    isPinned: false,
    timestamp: Date.now(),
    profile: profileName,
  };
}

export function buildFullStack(options: FullStackOptions = {}): FullStackFixture {
  const testDir = join(tmpdir(), `gemiterm-phase0-${Math.random().toString(36).slice(2, 10)}`);
  mkdirSync(testDir, { recursive: true });
  process.env.GEMITERM_CONFIG_DIR = testDir;

  const logger = options.logger ?? new Logger("phase0-fixture");
  const cookieStorage = new CookieStorage();
  const profileManager = new ProfileManager(cookieStorage);
  const profileName = options.profileName ?? "default";

  profileManager.create(profileName);

  if (options.seedCookies && options.seedCookies.length > 0) {
    cookieStorage.save(profileName, options.seedCookies);
  }

  const cookieStorageService = new CookieStorageService({ cookieStorage, logger });

  const modelsFn = mock(async (): Promise<string[]> => ["gemini-2.5-flash"]);
  const silentRefreshSpy = mock(async (_name: string): Promise<boolean> => true);

  const fake: CookieAwareFake = {
    _modelsFn: modelsFn,
    _listChatsFn: mock(async (): Promise<ChatInfo[]> => {
      const all = cookieStorageService.loadAllCookiesForProfile(profileName);
      if (!hasCompanions(all)) return [];
      return [makeFakeChat(profileName)];
    }),
    models: modelsFn as unknown as IGeminiClientService["models"],
    async listChats(opts?: { limit?: number; offset?: number; search?: string }): Promise<ChatInfo[]> {
      return fake._listChatsFn(opts) as unknown as Promise<ChatInfo[]>;
    },
    async deleteChat(_conversationId: string): Promise<void> {},
    async sendMessage(_conversationId: string, _message: string): Promise<string> {
      return "Hello from the regression net";
    },
    async startNewChat(_message: string): Promise<{ response: string; conversationId: string }> {
      return { response: "Hello from the regression net", conversationId: "new-cid-001" };
    },
    async profileHasConversation(_profileName: string, _conversationId: string): Promise<boolean> {
      return true;
    },
    forProfile(_name: string): IGeminiClientService {
      return fake as unknown as IGeminiClientService;
    },
  };

  const profileAuthManager = new ProfileAuthManager({
    profileManager,
    cookieStorageService,
    logger,
    geminiClient: fake as unknown as IGeminiClientService,
    silentRefresh: silentRefreshSpy,
  });

  return {
    profileName,
    profileManager,
    cookieStorageService,
    profileAuthManager,
    cookieStorage,
    silentRefreshSpy,
    geminiClient: fake,
    teardown: () => {
      rmSync(testDir, { recursive: true, force: true });
      delete process.env.GEMITERM_CONFIG_DIR;
    },
  };
}
