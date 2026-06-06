import type { ChatInfo, Message } from "../core/types.ts";
import type { IGeminiClientService } from "../core/command-handlers.ts";
import type { IGeminiClientQueryService } from "../core/query-handlers.ts";
import type { Logger } from "../infrastructure/logger.ts";
import { GeminiAPIError, AuthenticationError } from "../core/errors.ts";

const GEMINI_BASE_URL = "https://gemini.google.com";

interface GeminiClientConfig {
  secure1psid: string;
  secure1psidts?: string | null;
}

export class GeminiClientService
  implements IGeminiClientService, IGeminiClientQueryService
{
  private readonly logger: Logger;
  private readonly config: GeminiClientConfig;
  private authenticated = false;

  constructor(config: GeminiClientConfig, logger: Logger) {
    this.config = config;
    this.logger = logger;
    this.authenticated = !!config.secure1psid;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    };

    if (this.config.secure1psid) {
      headers["Cookie"] = this.buildCookieHeader();
    }

    return headers;
  }

  private buildCookieHeader(): string {
    const parts: string[] = [
      `__Secure-1PSID=${this.config.secure1psid}`,
    ];
    if (this.config.secure1psidts) {
      parts.push(`__Secure-1PSIDTS=${this.config.secure1psidts}`);
    }
    return parts.join("; ");
  }

  private ensureAuthenticated(): void {
    if (!this.authenticated || !this.config.secure1psid) {
      throw new AuthenticationError();
    }
  }

  private async requestApi(
    endpoint: string,
    options?: RequestInit,
  ): Promise<Response> {
    this.ensureAuthenticated();
    const url = `${GEMINI_BASE_URL}${endpoint}`;
    const headers = this.buildHeaders();

    this.logger.debug(`API request: ${options?.method ?? "GET"} ${url}`);

    const response = await fetch(url, {
      ...options,
      headers: {
        ...headers,
        ...(options?.headers as Record<string, string> | undefined),
      },
    });

    if (response.status === 401 || response.status === 403) {
      this.authenticated = false;
      throw new AuthenticationError(
        "Session expired or invalid. Please run 'gemiterm login' again.",
      );
    }

    if (!response.ok) {
      throw new GeminiAPIError(
        `Gemini API returned ${response.status}: ${response.statusText}`,
      );
    }

    return response;
  }

  async listChats(options?: {
    limit?: number;
    offset?: number;
    search?: string;
  }): Promise<ChatInfo[]> {
    try {
      const response = await this.requestApi("/app/api/chat/history");

      const data = await response.json() as {
        chats?: Array<{
          cid: string;
          title: string;
          is_pinned?: boolean;
          timestamp?: number;
        }>;
      };

      let chats: ChatInfo[] = [];

      if (data.chats) {
        chats = data.chats.map((chat) => ({
          id: chat.cid,
          title: chat.title ?? "Untitled",
          isPinned: chat.is_pinned ?? false,
          timestamp: chat.timestamp ?? 0,
        }));
      }

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
    } catch (error) {
      if (error instanceof GeminiAPIError || error instanceof AuthenticationError) {
        throw error;
      }
      this.logger.debug(`listChats failed: ${error}`);
      throw new GeminiAPIError(`Failed to list chats: ${error}`);
    }
  }

  async fetchChat(conversationId: string): Promise<Message[]> {
    try {
      const response = await this.requestApi(
        `/app/api/chat/history/${encodeURIComponent(conversationId)}`,
      );

      const data = await response.json() as {
        turns?: Array<{
          role: string;
          text?: string;
          parts?: Array<{ text?: string }>;
        }>;
      };

      const messages: Message[] = [];

      if (data.turns) {
        for (const turn of data.turns) {
          const content =
            turn.text ??
            turn.parts?.map((p) => p.text ?? "").join("") ??
            "";
          messages.push({
            role: turn.role === "user" ? "user" : "model",
            content,
            conversationId,
          });
        }
      }

      return messages;
    } catch (error) {
      if (error instanceof GeminiAPIError || error instanceof AuthenticationError) {
        throw error;
      }
      this.logger.debug(`fetchChat failed: ${error}`);
      throw new GeminiAPIError(`Failed to fetch chat: ${error}`);
    }
  }

  async deleteChat(conversationId: string): Promise<void> {
    try {
      await this.requestApi(
        `/app/api/chat/history/${encodeURIComponent(conversationId)}`,
        { method: "DELETE" },
      );
    } catch (error) {
      if (error instanceof GeminiAPIError || error instanceof AuthenticationError) {
        throw error;
      }
      this.logger.debug(`deleteChat failed: ${error}`);
      throw new GeminiAPIError(`Failed to delete chat: ${error}`);
    }
  }

  async sendMessage(conversationId: string, message: string): Promise<string> {
    try {
      const response = await this.requestApi(
        `/app/api/chat/${encodeURIComponent(conversationId)}/send`,
        {
          method: "POST",
          body: new URLSearchParams({ message }).toString(),
        },
      );

      const data = await response.json() as {
        response?: string;
        text?: string;
      };

      return data.response ?? data.text ?? "";
    } catch (error) {
      if (error instanceof GeminiAPIError || error instanceof AuthenticationError) {
        throw error;
      }
      this.logger.debug(`sendMessage failed: ${error}`);
      throw new GeminiAPIError(`Failed to send message: ${error}`);
    }
  }

  async startNewChat(
    message: string,
  ): Promise<{ response: string; conversationId: string }> {
    try {
      const response = await this.requestApi("/app/api/chat/new", {
        method: "POST",
        body: new URLSearchParams({ message }).toString(),
      });

      const data = await response.json() as {
        response?: string;
        text?: string;
        cid?: string;
        conversation_id?: string;
      };

      const conversationId = data.cid ?? data.conversation_id ?? "";
      const responseText = data.response ?? data.text ?? "";

      return { response: responseText, conversationId };
    } catch (error) {
      if (error instanceof GeminiAPIError || error instanceof AuthenticationError) {
        throw error;
      }
      this.logger.debug(`startNewChat failed: ${error}`);
      throw new GeminiAPIError(`Failed to start new chat: ${error}`);
    }
  }

  async listModels(): Promise<string[]> {
    try {
      const response = await this.requestApi("/app/api/models");

      const data = await response.json() as {
        models?: Array<{ name: string; display_name?: string }>;
      };

      if (!data.models) return [];

      return data.models.map((m) => m.display_name ?? m.name);
    } catch (error) {
      if (error instanceof GeminiAPIError || error instanceof AuthenticationError) {
        throw error;
      }
      this.logger.debug(`listModels failed: ${error}`);
      throw new GeminiAPIError(`Failed to list models: ${error}`);
    }
  }

  isAuthenticated(): boolean {
    return this.authenticated;
  }
}
