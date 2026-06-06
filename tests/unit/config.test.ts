import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, readdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  getDefaultProfileName,
  setDefaultProfileName,
  listProfiles,
  ensureConfigDir,
} from "../../src/infrastructure/config.ts";
import {
  setupTestConfig,
  teardownTestConfig,
} from "../setup.ts";

describe("config", () => {
  let configDir: string;
  let originalConfigDir: string | undefined;

  beforeEach(() => {
    originalConfigDir = process.env.GEMITERM_CONFIG_DIR;
    configDir = setupTestConfig();
  });

  afterEach(() => {
    teardownTestConfig({ GEMITERM_CONFIG_DIR: originalConfigDir });
  });

  describe("getDefaultProfileName", () => {
    test("returns 'default' when no marker file exists", () => {
      expect(getDefaultProfileName()).toBe("default");
    });

    test("returns the name from the marker file when it exists", () => {
      const profilesDir = join(configDir, "profiles");
      mkdirSync(profilesDir, { recursive: true });
      setDefaultProfileName("work");
      expect(getDefaultProfileName()).toBe("work");
    });

    test("trims whitespace from marker file content", () => {
      const profilesDir = join(configDir, "profiles");
      mkdirSync(profilesDir, { recursive: true });
      const markerPath = join(profilesDir, ".default");
      writeFileSync(markerPath, "  my-profile  \n", "utf-8");
      expect(getDefaultProfileName()).toBe("my-profile");
    });
  });

  describe("setDefaultProfileName", () => {
    test("creates marker file with the given name", () => {
      const markerPath = join(configDir, "profiles", ".default");
      expect(existsSync(markerPath)).toBe(false);

      setDefaultProfileName("personal");

      expect(existsSync(markerPath)).toBe(true);
      const content = readFileSync(markerPath, "utf-8");
      expect(content).toBe("personal");
    });

    test("creates profiles directory if it does not exist", () => {
      const profilesDir = join(configDir, "profiles");
      expect(existsSync(profilesDir)).toBe(false);

      setDefaultProfileName("work");

      expect(existsSync(profilesDir)).toBe(true);
    });

    test("overwrites existing marker file", () => {
      setDefaultProfileName("first");
      expect(getDefaultProfileName()).toBe("first");

      setDefaultProfileName("second");
      expect(getDefaultProfileName()).toBe("second");
    });
  });

  describe("listProfiles", () => {
    test("returns empty array when profiles directory does not exist", () => {
      const profilesDir = join(configDir, "profiles");
      expect(existsSync(profilesDir)).toBe(false);

      const profiles = listProfiles();

      expect(profiles).toEqual([]);
    });

    test("returns empty array when profiles directory exists but is empty", () => {
      mkdirSync(join(configDir, "profiles"), { recursive: true });

      const profiles = listProfiles();

      expect(profiles).toEqual([]);
    });

    test("returns sorted list of profile directories", () => {
      const profilesDir = join(configDir, "profiles");
      mkdirSync(join(profilesDir, "charlie"), { recursive: true });
      mkdirSync(join(profilesDir, "alpha"), { recursive: true });
      mkdirSync(join(profilesDir, "bravo"), { recursive: true });

      const profiles = listProfiles();

      expect(profiles).toEqual(["alpha", "bravo", "charlie"]);
    });

    test("excludes the default marker file (.default) from results", () => {
      const profilesDir = join(configDir, "profiles");
      mkdirSync(join(profilesDir, "work"), { recursive: true });
      mkdirSync(join(profilesDir, "personal"), { recursive: true });
      writeFileSync(join(profilesDir, ".default"), "work", "utf-8");

      const profiles = listProfiles();

      expect(profiles).toEqual(["personal", "work"]);
    });

    test("excludes files (only includes directories)", () => {
      const profilesDir = join(configDir, "profiles");
      mkdirSync(join(profilesDir, "valid-profile"), { recursive: true });
      writeFileSync(join(profilesDir, "not-a-profile.txt"), "data", "utf-8");

      const profiles = listProfiles();

      expect(profiles).toEqual(["valid-profile"]);
    });
  });

  describe("ensureConfigDir", () => {
    test("creates config directory when it does not exist", () => {
      rmSync(configDir, { recursive: true, force: true });

      ensureConfigDir();

      expect(existsSync(configDir)).toBe(true);
    });

    test("creates profiles directory inside config dir", () => {
      const profilesDir = join(configDir, "profiles");

      ensureConfigDir();

      expect(existsSync(profilesDir)).toBe(true);
    });

    test("returns the config directory path", () => {
      const result = ensureConfigDir();

      expect(result).toBe(configDir);
    });

    test("does not throw when directories already exist", () => {
      mkdirSync(join(configDir, "profiles"), { recursive: true });

      expect(() => ensureConfigDir()).not.toThrow();
    });
  });
});
