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

export interface ListChatsOutcome {
  profile: string;
  chats?: ChatInfo[];
  error?: unknown;
}

const logger = new Logger("gemini-queries");

// Per-profile fan-out result (fix-8, design D2): each profile yields either
// its chats or the error that aborted the query. Errors-as-data is this
// outcomes form's contract — the `list` command gates its rotation await on
// it. The thin merge (`listChatsForRequest`) restores the pre-fix-8 seam
// semantics: an explicit-profile error propagates; aggregate per-profile
// errors are swallowed with a warn.
//
// `onlyProfiles` lets the caller re-query a specific subset after a rotation
// lands — live profiles are never re-queried (zero added latency, design D2).
export async function listChatsOutcomes(
  getGeminiClient: () => Promise<GeminiClientService>,
  listProfiles: () => Promise<string[]>,
  request: ListChatsRequest,
  options: { onlyProfiles?: string[] } = {},
): Promise<ListChatsOutcome[]> {
  const { limit, offset, search, profile } = request;
  const listOptions = { limit, offset, search };

  if (profile) {
    const client = await getGeminiClient();
    try {
      const chats = await (await client.forProfile(profile)).listChats(listOptions);
      return [{ profile, chats }];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`Failed to list chats for profile '${profile}': ${message}`);
      return [{ profile, error }];
    }
  }

  const all = await listProfiles();
  const profileNames = options.onlyProfiles
    ? all.filter((p) => options.onlyProfiles!.includes(p))
    : all;
  if (profileNames.length === 0) return [];

  const client = await getGeminiClient();
  const settled = await Promise.allSettled(
    profileNames.map(async (name) => await (await client.forProfile(name)).listChats(listOptions)),
  );

  return profileNames.map((name, index) => {
    const result = settled[index]!;
    if (result.status === "fulfilled") {
      return { profile: name, chats: result.value };
    }
    const reason = result.reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    logger.warn(`Failed to list chats for profile '${name}': ${message}`);
    return { profile: name, error: reason };
  });
}

export async function listChatsForRequest(
  getGeminiClient: () => Promise<GeminiClientService>,
  listProfiles: () => Promise<string[]>,
  request: ListChatsRequest,
): Promise<ChatInfo[]> {
  const outcomes = await listChatsOutcomes(getGeminiClient, listProfiles, request);
  if (request.profile) {
    const explicit = outcomes.find((outcome) => outcome.profile === request.profile);
    if (explicit?.error !== undefined) throw explicit.error;
  }
  const chats: ChatInfo[] = [];
  for (const outcome of outcomes) {
    if (outcome.chats) chats.push(...outcome.chats);
  }
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
