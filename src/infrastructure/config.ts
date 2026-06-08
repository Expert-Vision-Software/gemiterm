import {
  ensureDir,
  existsFile,
  isDirectory,
  listSubdirectories,
  readTextFile,
  writeTextFile,
} from "./io.ts";
import {
  getConfigDir,
  getDefaultProfileMarkerPath,
  getProfilesDir,
  dirnamePath,
  DEFAULT_PROFILE_MARKER,
} from "./path-utils.ts";

function getDefaultProfileName(): string {
  const marker = getDefaultProfileMarkerPath();
  if (existsFile(marker)) {
    return readTextFile(marker).trim() || "default";
  }
  return "default";
}

function setDefaultProfileName(name: string): void {
  const marker = getDefaultProfileMarkerPath();
  ensureDir(dirnamePath(marker));
  writeTextFile(marker, name);
}

function listProfiles(): string[] {
  const profilesPath = getProfilesDir();
  if (!isDirectory(profilesPath)) return [];
  return listSubdirectories(profilesPath)
    .filter((entry) => entry !== DEFAULT_PROFILE_MARKER)
    .sort();
}

function ensureConfigDir(): string {
  const configDir = getConfigDir();
  ensureDir(configDir);
  ensureDir(getProfilesDir());
  return configDir;
}

export {
  getConfigDir,
  getDefaultProfileName,
  setDefaultProfileName,
  listProfiles,
  ensureConfigDir,
};
