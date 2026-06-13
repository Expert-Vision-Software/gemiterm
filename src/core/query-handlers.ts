import type { Query, QueryHandler } from "./mediator.ts";
import type { ChatInfo, Message, ProfileStatus } from "./types.ts";
import type { IGeminiClientService } from "./command-handlers.ts";

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

export const QUERY_TYPES = {
  LIST_CHATS: "list-chats",
  FETCH_CHAT: "fetch-chat",
  GET_PROFILE_STATUSES: "get-profile-statuses",
  GET_AUTH_STATUS: "get-auth-status",
  LIST_MODELS: "list-models",
} as const;

export type QueryType = (typeof QUERY_TYPES)[keyof typeof QUERY_TYPES];

export interface IGeminiClientQueryService {
  listChats(options?: { limit?: number; offset?: number; search?: string }): Promise<ChatInfo[]>;
  fetchChat(conversationId: string): Promise<Message[]>;
  listModels(): Promise<string[]>;
}

export interface IProfileQueryService {
  getProfileStatuses(): Promise<ProfileStatus[]>;
  getAuthStatus(): Promise<{ authenticated: boolean; profileName: string | null }>;
}

export class ListChatsQueryHandler
  implements QueryHandler<ListChatsQueryPayload, ListChatsQueryResult>
{
  readonly queryType = QUERY_TYPES.LIST_CHATS;
  private readonly getGeminiClient: () => IGeminiClientService;
  private readonly listProfiles: () => string[];

  constructor(getGeminiClient: () => IGeminiClientService, listProfiles: () => string[]) {
    this.getGeminiClient = getGeminiClient;
    this.listProfiles = listProfiles;
  }

  async handle(query: Query<ListChatsQueryPayload>): Promise<ListChatsQueryResult> {
    const { limit, offset, search, allProfiles, profile } = extractPayload(query);
    const options = { limit, offset, search };
    const client = this.getGeminiClient();

    let chats: ChatInfo[];
    if (profile) {
      chats = await client.forProfile(profile).listChats(options);
    } else if (allProfiles) {
      const profileNames = this.listProfiles();
      const results = await Promise.all(
        profileNames.map((name) => client.forProfile(name).listChats(options)),
      );
      chats = results.flat();
      chats.sort((a, b) => b.timestamp - a.timestamp);
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
    const { conversationId } = extractPayload(query);
    const messages = await this.geminiClient.fetchChat(conversationId);
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
