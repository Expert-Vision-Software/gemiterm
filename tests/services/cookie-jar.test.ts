import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CookieJar } from "../../src/services/cookie-jar.ts";
import { CookieStorageService } from "../../src/services/cookie-storage-service.ts";
import { CookieStorage } from "../../src/infrastructure/storage.ts";
import { Logger } from "../../src/infrastructure/logger.ts";
import type { Cookie } from "../../src/core/types.ts";

const TEST_DIR = join(tmpdir(), "gemiterm-test-cookie-jar");
const logger = new Logger("test");
const PROFILE = "default";

function farFuture(): number {
  return Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
}

function c(name: string, value: string, domain = ".google.com", path = "/"): Cookie {
  return {
    name,
    value,
    domain,
    path,
    expires: farFuture(),
    httpOnly: true,
    secure: true,
    sameSite: "Lax" as const,
  };
}

beforeEach(() => {
  process.env.GEMITERM_CONFIG_DIR = TEST_DIR;
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  delete process.env.GEMITERM_CONFIG_DIR;
});

describe("CookieJar", () => {
  describe("replace", () => {
    test("saves cookies, overwriting the entire jar", () => {
      const storage = new CookieStorage();
      const cookieStorageService = new CookieStorageService({ cookieStorage: storage, logger });
      const jar = new CookieJar({ cookieStorageService, logger });

      jar.replace(PROFILE, [
        c("__Secure-1PSID", "psid1"),
        c("__Secure-1PSIDTS", "psidts1"),
        c("SID", "sid1"),
      ]);

      const loaded = storage.load(PROFILE);
      expect(loaded).toHaveLength(3);
      expect(loaded.find((x) => x.name === "__Secure-1PSID")?.value).toBe("psid1");
    });

    test("replace overwrites previous cookies completely", () => {
      const storage = new CookieStorage();
      const cookieStorageService = new CookieStorageService({ cookieStorage: storage, logger });
      const jar = new CookieJar({ cookieStorageService, logger });

      jar.replace(PROFILE, [
        c("__Secure-1PSID", "psid1"),
        c("__Secure-1PSIDTS", "psidts1"),
        c("SID", "sid1"),
        c("HSID", "hsid1"),
      ]);

      jar.replace(PROFILE, [
        c("__Secure-1PSID", "psid2"),
        c("__Secure-1PSIDTS", "psidts2"),
      ]);

      const loaded = storage.load(PROFILE);
      expect(loaded).toHaveLength(2);
      expect(loaded.find((x) => x.name === "__Secure-1PSID")?.value).toBe("psid2");
      expect(loaded.find((x) => x.name === "SID")).toBeUndefined();
    });
  });

  describe("upsert", () => {
    test("merges by (name, domain, path) key — updates matching entries, adds new ones", () => {
      const storage = new CookieStorage();
      const cookieStorageService = new CookieStorageService({ cookieStorage: storage, logger });
      const jar = new CookieJar({ cookieStorageService, logger });

      jar.replace(PROFILE, [
        c("__Secure-1PSID", "psid1"),
        c("__Secure-1PSIDTS", "psidts1"),
        c("SID", "sid1"),
      ]);

      jar.upsert(PROFILE, [
        c("__Secure-1PSID", "psid-new", ".google.com", "/"),
        c("HSID", "hsid-new"),
      ]);

      const loaded = storage.load(PROFILE);
      expect(loaded).toHaveLength(4);
      expect(loaded.find((x) => x.name === "__Secure-1PSID" && x.domain === ".google.com")?.value).toBe("psid-new");
      expect(loaded.find((x) => x.name === "HSID")?.value).toBe("hsid-new");
      expect(loaded.find((x) => x.name === "SID")?.value).toBe("sid1");
    });

    test("does not modify entries not present in upsert set", () => {
      const storage = new CookieStorage();
      const cookieStorageService = new CookieStorageService({ cookieStorage: storage, logger });
      const jar = new CookieJar({ cookieStorageService, logger });

      jar.replace(PROFILE, [
        c("__Secure-1PSID", "psid1"),
        c("__Secure-1PSIDTS", "psidts1"),
      ]);

      jar.upsert(PROFILE, [
        c("__Secure-1PSIDTS", "psidts-new", ".google.com", "/"),
      ]);

      const loaded = storage.load(PROFILE);
      expect(loaded).toHaveLength(2);
      expect(loaded.find((x) => x.name === "__Secure-1PSID")?.value).toBe("psid1");
      expect(loaded.find((x) => x.name === "__Secure-1PSIDTS")?.value).toBe("psidts-new");
    });

    test("same name, different domain are distinct entries", () => {
      const storage = new CookieStorage();
      const cookieStorageService = new CookieStorageService({ cookieStorage: storage, logger });
      const jar = new CookieJar({ cookieStorageService, logger });

      jar.replace(PROFILE, [
        c("__Secure-1PSID", "g-psid", ".google.com"),
        c("__Secure-1PSID", "yt-psid", ".youtube.com"),
      ]);

      jar.upsert(PROFILE, [
        c("__Secure-1PSID", "g-psid-new", ".google.com"),
      ]);

      const loaded = storage.load(PROFILE);
      expect(loaded).toHaveLength(2);
      expect(loaded.find((x) => x.name === "__Secure-1PSID" && x.domain === ".google.com")?.value).toBe("g-psid-new");
      expect(loaded.find((x) => x.name === "__Secure-1PSID" && x.domain === ".youtube.com")?.value).toBe("yt-psid");
    });

    test("same name, different path are distinct entries", () => {
      const storage = new CookieStorage();
      const cookieStorageService = new CookieStorageService({ cookieStorage: storage, logger });
      const jar = new CookieJar({ cookieStorageService, logger });

      jar.replace(PROFILE, [
        c("AUTH", "v1", ".google.com", "/"),
        c("AUTH", "v2", ".google.com", "/admin"),
      ]);

      jar.upsert(PROFILE, [
        c("AUTH", "v1-new", ".google.com", "/"),
      ]);

      const loaded = storage.load(PROFILE);
      expect(loaded).toHaveLength(2);
      expect(loaded.find((x) => x.name === "AUTH" && x.path === "/")?.value).toBe("v1-new");
      expect(loaded.find((x) => x.name === "AUTH" && x.path === "/admin")?.value).toBe("v2");
    });
  });
});
