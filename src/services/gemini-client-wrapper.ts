import type { ChatInfo, Message } from "../core/types.ts";
import type { IGeminiClientService } from "../core/command-handlers.ts";
import type { IGeminiClientQueryService } from "../core/query-handlers.ts";
import type { Logger } from "../infrastructure/logger.ts";
import type { CookieStorageService } from "./cookie-storage-service.ts";
import type { CookieJar } from "./cookie-jar.ts";
import type { ChatMetadata } from "./chat-metadata-storage.ts";
import { ChatMetadataStorage } from "./chat-metadata-storage.ts";
import { makeMetadata, threadOnto, captureFrom } from "./conversation-threading.ts";
import { GeminiAPIError, AuthenticationError, GemitermError } from "../core/errors.ts";

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
    _realDeps = require("gemini-web-sdk") as GeminiClientDeps;
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
  rid?: string;
  rcid?: string;
}

interface RawAvailableModel {
  model_id: string;
  model_name?: string;
  display_name?: string;
}

interface RawChatSession {
  cid: string;
  metadata?: (string | null)[];
  generateContent(opts: { prompt: string }): Promise<{ text: { toString(): string }; cid?: string; metadata?: (string | null)[] }>;
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
  readonly cookieJar?: CookieJar;
  readonly profileName?: string;
  private readonly deps: GeminiClientDeps;
  private readonly chatMetadata: ChatMetadataStorage;

  constructor(config: GeminiClientConfig, logger: Logger, cookieStorageService?: CookieStorageService, profileName?: string, _deps?: GeminiClientDeps, chatMetadata?: ChatMetadataStorage, cookieJar?: CookieJar);
  constructor(config: GeminiClientConfig, logger: Logger, cookieStorageService?: CookieStorageService, profileName?: string, _deps?: "_test", chatMetadata?: ChatMetadataStorage, cookieJar?: CookieJar);
  constructor(config: GeminiClientConfig, logger: Logger, cookieStorageService?: CookieStorageService, profileName?: string, _deps?: GeminiClientDeps | "_test", chatMetadata?: ChatMetadataStorage, cookieJar?: CookieJar) {
    this.logger = logger;
    this.cookieStorageService = cookieStorageService;
    this.cookieJar = cookieJar;
    this.profileName = profileName;
    this.deps = (typeof _deps === "object" ? _deps : null) ?? getRealDeps();
    this.client = new this.deps.Gemini({ secure_1psid: config.secure1psid, timeout: 300_000, autoClose: false });
    if (config.secure1psidts) {
      this.client.cookies["__Secure-1PSIDTS"] = config.secure1psidts;
    }
    this.chatMetadata = chatMetadata ?? new ChatMetadataStorage(logger);
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

  async forProfile(profileName: string): Promise<GeminiClientService> {
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
      this.chatMetadata,
      this.cookieJar,
    );
  }

  async profileHasConversation(profileName: string, conversationId: string): Promise<boolean> {
    const profileClient = await this.forProfile(profileName);
    const chats = await profileClient.listChats();
    return chats.some((chat) => chat.id === conversationId);
  }

