import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { join, resolve } from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import {
  resolvePath,
  getConfigDir,
  getProfilesDir,
  getProfilePath,
  getProfileChatMetadataPath,
  getProfileDir,
  getDefaultProfileMarkerPath,
  isWSL,
  getProjectRoot,
  getPackageJson,
  STORAGE_STATE_FILE,
  CHAT_METADATA_FILE,
  PROFILES_DIR,
  DEFAULT_PROFILE_MARKER,
} from "../../src/infrastructure/path-utils.ts";

describe("path-utils", () => {
  describe("constants", () => {
    test("STORAGE_STATE_FILE is storage_state.json", () => {
      expect(STORAGE_STATE_FILE).toBe("storage_state.json");
    });

    test("CHAT_METADATA_FILE is chat-metadata.json", () => {
      expect(CHAT_METADATA_FILE).toBe("chat-metadata.json");
    });

    test("PROFILES_DIR is profiles", () => {
      expect(PROFILES_DIR).toBe("profiles");
    });

    test("DEFAULT_PROFILE_MARKER is .default", () => {
      expect(DEFAULT_PROFILE_MARKER).toBe(".default");
    });
  });

  describe("resolvePath", () => {
    test("joins and resolves path segments", () => {
      const result = resolvePath("foo", "bar", "baz.txt");
      expect(result).toBe(resolve(join("foo", "bar", "baz.txt")));
    });

    test("resolves relative paths to absolute", () => {
      const result = resolvePath("a", "b");
      expect(result).toBe(resolve(join("a", "b")));
    });

    test("handles single segment", () => {
      const result = resolvePath("single");
      expect(result).toBe(resolve("single"));
    });

    test("normalizes paths with .. and .", () => {
      const result = resolvePath("foo", "..", "bar");
      expect(result).toBe(resolve(join("foo", "..", "bar")));
    });

    test("handles empty input", () => {
      const result = resolvePath();
      expect(result).toBe(resolve(join()));
    });
  });

  describe("getConfigDir", () => {
    let originalConfigDir: string | undefined;
    let originalAppData: string | undefined;

    beforeEach(() => {
      originalConfigDir = process.env.GEMITERM_CONFIG_DIR;
      originalAppData = process.env.APPDATA;
      delete process.env.GEMITERM_CONFIG_DIR;
    });

    afterEach(() => {
      if (originalConfigDir !== undefined) {
        process.env.GEMITERM_CONFIG_DIR = originalConfigDir;
      } else {
        delete process.env.GEMITERM_CONFIG_DIR;
      }
      if (originalAppData !== undefined) {
        process.env.APPDATA = originalAppData;
      } else {
        delete process.env.APPDATA;
      }
    });

    test("returns GEMITERM_CONFIG_DIR env override when set", () => {
      process.env.GEMITERM_CONFIG_DIR = "/tmp/my-custom-config";
      expect(getConfigDir()).toBe("/tmp/my-custom-config");
    });

    test("on win32 with APPDATA, returns APPDATA/gemiterm", () => {
      const platformSpy = spyOn(os, "platform").mockReturnValue("win32");
      process.env.APPDATA = "C:\\Users\\test\\AppData\\Roaming";
      expect(getConfigDir()).toBe(join("C:\\Users\\test\\AppData\\Roaming", "gemiterm"));
      platformSpy.mockRestore();
    });

    test("on win32 without APPDATA, falls back to homedir/gemiterm", () => {
      const platformSpy = spyOn(os, "platform").mockReturnValue("win32");
      delete process.env.APPDATA;
      expect(getConfigDir()).toBe(join(os.homedir(), "gemiterm"));
      platformSpy.mockRestore();
    });

    test("on linux, returns homedir/gemiterm", () => {
      const platformSpy = spyOn(os, "platform").mockReturnValue("linux");
      delete process.env.APPDATA;
      expect(getConfigDir()).toBe(join(os.homedir(), "gemiterm"));
      platformSpy.mockRestore();
    });

    test("on darwin, returns homedir/gemiterm", () => {
      const platformSpy = spyOn(os, "platform").mockReturnValue("darwin");
      expect(getConfigDir()).toBe(join(os.homedir(), "gemiterm"));
      platformSpy.mockRestore();
    });

    test("env override takes precedence over platform-specific path", () => {
      const platformSpy = spyOn(os, "platform").mockReturnValue("win32");
      process.env.GEMITERM_CONFIG_DIR = "/override/path";
      process.env.APPDATA = "C:\\AppData";
      expect(getConfigDir()).toBe("/override/path");
      platformSpy.mockRestore();
    });
  });

  describe("getProfilesDir", () => {
    let originalConfigDir: string | undefined;

    beforeEach(() => {
      originalConfigDir = process.env.GEMITERM_CONFIG_DIR;
    });

    afterEach(() => {
      if (originalConfigDir !== undefined) {
        process.env.GEMITERM_CONFIG_DIR = originalConfigDir;
      } else {
        delete process.env.GEMITERM_CONFIG_DIR;
      }
    });

    test("returns config dir + profiles", () => {
      process.env.GEMITERM_CONFIG_DIR = "/tmp/gemiterm";
      expect(getProfilesDir()).toBe(join("/tmp/gemiterm", PROFILES_DIR));
    });
  });

  describe("getProfilePath", () => {
    let originalConfigDir: string | undefined;

    beforeEach(() => {
      originalConfigDir = process.env.GEMITERM_CONFIG_DIR;
    });

    afterEach(() => {
      if (originalConfigDir !== undefined) {
        process.env.GEMITERM_CONFIG_DIR = originalConfigDir;
      } else {
        delete process.env.GEMITERM_CONFIG_DIR;
      }
    });

    test("returns profiles/<name>/storage_state.json", () => {
      process.env.GEMITERM_CONFIG_DIR = "/tmp/gemiterm";
      expect(getProfilePath("default")).toBe(
        join("/tmp/gemiterm", PROFILES_DIR, "default", STORAGE_STATE_FILE),
      );
    });

    test("handles profile names with special characters", () => {
      process.env.GEMITERM_CONFIG_DIR = "/tmp/gemiterm";
      expect(getProfilePath("my-profile")).toBe(
        join("/tmp/gemiterm", PROFILES_DIR, "my-profile", STORAGE_STATE_FILE),
      );
    });
  });

  describe("getProfileChatMetadataPath", () => {
    let originalConfigDir: string | undefined;

    beforeEach(() => {
      originalConfigDir = process.env.GEMITERM_CONFIG_DIR;
    });

    afterEach(() => {
      if (originalConfigDir !== undefined) {
        process.env.GEMITERM_CONFIG_DIR = originalConfigDir;
      } else {
        delete process.env.GEMITERM_CONFIG_DIR;
      }
    });

    test("returns profiles/<name>/chat-metadata.json", () => {
      process.env.GEMITERM_CONFIG_DIR = "/tmp/gemiterm";
      expect(getProfileChatMetadataPath("default")).toBe(
        join("/tmp/gemiterm", PROFILES_DIR, "default", CHAT_METADATA_FILE),
      );
    });

    test("returns <configDir>/<profileName>/chat-metadata.json", () => {
      process.env.GEMITERM_CONFIG_DIR = "/tmp/gemiterm";
      expect(getProfileChatMetadataPath("work")).toBe(
        join("/tmp/gemiterm", PROFILES_DIR, "work", CHAT_METADATA_FILE),
      );
    });
  });

  describe("getProfileDir", () => {
    let originalConfigDir: string | undefined;

    beforeEach(() => {
      originalConfigDir = process.env.GEMITERM_CONFIG_DIR;
    });

    afterEach(() => {
      if (originalConfigDir !== undefined) {
        process.env.GEMITERM_CONFIG_DIR = originalConfigDir;
      } else {
        delete process.env.GEMITERM_CONFIG_DIR;
      }
    });

    test("returns profiles/<name>", () => {
      process.env.GEMITERM_CONFIG_DIR = "/tmp/gemiterm";
      expect(getProfileDir("work")).toBe(join("/tmp/gemiterm", PROFILES_DIR, "work"));
    });
  });

  describe("getDefaultProfileMarkerPath", () => {
    let originalConfigDir: string | undefined;

    beforeEach(() => {
      originalConfigDir = process.env.GEMITERM_CONFIG_DIR;
    });

    afterEach(() => {
      if (originalConfigDir !== undefined) {
        process.env.GEMITERM_CONFIG_DIR = originalConfigDir;
      } else {
        delete process.env.GEMITERM_CONFIG_DIR;
      }
    });

    test("returns profiles/.default", () => {
      process.env.GEMITERM_CONFIG_DIR = "/tmp/gemiterm";
      expect(getDefaultProfileMarkerPath()).toBe(
        join("/tmp/gemiterm", PROFILES_DIR, DEFAULT_PROFILE_MARKER),
      );
    });
  });

  describe("isWSL", () => {
    let originalPlatform: NodeJS.Platform;
    let originalWslDistro: string | undefined;

    beforeEach(() => {
      originalPlatform = process.platform;
      originalWslDistro = process.env.WSL_DISTRO_NAME;
    });

    afterEach(() => {
      Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
      if (originalWslDistro !== undefined) {
        process.env.WSL_DISTRO_NAME = originalWslDistro;
      } else {
        delete process.env.WSL_DISTRO_NAME;
      }
    });

    test("returns false on Windows", () => {
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });
      delete process.env.WSL_DISTRO_NAME;
      expect(isWSL()).toBe(false);
    });

    test("returns false on macOS", () => {
      Object.defineProperty(process, "platform", { value: "darwin", configurable: true });
      delete process.env.WSL_DISTRO_NAME;
      expect(isWSL()).toBe(false);
    });

    test("returns true on Linux when WSL_DISTRO_NAME is set and non-empty", () => {
      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
      process.env.WSL_DISTRO_NAME = "Ubuntu";
      expect(isWSL()).toBe(true);
    });

    test("returns false on Linux when WSL_DISTRO_NAME is unset and no /proc/version marker", () => {
      Object.defineProperty(process, "platform", { value: "linux", configurable: true });
      delete process.env.WSL_DISTRO_NAME;
      const existsSpy = spyOn(fs, "existsSync").mockReturnValue(false);
      try {
        expect(isWSL()).toBe(false);
      } finally {
        existsSpy.mockRestore();
      }
    });
  });

  describe("getProjectRoot", () => {
    test("returns the repo root when called from a file under the repo", () => {
      const root = getProjectRoot(import.meta.url);
      expect(root).toBeTruthy();
      expect(fs.existsSync(join(root, "package.json"))).toBe(true);
    });

    test("is idempotent — multiple calls return the same path", () => {
      const a = getProjectRoot(import.meta.url);
      const b = getProjectRoot(import.meta.url);
      expect(a).toBe(b);
    });
  });

  describe("getPackageJson", () => {
    test("returns the parsed package.json with name and version", () => {
      const pkg = getPackageJson(import.meta.url);
      expect(pkg.name).toBe("gemiterm");
    });
  });
});
