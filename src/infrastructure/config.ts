import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  getConfigDir as _getConfigDir,
  getProfilesDir as _getProfilesDir,
  getProfilePath as _getProfilePath,
  getDefaultProfileMarkerPath,
  DEFAULT_PROFILE_MARKER,
} from "./path-utils.ts";

function getConfigDir(): string {
  return _getConfigDir();
}

function getProfilesDir(): string {
  return _getProfilesDir();
}

function getProfilePath(name: string): string {
  return _getProfilePath(name);
}

function getDefaultProfileName(): string {
  const marker = getDefaultProfileMarkerPath();
  if (existsSync(marker)) {
    return readFileSync(marker, "utf-8").trim();
  }
  return "default";
}

function setDefaultProfileName(name: string): void {
  const marker = getDefaultProfileMarkerPath();
  const dir = dirname(marker);
  mkdirSync(dir, { recursive: true });
  writeFileSync(marker, name, "utf-8");
}

function listProfiles(): string[] {
  const profilesPath = getProfilesDir();
  if (!existsSync(profilesPath)) return [];
  return readdirSync(profilesPath)
    .filter((entry) => {
      const fullPath = join(profilesPath, entry);
      return statSync(fullPath).isDirectory() && entry !== DEFAULT_PROFILE_MARKER;
    })
    .sort();
}

function ensureConfigDir(): string {
  const configDir = getConfigDir();
  mkdirSync(configDir, { recursive: true });
  mkdirSync(getProfilesDir(), { recursive: true });
  return configDir;
}

export {
  getConfigDir,
  getProfilesDir,
  getProfilePath,
  getDefaultProfileName,
  setDefaultProfileName,
  listProfiles,
  ensureConfigDir,
};
