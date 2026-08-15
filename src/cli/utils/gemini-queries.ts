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
  getGeminiClient: () => Promise<GeminiClientService>,
  listProfiles: () => Promise<string[]>,
  request: ListChatsRequest,
): Promise<ChatInfo[]> {
  const { limit, offset, search, profile } = request;
  const options = { limit, offset, search };
  const client = await getGeminiClient();

  if (profile) {
    return (await client.forProfile(profile)).listChats(options);
  }

  const profileNames = await listProfiles();
  const settled = await Promise.allSettled(
    profileNames.map(async (name) => await (await client.forProfile(name)).listChats(options)),
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
  getGeminiClient: () => Promise<GeminiClientService>,
  conversationId: string,
  profileName?: string,
): Promise<Message[]> {
  const client = await getGeminiClient();
  return profileName
    ? (await client.forProfile(profileName)).fetchChat(conversationId)
    : client.fetchChat(conversationId);
}
