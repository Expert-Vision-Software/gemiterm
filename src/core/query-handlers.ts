import type { Query, QueryHandler } from "./mediator.ts";
import type { ChatInfo, Message, ProfileStatus } from "./types.ts";
import type { IGeminiClientService } from "./command-handlers.ts";
import type { Logger } from "../infrastructure/logger.ts";

function extractPayload<T>(query: Query<T>): T {
  return query.payload;
}

export interface ListChatsQueryPayload {
  limit?: number;
  offset?: number;
  search?: string;
  allProfiles?: boolean;
  profile?: string;
}

export interface ListChatsQueryResult {
  chats: ChatInfo[];
}

export interface FetchChatQueryPayload {
  conversationId: string;
  profileName?: string;
}

export interface FetchChatQueryResult {
  messages: Message[];
}

export interface GetProfileStatusesQueryPayload {}

export interface GetProfileStatusesQueryResult {
  statuses: ProfileStatus[];
}

export interface GetAuthStatusQueryPayload {}

export interface GetAuthStatusQueryResult {
  authenticated: boolean;
  profileName: string | null;
}

export interface ListModelsQueryPayload {}

export interface ListModelsQueryResult {
  models: string[];
}

export type ProbeResult = "live" | "phantom" | "dead";

export interface ProbeProfileQueryPayload {
  profileName: string;
}

export interface ProbeProfileQueryResult {
  result: ProbeResult;
  chatsCount: number;
  modelsCount: number;
  error?: string;
}

export const QUERY_TYPES = {
  LIST_CHATS: "list-chats",
  FETCH_CHAT: "fetch-chat",
  GET_PROFILE_STATUSES: "get-profile-statuses",
  GET_AUTH_STATUS: "get-auth-status",
  LIST_MODELS: "list-models",
  PROBE_PROFILE: "probe-profile",
} as const;

export type QueryType = (typeof QUERY_TYPES)[keyof typeof QUERY_TYPES];

export interface IGeminiClientQueryService {
  listChats(options?: { limit?: number; offset?: number; search?: string }): Promise<ChatInfo[]>;
  fetchChat(conversationId: string): Promise<Message[]>;
  listModels(): Promise<string[]>;
  forProfile(profileName: string): Promise<IGeminiClientQueryService>;
}

export interface IProfileQueryService {
  getProfileStatuses(): Promise<ProfileStatus[]>;
  getAuthStatus(): Promise<{ authenticated: boolean; profileName: string | null }>;
}

export interface ProfileManagerForQuery {
  hasStoredCookies(name: string): boolean;
  list(): string[];
}

export class ListChatsQueryHandler
  implements QueryHandler<ListChatsQueryPayload, ListChatsQueryResult>
{
  readonly queryType = QUERY_TYPES.LIST_CHATS;
  private readonly getGeminiClient: (profileName?: string) => Promise<IGeminiClientService>;
  private readonly profileManager: ProfileManagerForQuery;
  private readonly logger: Logger;

  constructor(getGeminiClient: (profileName?: string) => Promise<IGeminiClientService>, profileManager: ProfileManagerForQuery, logger: Logger) {
    this.getGeminiClient = getGeminiClient;
    this.profileManager = profileManager;
    this.logger = logger;
  }

  async handle(query: Query<ListChatsQueryPayload>): Promise<ListChatsQueryResult> {
    const { limit, offset, search, allProfiles, profile } = extractPayload(query);
    const options = { limit, offset, search };
    const client = await this.getGeminiClient(profile);

    let chats: ChatInfo[];
    if (profile) {
      chats = await (await client.forProfile(profile)).listChats(options);
    } else if (allProfiles) {
      const allProfilesList = this.profileManager.list();
      const authenticated = allProfilesList.filter((name) => {
        const stored = this.profileManager.hasStoredCookies(name);
        if (!stored) {
          this.logger.warn(`Skipping unauthenticated profile '${name}'`);
        }
        return stored;
      });

      if (authenticated.length === 0) {
        chats = [];
      } else {
        const results = await Promise.allSettled(
          authenticated.map(async (name) =>
            (await client.forProfile(name)).listChats(options),
          ),
        );
        chats = [];
        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          if (result.status === "fulfilled") {
            chats.push(...result.value);
          } else {
            const err = result.reason instanceof Error ? result.reason : new Error(String(result.reason));
            this.logger.warn(`Failed to list chats for profile '${authenticated[i]}': ${err.message}`);
          }
        }
        chats.sort((a, b) => b.timestamp - a.timestamp);
      }
    } else {
      chats = await client.listChats(options);
    }
    return { chats };
  }
}

