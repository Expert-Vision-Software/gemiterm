import type { GeminiClientService } from "../services/gemini-client-wrapper.ts";
import type { IGeminiClientService } from "../core/command-handlers.ts";
import type { IGeminiClientQueryService } from "../core/query-handlers.ts";

export type GetGeminiClientFn = (profileName?: string) => Promise<GeminiClientService>;

export interface ClientServices {
  clientService: IGeminiClientQueryService;
  commandClientService: IGeminiClientService;
}

export function createClientServices(
  getGeminiClient: GetGeminiClientFn,
): ClientServices {
  const clientService: IGeminiClientQueryService = {
    async listChats(options?: { limit?: number; offset?: number; search?: string }) {
      return (await getGeminiClient()).listChats(options);
    },
    async fetchChat(id: string) {
      return (await getGeminiClient()).fetchChat(id);
    },
    async listModels() {
      return (await getGeminiClient()).listModels();
    },
    async forProfile(name: string) {
      const c = await getGeminiClient(name);
      return c.forProfile(name);
    },
  };

  const commandClientService: IGeminiClientService = {
    async deleteChat(id: string) {
      return (await getGeminiClient()).deleteChat(id);
    },
    async sendMessage(id: string, msg: string) {
      return (await getGeminiClient()).sendMessage(id, msg);
    },
    async startNewChat(msg: string) {
      return (await getGeminiClient()).startNewChat(msg);
    },
    async profileHasConversation(name: string, id: string) {
      return (await getGeminiClient()).profileHasConversation(name, id);
    },
    async forProfile(name: string) {
      const c = await getGeminiClient(name);
      return c.forProfile(name);
    },
    async listChats(options?: { limit?: number; offset?: number; search?: string }) {
      return (await getGeminiClient()).listChats(options);
    },
    async models() {
      return (await getGeminiClient()).models();
    },
  };

  return { clientService, commandClientService };
}
