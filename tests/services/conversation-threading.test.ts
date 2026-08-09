import { describe, test, expect } from "bun:test";
import {
  makeMetadata,
  extractMetadata,
  threadOnto,
  captureFrom,
} from "../../src/services/conversation-threading.ts";
import type { ChatMetadata } from "../../src/services/chat-metadata-storage.ts";

describe("ConversationThreading", () => {
  describe("makeMetadata", () => {
    test("constructs metadata array with cid, rid, rcid, ctx", () => {
      const meta: ChatMetadata = { rid: "rid123", rcid: "rcid456", ctx: "ctx789" };
      const result = makeMetadata("cid001", meta);
      expect(result[0]).toBe("cid001");
      expect(result[1]).toBe("rid123");
      expect(result[2]).toBe("rcid456");
      expect(result[9]).toBe("ctx789");
      expect(result[3]).toBeNull();
    });

    test("handles null ctx — stores as empty string for SDK compatibility", () => {
      const meta: ChatMetadata = { rid: "rid1", rcid: "rcid1", ctx: null };
      const result = makeMetadata("c1", meta);
      expect(result[9]).toBe("");
    });

    test("produces 10-element array", () => {
      const result = makeMetadata("c1", { rid: "r", rcid: "rc", ctx: null });
      expect(result).toHaveLength(10);
    });
  });

  describe("extractMetadata", () => {
    test("extracts rid, rcid, ctx from metadata array", () => {
      const arr: (string | null)[] = [null, "rid1", "rcid1", null, null, null, null, null, null, "ctx1"];
      const result = extractMetadata(arr);
      expect(result).toEqual({ rid: "rid1", rcid: "rcid1", ctx: "ctx1" });
    });

    test("returns null for undefined input", () => {
      expect(extractMetadata(undefined)).toBeNull();
    });

    test("returns null when rid and rcid are both missing", () => {
      const arr: (string | null)[] = [null, null, undefined, null, null, null, null, null, null, null];
      expect(extractMetadata(arr)).toBeNull();
    });

    test("treats empty string ctx as null", () => {
      const arr: (string | null)[] = [null, "rid1", "rcid1", null, null, null, null, null, null, ""];
      const result = extractMetadata(arr);
      expect(result?.ctx).toBeNull();
    });
  });

  describe("threadOnto", () => {
    test("uses stored metadata when available", () => {
      const stored: ChatMetadata = { rid: "rid1", rcid: "rcid1", ctx: "ctx1" };
      const result = threadOnto("c1", stored);
      expect(result.seeded).toBe(true);
      expect(result.metadata[0]).toBe("c1");
      expect(result.metadata[1]).toBe("rid1");
      expect(result.metadata[2]).toBe("rcid1");
    });

    test("creates metadata array even without stored data", () => {
      const result = threadOnto("c1", null);
      expect(result.seeded).toBe(false);
      expect(result.metadata[0]).toBe("c1");
      expect(result.metadata[1]).toBe("");
      expect(result.metadata[2]).toBe("");
    });
  });

  describe("captureFrom", () => {
    test("extracts metadata from SDK output", () => {
      const output = { metadata: [null, "rid1", "rcid1", null, null, null, null, null, null, "ctx1"] };
      const result = captureFrom(output, "c1");
      expect(result).toEqual({ rid: "rid1", rcid: "rcid1", ctx: "ctx1" });
    });

    test("returns null for output without metadata", () => {
      expect(captureFrom({}, "c1")).toBeNull();
    });

    test("returns null when extractMetadata returns null", () => {
      expect(captureFrom({ metadata: [] }, "c1")).toBeNull();
    });
  });
});
