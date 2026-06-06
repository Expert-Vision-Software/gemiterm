import { describe, test, expect, beforeEach, afterEach, spyOn } from "bun:test";
import { join, resolve } from "node:path";
import * as os from "node:os";
import {
  resolvePath,
  getConfigDir,
  getProfilesDir,
  getProfilePath,
  getProfileDir,
  getDefaultProfileMarkerPath,
  STORAGE_STATE_FILE,
  PROFILES_DIR,
  DEFAULT_PROFILE_MARKER,
} from "../../src/infrastructure/path-utils.ts";

describe("path-utils", () => {
  describe("constants", () => {
    test("STORAGE_STATE_FILE is storage_state.json", () => {
      expect(STORAGE_STATE_FILE).toBe("storage_state.json");
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

    test("on win32 without APPDATA, falls back to homedir/.config/gemiterm", () => {
      const platformSpy = spyOn(os, "platform").mockReturnValue("win32");
      delete process.env.APPDATA;
      expect(getConfigDir()).toBe(join(os.homedir(), ".config", "gemiterm"));
      platformSpy.mockRestore();
    });

    test("on linux, returns homedir/.config/gemiterm", () => {
      const platformSpy = spyOn(os, "platform").mockReturnValue("linux");
      delete process.env.APPDATA;
      expect(getConfigDir()).toBe(join(os.homedir(), ".config", "gemiterm"));
      platformSpy.mockRestore();
    });

    test("on darwin, returns homedir/.config/gemiterm", () => {
      const platformSpy = spyOn(os, "platform").mockReturnValue("darwin");
      expect(getConfigDir()).toBe(join(os.homedir(), ".config", "gemiterm"));
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
});
