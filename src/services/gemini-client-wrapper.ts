import type { ChatInfo, Message } from "../core/types.ts";
import type { Logger } from "../infrastructure/logger.ts";
import type { CookieSession } from "./cookie-session.ts";
import { PRIMARY_COOKIE_NAME, SECONDARY_COOKIE_NAME } from "./cookie-session.ts";
import type { ChatMetadata } from "./chat-metadata-storage.ts";
import { ChatMetadataStorage } from "./chat-metadata-storage.ts";
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

function extractChatMetadata(metadata: (string | null)[] | undefined): ChatMetadata | null {
  if (!metadata) return null;
  const rid = metadata[1];
  const rcid = metadata[2];
  if (!rid && !rcid) return null;
  const ctx = metadata[9];
  return { rid: rid ?? "", rcid: rcid ?? "", ctx: ctx === "" ? null : (ctx ?? null) };
}

export class GeminiClientService {
  private client: InstanceType<GeminiClientDeps["Gemini"]> | null = null;
  private initPromise: Promise<void> | null = null;
  private initialized = false;
  readonly logger: Logger;
  readonly session?: CookieSession;
  readonly profileName?: string;
  private readonly deps: GeminiClientDeps;
  private baselineSecure1psid: string;
  private baselineSecure1psidts: string | null;
  private readonly chatMetadata: ChatMetadataStorage;

  constructor(config: GeminiClientConfig, logger: Logger, session?: CookieSession, profileName?: string, _deps?: GeminiClientDeps, chatMetadata?: ChatMetadataStorage);
  constructor(config: GeminiClientConfig, logger: Logger, session?: CookieSession, profileName?: string, _deps?: "_test", chatMetadata?: ChatMetadataStorage);
  constructor(config: GeminiClientConfig, logger: Logger, session?: CookieSession, profileName?: string, _deps?: GeminiClientDeps | "_test", chatMetadata?: ChatMetadataStorage) {
    this.logger = logger;
    this.session = session;
    this.profileName = profileName;
    this.deps = (typeof _deps === "object" ? _deps : null) ?? getRealDeps();
    this.client = new this.deps.Gemini({ secure_1psid: config.secure1psid, timeout: 300_000, autoClose: false });
    if (config.secure1psidts) {
      this.client.cookies[SECONDARY_COOKIE_NAME] = config.secure1psidts;
    }
    this.baselineSecure1psid = config.secure1psid;
    this.baselineSecure1psidts = config.secure1psidts ?? null;
    this.chatMetadata = chatMetadata ?? new ChatMetadataStorage(logger);
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.client!.init();
    await this.initPromise;
    this.initialized = true;
    this.persistRefreshedCookies();
  }

  private persistRefreshedCookies(): void {
    try {
      if (!this.session || !this.profileName || !this.client) return;
      const jar = this.client.cookies as Record<string, string>;
      const live1psid = jar[PRIMARY_COOKIE_NAME];
      const live1psidts = jar[SECONDARY_COOKIE_NAME];
      const changed1psid = typeof live1psid === "string" && live1psid !== "" && live1psid !== this.baselineSecure1psid;
      const changed1psidts = typeof live1psidts === "string" && live1psidts !== "" && live1psidts !== this.baselineSecure1psidts;
      if (!changed1psid && !changed1psidts) return;

      this.session.commit(this.profileName, { jar });
      if (changed1psid) this.baselineSecure1psid = live1psid;
      if (changed1psidts) this.baselineSecure1psidts = live1psidts;
      this.logger.debug(`Persisted refreshed cookies for profile '${this.profileName}'`);
    } catch (e) {
      this.logger.debug(`persistRefreshedCookies failed: ${e}`);
    }
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
    if (!this.session) {
      throw new Error("CookieSession is required for forProfile");
    }
    const status = this.session.sessionStatus(profileName);
    if (!status.loaded) {
      throw new Error(
        `No storage state found for profile '${profileName}'. Run 'gemiterm auth' to authenticate.`,
      );
    }
    if (!status.hasPrimary) {
      throw new Error(
        `Missing required cookie ${PRIMARY_COOKIE_NAME} for profile '${profileName}'. Run 'gemiterm auth' to re-authenticate.`,
      );
    }
    return new GeminiClientService(
      { secure1psid: status.secure1psid!, secure1psidts: status.secure1psidts },
      this.logger,
      this.session,
      profileName,
      this.deps,
      this.chatMetadata,
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

      this.persistRefreshedCookies();
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
        if (lastModelTurn?.rid && this.profileName) {
          this.chatMetadata.save(this.profileName, conversationId, {
            rid: lastModelTurn.rid,
            rcid: lastModelTurn.rcid ?? "",
            ctx: null,
          });
        }
      }
      const messages = turns.length === 0 ? [] : this.toDomainMessages(turns, conversationId);
      this.persistRefreshedCookies();
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
      this.persistRefreshedCookies();
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

  async sendMessage(conversationId: string, message: string): Promise<string> {
    await this.init();
    try {
      let session: RawChatSession;
      if (this.profileName) {
        const stored = this.chatMetadata.lookup(this.profileName, conversationId);
        if (stored) {
          session = this.buildSession(conversationId, [
            conversationId, stored.rid, stored.rcid, null, null, null, null, null, null,
            stored.ctx ?? "",
          ]);
        } else {
          this.logger.debug(
            `sendMessage: no prior metadata for cid='${conversationId}' on profile='${this.profileName}'; falling back to cid-only send.`,
          );
          session = this.buildSession(conversationId);
        }
      } else {
        session = this.buildSession(conversationId);
      }
      const output = await session.generateContent({ prompt: message });
      const captured = extractChatMetadata(output.metadata);
      if (captured && this.profileName) {
        this.chatMetadata.save(this.profileName, conversationId, captured);
      }
      const text = output.text.toString();
      this.persistRefreshedCookies();
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
        const captured = extractChatMetadata(output.metadata);
        if (captured) {
          this.chatMetadata.save(this.profileName, conversationId, captured);
        }
      }
      this.persistRefreshedCookies();
      return { response, conversationId };
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
      const models = (raw ?? []).map((m: RawAvailableModel) => this.toDomainModelName(m));
      this.persistRefreshedCookies();
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
