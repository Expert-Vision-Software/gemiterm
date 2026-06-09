import {
  type ChatInfo as RawChatInfo,
  type ChatHistory,
  type ChatSession,
  type AvailableModel as RawAvailableModel,
  type InitOptions,
  type StartChatOptions,
  type SendMessageOptions,
  GeminiClient,
  AuthError,
  APIError,
  TimeoutError,
  UsageLimitExceeded,
  ModelInvalid,
  TemporarilyBlocked,
  GeminiError,
} from "gemini-reverse";
import type { ChatInfo, Message } from "../core/types.ts";
import type { IGeminiClientService } from "../core/command-handlers.ts";
import type { IGeminiClientQueryService } from "../core/query-handlers.ts";
import type { Logger } from "../infrastructure/logger.ts";
import type { CookieStorageService } from "./cookie-storage-service.ts";
import { GeminiAPIError, AuthenticationError } from "../core/errors.ts";

interface GeminiClientConfig {
  secure1psid: string;
  secure1psidts?: string | null;
}

export class GeminiClientService
  implements IGeminiClientService, IGeminiClientQueryService
{
  private client: GeminiClient | null = null;
  private initPromise: Promise<void> | null = null;
  private initialized = false;
  readonly logger: Logger;
  readonly cookieStorageService?: CookieStorageService;
  readonly profileName?: string;

  constructor(config: GeminiClientConfig, logger: Logger, cookieStorageService?: CookieStorageService, profileName?: string) {
    this.logger = logger;
    this.cookieStorageService = cookieStorageService;
    this.profileName = profileName;
    this.client = new GeminiClient({
      secure_1psid: config.secure1psid,
      secure_1psidts: config.secure1psidts ?? null,
    });
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.client!.init({
      timeout: 300_000,
      autoClose: false,
      autoRefresh: true,
      refreshInterval: 540_000,
    });
    await this.initPromise;
    this.initialized = true;
  }

  private toDomainChatInfo(raw: RawChatInfo, profileName?: string): ChatInfo {
    return {
      id: raw.cid,
      title: raw.title,
      isPinned: raw.is_pinned,
      timestamp: raw.timestamp,
      ...(profileName ? { profile: profileName } : {}),
    };
  }

  private toDomainMessages(history: ChatHistory, conversationId: string): Message[] {
    return history.turns.map((turn) => ({
      role: turn.role,
      content: turn.text,
      conversationId,
    }));
  }

  private toDomainModelName(model: RawAvailableModel): string {
    return model.display_name || model.model_name || model.model_id;
  }

  private translateError(e: unknown): GeminiAPIError | AuthenticationError {
    if (e instanceof AuthError) {
      return new AuthenticationError(
        "Session expired or invalid. Please run 'gemiterm login' again.",
      );
    }
    if (e instanceof TimeoutError) {
      return new GeminiAPIError("Request to Gemini timed out");
    }
    if (e instanceof UsageLimitExceeded) {
      return new GeminiAPIError("Gemini usage limit reached; try again later or switch model");
    }
    if (e instanceof TemporarilyBlocked) {
      return new GeminiAPIError("Temporarily blocked by Gemini; try a proxy or wait");
    }
    if (e instanceof ModelInvalid) {
      return new GeminiAPIError("Model is invalid or unavailable");
    }
    if (e instanceof APIError) {
      const err = new GeminiAPIError(e.message);
      err.cause = e;
      return err;
    }
    if (e instanceof GeminiError) {
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
      const raw = this.client!.listChats();
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
      const history = await this.client!.readChat(conversationId);
      if (!history) return [];
      return this.toDomainMessages(history, conversationId);
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
      const session = this.client!.startChat({ cid: conversationId });
      const output = await session.sendMessage({ prompt: message });
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
      const session = this.client!.startChat();
      const output = await session.sendMessage({ prompt: message });
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
      const raw = this.client!.listModels();
      return (raw ?? []).map((m) => this.toDomainModelName(m));
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