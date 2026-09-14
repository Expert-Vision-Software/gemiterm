// Invariant: transport-error hygiene on the client wrapper keeps auth-error
// classification intact (issue #24, 2026-09-13).
//
// Two guarantees:
// 1. HPE_HEADER_OVERFLOW-class transport errors (init path included) are
//    translated to GeminiAPIError with `.cause` — never leaked raw, and never
//    misclassified as AuthenticationError.
// 2. AuthError instances still map to AuthenticationError, even when their
//    message contains parser-error text (classification is type-based, not
//    message-based).
import { describe, test, expect, mock } from "bun:test";
import { Logger } from "../../src/infrastructure/logger.ts";
import { GeminiAPIError, AuthenticationError } from "../../src/core/errors.ts";
import type { GeminiClientDeps } from "../../src/services/gemini-client-wrapper.ts";

class MockAuthError extends Error {
  name = "AuthError" as const;
}
class MockGeminiError extends Error {
  name = "GeminiError" as const;
}

function makeDeps(initImplementation?: () => void): GeminiClientDeps {
  return {
    Gemini: function() {
      return {
        cookies: { "__Secure-1PSID": "sid" },
        init: mock(async function() {
          if (initImplementation) initImplementation();
        }),
        chats: mock(async () => []),
        readChat: mock(async () => null),
        newChat: mock(function() {
          return { cid: "", generateContent: async () => ({ text: { toString: () => "" } }) };
        }),
        deleteChat: mock(async () => {}),
        models: mock(async () => []),
      };
    },
    AuthError: MockAuthError as unknown as GeminiClientDeps["AuthError"],
    GeminiError: MockGeminiError as unknown as GeminiClientDeps["GeminiError"],
    UsageLimitExceeded: MockGeminiError as unknown as GeminiClientDeps["UsageLimitExceeded"],
    TemporarilyBlocked: MockGeminiError as unknown as GeminiClientDeps["TemporarilyBlocked"],
    ModelInvalid: MockGeminiError as unknown as GeminiClientDeps["ModelInvalid"],
    APIError: MockGeminiError as unknown as GeminiClientDeps["APIError"],
  };
}

describe("auth-regression: transport-error hygiene preserves auth classification", () => {
  test("init-path HPE_HEADER_OVERFLOW is GeminiAPIError with cause, not AuthenticationError", async () => {
    const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
    const d = makeDeps(() => {
      const e = new Error("Parse Error: Header overflow") as Error & { code?: string };
      e.code = "HPE_HEADER_OVERFLOW";
      throw e;
    });
    const service = new GeminiClientService({ secure1psid: "sid" }, new Logger("test"), undefined, undefined, d);

    const err = await service.listChats().catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(GeminiAPIError);
    expect(err).not.toBeInstanceOf(AuthenticationError);
    expect((err as GeminiAPIError).cause).toBeInstanceOf(Error);
    expect(err.message).toContain("parser limit");
  });

  test("AuthError still maps to AuthenticationError even with parser-error wording", async () => {
    const { GeminiClientService } = await import("../../src/services/gemini-client-wrapper.ts");
    const d = makeDeps(() => {
      throw new MockAuthError("Parse Error: Header overflow during auth handshake");
    });
    const service = new GeminiClientService({ secure1psid: "sid" }, new Logger("test"), undefined, undefined, d);

    const err = await service.listChats().catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err.message).toBe("Session expired or invalid. Please run 'gemiterm login' again.");
  });
});
