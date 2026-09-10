// Invariant: transport-error translation leaves auth-error classification
// untouched (issue #24, parent #23, 2026-09-10).
//
// GeminiClientService is auth-sensitive because translateError() is where the
// SDK's AuthError becomes the "run 'gemiterm login'" AuthenticationError. The
// #24 change reroutes init() failures through translateError (init now runs
// inside each method's try/catch) and adds a transport branch for the llhttp
// HPE_HEADER_OVERFLOW family. Two behaviors are pinned here:
// 1. SDK AuthError -> AuthenticationError on BOTH the call path and the init
//    path — the login guidance must survive the rerouting, and the transport
//    branch must never capture an AuthError instance (it stays first in the
//    classification order).
// 2. Transport errors translate to an actionable GeminiAPIError — never an
//    AuthenticationError, never the raw parser string — with the original
//    error preserved as .cause.
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { GeminiClientService } from "../../src/services/gemini-client-wrapper.ts";
import type { GeminiClientDeps } from "../../src/services/gemini-client-wrapper.ts";
import { GeminiAPIError, AuthenticationError } from "../../src/core/errors.ts";
import { Logger } from "../../src/infrastructure/logger.ts";
import { setupIsolation, teardownIsolation } from "./harness.ts";

beforeEach(setupIsolation);
afterEach(teardownIsolation);

class MockAuthError extends Error {
  name = "AuthError" as const;
}
class MockGeminiError extends Error {
  name = "GeminiError" as const;
}
class MockAPIError extends Error {
  name = "APIError" as const;
}

function axiosHeaderOverflow(): Error & { code?: string } {
  const e = new Error("Parse Error: Header overflow") as Error & { code?: string };
  e.code = "HPE_HEADER_OVERFLOW";
  return e;
}

function makeDeps(opts: { initThrows?: unknown; chatsThrows?: unknown }): GeminiClientDeps {
  const client = {
    cookies: { "__Secure-1PSID": "sid" },
    init: async () => {
      if (opts.initThrows) throw opts.initThrows;
    },
    chats: async () => {
      if (opts.chatsThrows) throw opts.chatsThrows;
      return [];
    },
    readChat: async () => null,
    newChat: () => {
      throw new Error("newChat not expected in this invariant");
    },
    deleteChat: async () => {},
    models: async () => [],
  };
  return {
    Gemini: function () {
      return client;
    } as unknown as GeminiClientDeps["Gemini"],
    AuthError: MockAuthError as unknown as GeminiClientDeps["AuthError"],
    GeminiError: MockGeminiError as unknown as GeminiClientDeps["GeminiError"],
    UsageLimitExceeded: MockGeminiError as unknown as GeminiClientDeps["UsageLimitExceeded"],
    TemporarilyBlocked: MockGeminiError as unknown as GeminiClientDeps["TemporarilyBlocked"],
    ModelInvalid: MockGeminiError as unknown as GeminiClientDeps["ModelInvalid"],
    APIError: MockAPIError as unknown as GeminiClientDeps["APIError"],
  };
}

async function rejectionOf(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("expected promise to reject");
}

describe("auth-regression: transport-error translation is auth-inert", () => {
  test("AuthError from the init() path still classifies as AuthenticationError", async () => {
    const d = makeDeps({ initThrows: new MockAuthError("auth failure") });
    const service = new GeminiClientService({ secure1psid: "sid" }, new Logger("test"), undefined, undefined, d);

    const err = await rejectionOf(service.listChats()) as AuthenticationError;

    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err.message).toContain("gemiterm login");
  });

  test("AuthError from the call path is unchanged (regression anchor)", async () => {
    const d = makeDeps({ chatsThrows: new MockAuthError("auth failure") });
    const service = new GeminiClientService({ secure1psid: "sid" }, new Logger("test"), undefined, undefined, d);

    const err = await rejectionOf(service.listChats()) as AuthenticationError;

    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err.message).toContain("gemiterm login");
  });

  test("an AuthError instance is never captured by the transport branch, regardless of message", async () => {
    const misleading = new MockAuthError("Parse Error: Header overflow");
    const d = makeDeps({ chatsThrows: misleading });
    const service = new GeminiClientService({ secure1psid: "sid" }, new Logger("test"), undefined, undefined, d);

    const err = await rejectionOf(service.listChats()) as AuthenticationError;

    expect(err).toBeInstanceOf(AuthenticationError);
    expect(err.message).toContain("gemiterm login");
    expect(err.message).not.toContain("HTTP parser limit");
  });

  test("transport error from the init() path is an actionable GeminiAPIError, never an AuthenticationError", async () => {
    const original = axiosHeaderOverflow();
    const d = makeDeps({ initThrows: original });
    const service = new GeminiClientService({ secure1psid: "sid" }, new Logger("test"), undefined, undefined, d);

    const err = await rejectionOf(service.listChats()) as GeminiAPIError;

    expect(err).toBeInstanceOf(GeminiAPIError);
    expect(err).not.toBeInstanceOf(AuthenticationError);
    expect(err.message).toContain("HTTP parser limit");
    expect(err.message).toContain("--max-http-header-size");
    expect(err.message).not.toContain("Parse Error: Header overflow");
    expect(err.cause).toBe(original);
  });
});
