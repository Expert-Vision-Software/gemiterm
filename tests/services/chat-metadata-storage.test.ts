import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { ChatMetadataStorage } from "../../src/services/chat-metadata-storage.ts";
import { Logger } from "../../src/infrastructure/logger.ts";
import { existsFile, readTextFile } from "../../src/infrastructure/io.ts";
import { getProfileChatMetadataPath } from "../../src/infrastructure/path-utils.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";

describe("ChatMetadataStorage", () => {
  let storage: ChatMetadataStorage;
  let logger: Logger;
  let tempDir: string;
  let originalConfigDir: string | undefined;

  beforeEach(() => {
    originalConfigDir = process.env.GEMITERM_CONFIG_DIR;
    tempDir = fs.mkdtempSync(path.join(tmpdir(), "gemiterm-test-"));
    process.env.GEMITERM_CONFIG_DIR = tempDir;
    logger = new Logger("test");
    storage = new ChatMetadataStorage(logger);
  });

  afterEach(() => {
    if (originalConfigDir !== undefined) {
      process.env.GEMITERM_CONFIG_DIR = originalConfigDir;
    } else {
      delete process.env.GEMITERM_CONFIG_DIR;
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("save and lookup", () => {
    test("round-trips per cid per profile", () => {
      const profileName = "default";
      const cid = "conv-123";
      const metadata = { rid: "rid-abc", rcid: "rcid-xyz", ctx: null };

      storage.save(profileName, cid, metadata);
      const result = storage.lookup(profileName, cid);

      expect(result).toEqual(metadata);
    });

    test("multiple cids in same profile are independent", () => {
      const profileName = "default";
      const cid1 = "conv-1";
      const cid2 = "conv-2";
      const meta1 = { rid: "rid-1", rcid: "rcid-1", ctx: null };
      const meta2 = { rid: "rid-2", rcid: "rcid-2", ctx: "some-context" };

      storage.save(profileName, cid1, meta1);
      storage.save(profileName, cid2, meta2);

      expect(storage.lookup(profileName, cid1)).toEqual(meta1);
      expect(storage.lookup(profileName, cid2)).toEqual(meta2);
    });
  });

  describe("lookup", () => {
    test("returns null for unknown cid", () => {
      const result = storage.lookup("default", "nonexistent");
      expect(result).toBeNull();
    });

    test("returns null for profile with no saved data", () => {
      const result = storage.lookup("nonexistent-profile", "conv-1");
      expect(result).toBeNull();
    });

    test("profileA/cidX does NOT return a value saved under profileB/cidX", () => {
      const metaA = { rid: "rid-A", rcid: "rcid-A", ctx: null };
      const metaB = { rid: "rid-B", rcid: "rcid-B", ctx: null };

      storage.save("profileA", "conv-X", metaA);
      storage.save("profileB", "conv-X", metaB);

      expect(storage.lookup("profileA", "conv-X")).toEqual(metaA);
      expect(storage.lookup("profileB", "conv-X")).toEqual(metaB);
    });
  });

  describe("load", () => {
    test("returns the full record map for a profile", () => {
      const profileName = "default";
      const meta1 = { rid: "rid-1", rcid: "rcid-1", ctx: null };
      const meta2 = { rid: "rid-2", rcid: "rcid-2", ctx: "ctx-2" };

      storage.save(profileName, "conv-1", meta1);
      storage.save(profileName, "conv-2", meta2);

      const result = storage.load(profileName);

      expect(result).toEqual({
        "conv-1": meta1,
        "conv-2": meta2,
      });
    });

    test("returns empty object when profile has no data", () => {
      const result = storage.load("nonexistent-profile");
      expect(result).toEqual({});
    });
  });

  describe("delete", () => {
    test("removes a single cid entry without touching the rest", () => {
      const profileName = "default";
      const meta1 = { rid: "rid-1", rcid: "rcid-1", ctx: null };
      const meta2 = { rid: "rid-2", rcid: "rcid-2", ctx: null };
      const meta3 = { rid: "rid-3", rcid: "rcid-3", ctx: null };

      storage.save(profileName, "conv-1", meta1);
      storage.save(profileName, "conv-2", meta2);
      storage.save(profileName, "conv-3", meta3);

      storage.delete(profileName, "conv-2");

      expect(storage.lookup(profileName, "conv-1")).toEqual(meta1);
      expect(storage.lookup(profileName, "conv-2")).toBeNull();
      expect(storage.lookup(profileName, "conv-3")).toEqual(meta3);
    });

    test("delete is idempotent when cid does not exist", () => {
      const profileName = "default";
      const meta = { rid: "rid-1", rcid: "rcid-1", ctx: null };

      storage.save(profileName, "conv-1", meta);
      storage.delete(profileName, "nonexistent");

      expect(storage.lookup(profileName, "conv-1")).toEqual(meta);
    });
  });

  describe("cache hydration after process restart", () => {
    test("lookup hydrates the in-memory cache after the cache is cleared", () => {
      const profileName = "default";
      const cid = "conv-123";
      const metadata = { rid: "rid-xyz", rcid: "rcid-abc", ctx: "some-context" };

      storage.save(profileName, cid, metadata);

      const newStorage = new ChatMetadataStorage(logger);
      const result = newStorage.lookup(profileName, cid);

      expect(result).toEqual(metadata);
    });

    test("load hydrates the cache from disk", () => {
      const profileName = "default";
      const meta1 = { rid: "rid-1", rcid: "rcid-1", ctx: null };
      const meta2 = { rid: "rid-2", rcid: "rcid-2", ctx: null };

      storage.save(profileName, "conv-1", meta1);
      storage.save(profileName, "conv-2", meta2);

      const newStorage = new ChatMetadataStorage(logger);
      const result = newStorage.load(profileName);

      expect(result).toEqual({
        "conv-1": meta1,
        "conv-2": meta2,
      });
    });
  });

  describe("corrupt file handling", () => {
    test("load of a corrupt chat-metadata.json logs at debug level and returns an empty map without throwing", () => {
      const profileName = "default";
      const filePath = getProfileChatMetadataPath(profileName);
      const parentDir = path.dirname(filePath);
      fs.mkdirSync(parentDir, { recursive: true });
      fs.writeFileSync(filePath, "this is not json{{{", "utf-8");

      const debugCalls: string[] = [];
      const debugLogger = new Logger("test");
      const originalDebug = debugLogger.debug.bind(debugLogger);
      debugLogger.debug = mock((msg: string, ...args: unknown[]) => {
        debugCalls.push(msg);
        originalDebug(msg, ...args);
      });

      const newStorage = new ChatMetadataStorage(debugLogger);
      const result = newStorage.load(profileName);

      expect(result).toEqual({});
      expect(debugCalls.some((c) => c.includes("corrupt file"))).toBe(true);
    });

    test("load of a missing version field returns empty map", () => {
      const profileName = "default";
      const filePath = getProfileChatMetadataPath(profileName);
      const parentDir = path.dirname(filePath);
      fs.mkdirSync(parentDir, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify({ entries: {} }), "utf-8");

      const debugCalls: string[] = [];
      const debugLogger = new Logger("test");
      const originalDebug = debugLogger.debug.bind(debugLogger);
      debugLogger.debug = mock((msg: string, ...args: unknown[]) => {
        debugCalls.push(msg);
        originalDebug(msg, ...args);
      });

      const newStorage = new ChatMetadataStorage(debugLogger);
      const result = newStorage.load(profileName);

      expect(result).toEqual({});
      expect(debugCalls.some((c) => c.includes("unknown version"))).toBe(true);
    });

    test("load of a wrong-shape object returns empty map", () => {
      const profileName = "default";
      const filePath = getProfileChatMetadataPath(profileName);
      const parentDir = path.dirname(filePath);
      fs.mkdirSync(parentDir, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify({ version: 1, entries: "not-an-object" }), "utf-8");

      const newStorage = new ChatMetadataStorage(logger);
      const result = newStorage.load(profileName);

      expect(result).toEqual({});
    });
  });

  describe("failure isolation", () => {
    test("save updates in-memory map even when disk write fails", () => {
      const profileName = "default";
      const cid = "conv-1";
      const metadata = { rid: "rid-1", rcid: "rcid-1", ctx: null };

      const newStorage = new ChatMetadataStorage(logger);
      const filePath = getProfileChatMetadataPath(profileName);
      const parentDir = path.dirname(filePath);
      fs.mkdirSync(parentDir, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify({ version: 1, entries: {} }), "utf-8");
      fs.chmodSync(parentDir, 0o444);

      try {
        newStorage.save(profileName, cid, metadata);
      } catch {
      }

      fs.chmodSync(parentDir, 0o755);

      expect(newStorage.lookup(profileName, cid)).toEqual(metadata);
    });
  });

  describe("listCids", () => {
    test("returns all cids for a profile", () => {
      const profileName = "default";
      storage.save(profileName, "conv-1", { rid: "r1", rcid: "rc1", ctx: null });
      storage.save(profileName, "conv-2", { rid: "r2", rcid: "rc2", ctx: null });
      storage.save(profileName, "conv-3", { rid: "r3", rcid: "rc3", ctx: null });

      const cids = storage.listCids(profileName);

      expect(cids.sort()).toEqual(["conv-1", "conv-2", "conv-3"]);
    });

    test("returns empty array for profile with no cids", () => {
      const cids = storage.listCids("nonexistent");
      expect(cids).toEqual([]);
    });
  });

  describe("persistence", () => {
    test("data survives across storage instances", () => {
      const profileName = "default";
      const cid = "conv-persist";
      const metadata = { rid: "rid-p", rcid: "rcid-p", ctx: "context-data" };

      storage.save(profileName, cid, metadata);

      const newStorage = new ChatMetadataStorage(logger);
      expect(newStorage.lookup(profileName, cid)).toEqual(metadata);
      expect(newStorage.listCids(profileName)).toContain(cid);
    });

    test("no file written when profile has no data", () => {
      const profileName = "default";
      const filePath = getProfileChatMetadataPath(profileName);

      const newStorage = new ChatMetadataStorage(logger);
      newStorage.load(profileName);

      expect(existsFile(filePath)).toBe(false);
    });
  });
});
