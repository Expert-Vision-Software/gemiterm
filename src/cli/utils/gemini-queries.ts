import type { ChatInfo, Message } from "../../core/types.ts";
import type { GeminiClientService } from "../../services/gemini-client-wrapper.ts";

export interface ListChatsRequest {
  limit?: number;
  offset?: number;
  search?: string;
  profile?: string;
  allProfiles?: boolean;
}

export async function listChatsForRequest(
  getGeminiClient: () => GeminiClientService,
  listProfiles: () => string[],
  request: ListChatsRequest,
): Promise<ChatInfo[]> {
  const { limit, offset, search, profile, allProfiles } = request;
  const options = { limit, offset, search };
  const client = getGeminiClient();

  if (profile) {
    return client.forProfile(profile).listChats(options);
  }

  if (allProfiles) {
    const profileNames = listProfiles();
    const results = await Promise.all(
      profileNames.map((name) => client.forProfile(name).listChats(options)),
    );
    return results.flat().sort((a, b) => b.timestamp - a.timestamp);
  }

  return client.listChats(options);
}

export async function fetchChatForRequest(
  getGeminiClient: () => GeminiClientService,
  conversationId: string,
  profileName?: string,
): Promise<Message[]> {
  const client = getGeminiClient();
  return profileName
    ? client.forProfile(profileName).fetchChat(conversationId)
    : client.fetchChat(conversationId);
}
