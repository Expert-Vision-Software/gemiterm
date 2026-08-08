import { describe, test, expect, mock } from "bun:test";
import { createClientServices } from "../../src/cli/client-services.ts";
import type { GeminiClientService } from "../../src/services/gemini-client-wrapper.ts";

function makeFakeClient(profileClient?: GeminiClientService): GeminiClientService {
  return {
    forProfile: mock(() => profileClient ?? ({} as GeminiClientService)),
    async listChats() { return []; },
    async fetchChat() { return []; },
    async listModels() { return []; },
    async deleteChat() {},
    async sendMessage() { return ""; },
    async startNewChat() { return { response: "", conversationId: "" }; },
    async profileHasConversation() { return false; },
    async models() { return []; },
  } as unknown as GeminiClientService;
}

describe("createClientServices — forProfile first-call init (Bug 3)", () => {
  test("clientService.forProfile initializes the client on first call instead of throwing", async () => {
    let cached: GeminiClientService | null = null;
    const profileClient = {} as GeminiClientService;
    const fakeClient = makeFakeClient(profileClient);
    const getGeminiClient = mock(async (_profileName?: string) => {
      cached = fakeClient;
      return fakeClient;
    });

    const { clientService } = createClientServices(getGeminiClient, () => cached);

    const result = await clientService.forProfile("work");

    expect(result).toBe(profileClient);
    expect(getGeminiClient).toHaveBeenCalledWith("work");
  });

  test("commandClientService.forProfile initializes the client on first call instead of throwing", async () => {
    let cached: GeminiClientService | null = null;
    const profileClient = {} as GeminiClientService;
    const fakeClient = makeFakeClient(profileClient);
    const getGeminiClient = mock(async (_profileName?: string) => {
      cached = fakeClient;
      return fakeClient;
    });

    const { commandClientService } = createClientServices(getGeminiClient, () => cached);

    const result = await commandClientService.forProfile("work");

    expect(result).toBe(profileClient);
    expect(getGeminiClient).toHaveBeenCalledWith("work");
  });
});