  async listChats(options?: {
    limit?: number;
    offset?: number;
    search?: string;
  }): Promise<ChatInfo[]> {
    await this.init();
    try {
      const raw = await this.client!.chats() as RawChatRow[] | null | undefined;
      if (raw === null || raw === undefined) {
        throw new GemitermError("Gemini returned no data — session may be expired");
      }
      let chats: ChatInfo[] = raw.map((c) => this.toDomainChatInfo(c, this.profileName));

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
      if (turns.length > 0) {
        const lastModelTurn = [...turns].reverse().find((t) => t.role === "model");
        if (lastModelTurn && this.profileName) {
          const existing = this.chatMetadata.lookup(this.profileName, conversationId);
          const meta: ChatMetadata = {
            rid: lastModelTurn.rid ?? "",
            rcid: lastModelTurn.rcid ?? "",
            ctx: existing?.ctx ?? null,
          };
          this.chatMetadata.save(this.profileName, conversationId, meta);
        }
      }
      const messages = turns.length === 0 ? [] : this.toDomainMessages(turns, conversationId);

      return messages;
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

  private buildSession(conversationId: string, metadata?: (string | null)[]): RawChatSession {
    const session = this.client!.newChat();
    if (metadata) {
      session.metadata = metadata;
    } else if (conversationId) {
      session.cid = conversationId;
    }
    return session;
  }

  private async seedMetadataFromChat(conversationId: string): Promise<ChatMetadata | null> {
    try {
      const raw = (await this.client!.readChat(conversationId)) as RawChatTurn[] | null;
      const turns = raw ?? [];
      const lastModelTurn = [...turns].reverse().find((t) => t.role === "model");
      if (lastModelTurn && this.profileName) {
        const existing = this.chatMetadata.lookup(this.profileName, conversationId);
        const meta: ChatMetadata = {
          rid: lastModelTurn.rid ?? "",
          rcid: lastModelTurn.rcid ?? "",
          ctx: existing?.ctx ?? null,
        };
        this.chatMetadata.save(this.profileName, conversationId, meta);
        return meta;
      }
    } catch {
      this.logger.debug(`seedMetadataFromChat: readChat failed for cid='${conversationId}' on profile='${this.profileName}'`);
    }
    return null;
  }

  async sendMessage(conversationId: string, message: string): Promise<string> {
    await this.init();
    try {
      let session: RawChatSession;
      if (this.profileName) {
        const stored = this.chatMetadata.lookup(this.profileName, conversationId);
        const { metadata, seeded } = threadOnto(conversationId, stored);
        if (!seeded) {
          const seededMeta = await this.seedMetadataFromChat(conversationId);
          if (seededMeta) {
            session = this.buildSession(conversationId, makeMetadata(conversationId, seededMeta));
          } else {
            this.logger.debug(
              `sendMessage: no prior metadata for cid='${conversationId}' on profile='${this.profileName}'; falling back to cid-only send.`,
            );
            session = this.buildSession(conversationId);
          }
        } else {
          session = this.buildSession(conversationId, metadata);
        }
      } else {
        session = this.buildSession(conversationId);
      }
      const output = await session.generateContent({ prompt: message });
      const captured = captureFrom(output, conversationId);
      if (captured && this.profileName) {
        this.chatMetadata.save(this.profileName, conversationId, captured);
      }
      const text = output.text.toString();

      return text;
    } catch (e) {
      const err = this.translateError(e);
      this.logger.debug(`sendMessage failed: ${e}`);
      throw err;
    }
  }

  async startNewChat(message: string): Promise<{ response: string; conversationId: string }> {
    await this.init();
    try {
      const session = this.buildSession("");
      const output = await session.generateContent({ prompt: message });
      const response = output.text.toString();
      const conversationId = output.cid ?? session.cid;
      if (this.profileName) {
        const captured = captureFrom(output, conversationId);
        if (captured) {
          this.chatMetadata.save(this.profileName, conversationId, captured);
        }
      }

      return { response, conversationId };
    } catch (e) {
      const err = this.translateError(e);
      this.logger.debug(`startNewChat failed: ${e}`);
      throw err;
    }
  }

  async models(): Promise<string[]> {
    await this.init();
    try {
      const raw = await this.client!.models();
      const result = (raw ?? []).map((m: RawAvailableModel) => this.toDomainModelName(m));

      return result;
    } catch (e) {
      const err = this.translateError(e);
      this.logger.debug(`models failed: ${e}`);
      throw err;
    }
  }

  async listModels(): Promise<string[]> {
    await this.init();
    try {
      const raw = await this.client!.models();
      const models = (raw ?? []).map((m: RawAvailableModel) => this.toDomainModelName(m));

      return models;
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