export class FetchChatQueryHandler
  implements QueryHandler<FetchChatQueryPayload, FetchChatQueryResult>
{
  readonly queryType = QUERY_TYPES.FETCH_CHAT;
  private readonly geminiClient: IGeminiClientQueryService;

  constructor(geminiClient: IGeminiClientQueryService) {
    this.geminiClient = geminiClient;
  }

  async handle(query: Query<FetchChatQueryPayload>): Promise<FetchChatQueryResult> {
    const { conversationId, profileName } = extractPayload(query);
    const client = profileName ? await this.geminiClient.forProfile(profileName) : this.geminiClient;
    const messages = await client.fetchChat(conversationId);
    return { messages };
  }
}

export class GetProfileStatusesQueryHandler
  implements QueryHandler<GetProfileStatusesQueryPayload, GetProfileStatusesQueryResult>
{
  readonly queryType = QUERY_TYPES.GET_PROFILE_STATUSES;
  private readonly profileService: IProfileQueryService;

  constructor(profileService: IProfileQueryService) {
    this.profileService = profileService;
  }

  async handle(_query: Query<GetProfileStatusesQueryPayload>): Promise<GetProfileStatusesQueryResult> {
    const statuses = await this.profileService.getProfileStatuses();
    return { statuses };
  }
}

export class GetAuthStatusQueryHandler
  implements QueryHandler<GetAuthStatusQueryPayload, GetAuthStatusQueryResult>
{
  readonly queryType = QUERY_TYPES.GET_AUTH_STATUS;
  private readonly profileService: IProfileQueryService;

  constructor(profileService: IProfileQueryService) {
    this.profileService = profileService;
  }

  async handle(_query: Query<GetAuthStatusQueryPayload>): Promise<GetAuthStatusQueryResult> {
    const status = await this.profileService.getAuthStatus();
    return { authenticated: status.authenticated, profileName: status.profileName };
  }
}

export class ListModelsQueryHandler
  implements QueryHandler<ListModelsQueryPayload, ListModelsQueryResult>
{
  readonly queryType = QUERY_TYPES.LIST_MODELS;
  private readonly geminiClient: IGeminiClientQueryService;

  constructor(geminiClient: IGeminiClientQueryService) {
    this.geminiClient = geminiClient;
  }

  async handle(_query: Query<ListModelsQueryPayload>): Promise<ListModelsQueryResult> {
    const models = await this.geminiClient.listModels();
    return { models };
  }
}

export class ProbeProfileQueryHandler
  implements QueryHandler<ProbeProfileQueryPayload, ProbeProfileQueryResult>
{
  readonly queryType = QUERY_TYPES.PROBE_PROFILE;
  private readonly getGeminiClient: (profileName?: string) => Promise<IGeminiClientQueryService>;

  constructor(getGeminiClient: (profileName?: string) => Promise<IGeminiClientQueryService>) {
    this.getGeminiClient = getGeminiClient;
  }

  async handle(query: Query<ProbeProfileQueryPayload>): Promise<ProbeProfileQueryResult> {
    const { profileName } = query.payload;
    const [modelsResult, chatsResult] = await Promise.allSettled([
      this.probeModels(profileName),
      this.probeChats(profileName),
    ]);

    if (modelsResult.status === "rejected") {
      return {
        result: "dead",
        chatsCount: 0,
        modelsCount: 0,
        error: modelsResult.reason instanceof Error ? modelsResult.reason.message : String(modelsResult.reason),
      };
    }

    if (chatsResult.status === "rejected") {
      return {
        result: "dead",
        chatsCount: 0,
        modelsCount: modelsResult.value,
        error: chatsResult.reason instanceof Error ? chatsResult.reason.message : String(chatsResult.reason),
      };
    }

    if (chatsResult.value === 0) {
      return { result: "phantom", chatsCount: 0, modelsCount: modelsResult.value };
    }

    return { result: "live", chatsCount: chatsResult.value, modelsCount: modelsResult.value };
  }

  private async probeModels(profileName: string): Promise<number> {
    const client = await this.getGeminiClient(profileName);
    const models = await client.listModels();
    return models.length;
  }

  private async probeChats(profileName: string): Promise<number> {
    const client = await this.getGeminiClient(profileName);
    const chats = await client.listChats({ limit: 1 });
    return chats.length;
  }
}
