import type { ChatInfo, Message } from "../../core/types.ts";
import type { GeminiClientService } from "../../services/gemini-client-wrapper.ts";
import { Logger } from "../../infrastructure/logger.ts";

export interface ListChatsRequest {
  limit?: number;
  offset?: number;
  search?: string;
  profile?: string;
  allProfiles?: boolean;
}

const logger = new Logger("gemini-queries");

export async function listChatsForRequest(
  getGeminiClient: () => GeminiClientService,
  listProfiles: () => string[],
  request: ListChatsRequest,
): Promise<ChatInfo[]> {
  const { limit, offset, search, profile } = request;
  const options = { limit, offset, search };
  const client = getGeminiClient();

  if (profile) {
    return client.forProfile(profile).listChats(options);
  }

  const profileNames = listProfiles();
  const settled = await Promise.allSettled(
    profileNames.map((name) => client.forProfile(name).listChats(options)),
  );

  const chats: ChatInfo[] = [];
  settled.forEach((result, index) => {
    if (result.status === "fulfilled") {
      chats.push(...result.value);
    } else {
      const reason = result.reason;
      const message = reason instanceof Error ? reason.message : String(reason);
      logger.warn(`Failed to list chats for profile '${profileNames[index]}': ${message}`);
    }
  });

  return chats.sort((a, b) => b.timestamp - a.timestamp);
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
