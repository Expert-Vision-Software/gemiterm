// Throwaway diagnostic — captures what the wrapper actually sends as
// `chat.metadata` when we call `sendMessage(conversationId, message)`.
//
// WHY THIS EXISTS (proves the `continue` bug):
//
// gemini-reverse 2.1.0 ChatSession has 4 setters:
//   - setter cid  -> _meta[0]
//   - setter rid  -> _meta[1]
//   - setter rcid -> _meta[2]
//   - setter metadata -> full 10-element array
//
// When `_stream` posts the body to /StreamGenerate, `inner[2] = chat.metadata`.
// The server uses [cid, rid, rcid, ...] to thread the response onto an existing
// conversation. Setting only cid leaves rid/rcid as empty strings.
//
// The gemini-reverse README "Continue Previous Conversations" section says:
//   "The metadata array contains [cid, rid, rcid, ...] which uniquely
//   identifies the conversation turn. Storing and restoring it is enough
//   to resume the exact conversation context."
//
// So `newChat() + session.cid = cid` is INSUFFICIENT — the server cannot thread
// onto the existing conversation with rid="" / rcid="". The user's symptom
// (continue creates a new chat) is exactly this bug.
import { describe, test, expect, beforeEach } from "bun:test";
import { Logger } from "../src/infrastructure/logger.ts";

class MockAuthError extends Error { name = "AuthError" as const; }
class MockGeminiError extends Error { name = "GeminiError" as const; }
class MockUsageLimitExceeded extends MockGeminiError { name = "UsageLimitExceeded" as const; }
class MockTemporarilyBlocked extends MockGeminiError { name = "TemporarilyBlocked" as const; }
class MockModelInvalid extends MockGeminiError { name = "ModelInvalid" as const; }
class MockAPIError extends Error { name = "APIError" as const; }

interface MetaCapture {
  metadataAtGenerateContent: (string | null)[] | null;
  cidAtGenerateContent: string | null;
}

function makeGeminiReverseLikeSession(): { session: any; capture: MetaCapture } {
  const capture: MetaCapture = { metadataAtGenerateContent: null, cidAtGenerateContent: null };
  const DEFAULT_METADATA: (string | null)[] = ["", "", "", null, null, null, null, null, null, ""];
  let _meta: (string | null)[] = [...DEFAULT_METADATA];
  const session = {
    get cid() { return _meta[0] || ""; },
    set cid(v: string) { _meta[0] = v; },
    get rid() { return _meta[1] || ""; },
    set rid(v: string) { _meta[1] = v; },
    get rcid() { return _meta[2] || ""; },
    set rcid(v: string) { _meta[2] = v; },
    get metadata() { return _meta; },
    set metadata(v: (string | null)[]) {
      if (!Array.isArray(v)) return;
      for (let i = 0; i < v.length && i < 10; i++) {
        if (v[i] != null) _meta[i] = v[i];
      }
    },
    generateContent: (function () {
      const fn = async function (this: any, _opts: { prompt: string }) {
        capture.metadataAtGenerateContent = [...this.metadata];
        capture.cidAtGenerateContent = this.cid;
        return { text: { toString: () => "model response" } };
      };
      return fn;
    })(),
  };
  return { session, capture };
}

describe("DIAG: sendMessage metadata propagation", () => {
  let logger: Logger;
  beforeEach(() => { logger = new Logger("diag"); });

  test("wrapper.sendMessage sets ONLY cid; rid and rcid are empty -> server cannot thread", async () => {
    const { session, capture } = makeGeminiReverseLikeSession();
    const deps = {
      Gemini: function () {
        return { cookies: { "__Secure-1PSID": "x" }, init: async () => {}, newChat: () => session };
      } as any,
      AuthError: MockAuthError, GeminiError: MockGeminiError,
      UsageLimitExceeded: MockUsageLimitExceeded, TemporarilyBlocked: MockTemporarilyBlocked,
      ModelInvalid: MockModelInvalid, APIError: MockAPIError,
    };

    const { GeminiClientService } = await import("../src/services/gemini-client-wrapper.ts");
    const svc = new GeminiClientService({ secure1psid: "x" }, logger, undefined, undefined, deps as any);
    const result = await svc.sendMessage("existing-conv-xyz", "hello");

    const meta = capture.metadataAtGenerateContent as any[];
    console.log("[DIAG] metadata sent on the wire:", JSON.stringify(meta));
    console.log("[DIAG] cid  (index 0):", JSON.stringify(meta[0]));
    console.log("[DIAG] rid  (index 1):", JSON.stringify(meta[1]));
    console.log("[DIAG] rcid (index 2):", JSON.stringify(meta[2]));

    expect(result).toBe("model response");
    expect(meta[0]).toBe("existing-conv-xyz"); // cid IS set
    expect(meta[1]).toBe("");                  // rid is EMPTY — server cannot thread
    expect(meta[2]).toBe("");                  // rcid is EMPTY — server cannot thread
  });
});
