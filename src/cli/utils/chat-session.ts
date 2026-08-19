import chalk from "chalk";
import type { GeminiClientService } from "../../services/gemini-client-wrapper.ts";
import type { Logger } from "../../infrastructure/logger.ts";
import type { CookieSession } from "../../auth/cookie-session.ts";
import { runWithRotationRetry } from "./rotation-await.ts";
import { runInteractiveLoop, type MessageHandlerResult, type SessionKeepaliveHandle } from "./interactive-prompt.ts";
import { text, CancellationError } from "./prompts.ts";

export interface StartChatSessionParams {
  effectiveMessage: string | null;
  conversationId?: string | null;
  profileName?: string | null;
  getGeminiClient: () => Promise<GeminiClientService>;
  logger: Logger;
  onFirstTurn?: (conversationId: string) => void;
  onInteractiveTurn?: (conversationId: string, isFirst: boolean) => void;
  beforeInteractiveLoop?: () => Promise<void>;
  keepalive?: SessionKeepaliveHandle;
  cookieSession?: CookieSession;
  rotationProfile?: string;
}

export async function startChatSession(params: StartChatSessionParams): Promise<void> {
  const {
    effectiveMessage,
    conversationId,
    profileName,
    getGeminiClient,
    logger,
    onFirstTurn,
    onInteractiveTurn,
    beforeInteractiveLoop,
    keepalive,
    cookieSession,
    rotationProfile,
  } = params;

  const resolveClient = async (): Promise<GeminiClientService> =>
    profileName ? await (await getGeminiClient()).forProfile(profileName) : await getGeminiClient();

  if (effectiveMessage) {
    if (conversationId) {
      logger.debug(`Sending message to ${conversationId}`);
      const send = async (): Promise<string> => {
        const client = await resolveClient();
        return client.sendMessage(conversationId, effectiveMessage);
      };
      const response = cookieSession && rotationProfile
        ? await runWithRotationRetry(cookieSession, rotationProfile, send, () => false)
        : await send();
      console.log(chalk.blue.bold("Model:"));
      console.log(response);
    } else {
      logger.debug("Starting new chat with message");
      const result = await (await resolveClient()).startNewChat(effectiveMessage);
      onFirstTurn?.(result.conversationId);
      console.log(chalk.blue.bold("Model:"));
      console.log(result.response);
    }
    return;
  }

  await beforeInteractiveLoop?.();

  let sessionConversationId: string | null = conversationId ?? null;

  const messageHandler = async (message: string): Promise<MessageHandlerResult> => {
    if (sessionConversationId) {
      logger.debug(`Sending message to ${sessionConversationId}`);
      const response = await (await resolveClient()).sendMessage(sessionConversationId, message);
      onInteractiveTurn?.(sessionConversationId, false);
      return { response };
    }

    const result = await (await resolveClient()).startNewChat(message);
    sessionConversationId = result.conversationId;
    onInteractiveTurn?.(sessionConversationId, true);
    return { response: result.response };
  };

  await runInteractiveLoop(messageHandler, { profileName }, { text, CancellationError, keepalive });
}
