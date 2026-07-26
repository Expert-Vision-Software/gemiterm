import type { ChatInfo, Message } from "../core/types.ts";
import type { IGeminiClientService } from "../core/command-handlers.ts";
import type { IGeminiClientQueryService } from "../core/query-handlers.ts";
import type { Logger } from "../infrastructure/logger.ts";
import type { CookieStorageService } from "./cookie-storage-service.ts";
import { GeminiAPIError, AuthenticationError } from "../core/errors.ts";

export interface GeminiClientDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Gemini: new (...args: any[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  AuthError: new (...args: any[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  APIError: new (...args: any[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  UsageLimitExceeded: new (...args: any[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ModelInvalid: new (...args: any[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TemporarilyBlocked: new (...args: any[]) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  GeminiError: new (...args: any[]) => any;
}

let _realDeps: GeminiClientDeps | undefined;
function getRealDeps(): GeminiClientDeps {
  if (!_realDeps) {
    _realDeps = require("gemini-reverse") as GeminiClientDeps;
  }
  return _realDeps!;
}

interface AxiosLikeError {
  code?: string;
  message?: string;
}

interface RawChatRow {
  cid: string;
  title: string;
  pinned: boolean;
  timestamp: number;
}

interface RawChatTurn {
  role: string;
  text: string;
}

interface RawAvailableModel {
  model_id: string;
  model_name?: string;
  display_name?: string;
}

interface GeminiClientConfig {
  secure1psid: string;
  secure1psidts?: string | null;
}

export class GeminiClientService
  implements IGeminiClientService, IGeminiClientQueryService
{
  private client: InstanceType<GeminiClientDeps["Gemini"]> | null = null;
  private initPromise: Promise<void> | null = null;
  private initialized = false;
  readonly logger: Logger;
  readonly cookieStorageService?: CookieStorageService;
  readonly profileName?: string;
  private readonly deps: GeminiClientDeps;

  constructor(config: GeminiClientConfig, logger: Logger, cookieStorageService?: CookieStorageService, profileName?: string, _deps?: GeminiClientDeps);
  constructor(config: GeminiClientConfig, logger: Logger, cookieStorageService?: CookieStorageService, profileName?: string, _deps?: "_test");
  constructor(config: GeminiClientConfig, logger: Logger, cookieStorageService?: CookieStorageService, profileName?: string, _deps?: GeminiClientDeps | "_test") {
    this.logger = logger;
    this.cookieStorageService = cookieStorageService;
    this.profileName = profileName;
    this.deps = (typeof _deps === "object" ? _deps : null) ?? getRealDeps();
    this.client = new this.deps.Gemini({ secure_1psid: config.secure1psid, timeout: 300_000, autoClose: false });
    if (config.secure1psidts) {
      this.client.cookies["__Secure-1PSIDTS"] = config.secure1psidts;
    }
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.client!.init();
    await this.initPromise;
    this.initialized = true;
  }

  private toDomainChatInfo(raw: RawChatRow, profileName?: string): ChatInfo {
    return {
      id: raw.cid,
      title: raw.title,
      isPinned: raw.pinned,
      timestamp: raw.timestamp * 1000,
      ...(profileName ? { profile: profileName } : {}),
    };
  }

  private toDomainMessages(turns: RawChatTurn[], conversationId: string): Message[] {
    return turns.map((turn) => ({
      role: turn.role === "model" ? "model" : "user",
      content: turn.text,
      conversationId,
    }));
  }

  private toDomainModelName(model: RawAvailableModel): string {
    return model.model_name || model.display_name || model.model_id;
  }

  private translateError(e: unknown): GeminiAPIError | AuthenticationError {
    if (e instanceof this.deps.AuthError) {
      return new AuthenticationError(
        "Session expired or invalid. Please run 'gemiterm login' again.",
      );
    }
    const ax = e as AxiosLikeError;
    if (ax.code === "ECONNABORTED") {
      return new GeminiAPIError("Request to Gemini timed out");
    }
    if (e instanceof this.deps.UsageLimitExceeded) {
      return new GeminiAPIError("Gemini usage limit reached; try again later or switch model");
    }
    if (e instanceof this.deps.TemporarilyBlocked) {
      return new GeminiAPIError("Temporarily blocked by Gemini; try a proxy or wait");
    }
    if (e instanceof this.deps.ModelInvalid) {
      return new GeminiAPIError("Model is invalid or unavailable");
    }
    if (e instanceof this.deps.APIError || e instanceof this.deps.GeminiError) {
      const msg = e.message;
      if (/\b(timed out|timeout|stalled)\b/i.test(msg)) {
        return new GeminiAPIError("Request to Gemini timed out");
      }
      const err = new GeminiAPIError(e.message);
      err.cause = e;
      return err;
    }
    return new GeminiAPIError("Unexpected error: " + String(e));
  }

  forProfile(profileName: string): GeminiClientService {
    if (!this.cookieStorageService) {
      throw new Error("CookieStorageService is required for forProfile");
    }
    const cookies = this.cookieStorageService.loadCookiesForProfile(profileName);
    return new GeminiClientService(
      { secure1psid: cookies.secure_1psid, secure1psidts: cookies.secure_1psidts },
      this.logger,
      this.cookieStorageService,
      profileName,
      this.deps,
    );
  }

  async profileHasConversation(profileName: string, conversationId: string): Promise<boolean> {
    try {
      const profileClient = this.forProfile(profileName);
      const chats = await profileClient.listChats();
      return chats.some((chat) => chat.id === conversationId);
    } catch {
      return false;
    }
  }

  async listChats(options?: {
    limit?: number;
    offset?: number;
    search?: string;
  }): Promise<ChatInfo[]> {
    await this.init();
    try {
      const raw = await this.client!.chats() as RawChatRow[];
      let chats: ChatInfo[] = (raw ?? []).map((c) => this.toDomainChatInfo(c, this.profileName));

      if (options?.search) {
        const query = options.search.toLowerCase();
        chats = chats.filter((c) => c.title.toLowerCase().includes(query));
      }

      chats.sort((a, b) => b.timestamp - a.timestamp);

      if (options?.offset) {
        chats = chats.slice(options.offset);
      }
      if (options?.limit) {
        chats = chats.slice(0, options.limit);
      }

      return chats;
    } catch (e) {
      const err = this.translateError(e);
      this.logger.debug(`listChats failed: ${e}`);
      throw err;
    }
  }

  async fetchChat(conversationId: string): Promise<Message[]> {
    await this.init();
    try {
      const raw = (await this.client!.readChat(conversationId)) as RawChatTurn[] | null;
      const turns = raw ?? [];
      if (turns.length === 0) return [];
      return this.toDomainMessages(turns, conversationId);
    } catch (e) {
      const err = this.translateError(e);
      this.logger.debug(`fetchChat failed: ${e}`);
      throw err;
    }
  }

  async deleteChat(conversationId: string): Promise<void> {
    await this.init();
    try {
      await this.client!.deleteChat(conversationId);
    } catch (e) {
      const err = this.translateError(e);
      this.logger.debug(`deleteChat failed: ${e}`);
      throw err;
    }
  }

  async sendMessage(conversationId: string, message: string): Promise<string> {
    await this.init();
    try {
      const session = this.client!.newChat();
      session.cid = conversationId;
      const output = await session.generateContent({ prompt: message });
      return output.text.toString();
    } catch (e) {
      const err = this.translateError(e);
      this.logger.debug(`sendMessage failed: ${e}`);
      throw err;
    }
  }

  async startNewChat(message: string): Promise<{ response: string; conversationId: string }> {
    await this.init();
    try {
      const session = this.client!.newChat();
      const output = await session.generateContent({ prompt: message });
      return {
        response: output.text.toString(),
        conversationId: session.cid,
      };
    } catch (e) {
      const err = this.translateError(e);
      this.logger.debug(`startNewChat failed: ${e}`);
      throw err;
    }
  }

  async listModels(): Promise<string[]> {
    await this.init();
    try {
      const raw = await this.client!.models();
      return (raw ?? []).map((m: RawAvailableModel) => this.toDomainModelName(m));
    } catch (e) {
      const err = this.translateError(e);
      this.logger.debug(`listModels failed: ${e}`);
      throw err;
    }
  }

  isAuthenticated(): boolean {
    return this.initialized;
  }
}
