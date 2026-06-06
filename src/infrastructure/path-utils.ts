import { join, resolve, dirname } from "node:path";
import { homedir, platform } from "node:os";

const STORAGE_STATE_FILE = "storage_state.json";
const PROFILES_DIR = "profiles";
const DEFAULT_PROFILE_MARKER = ".default";

function _getConfigDir(): string {
  const envOverride = process.env.GEMITERM_CONFIG_DIR;
  if (envOverride) return envOverride;

  if (platform() === "win32") {
    const appData = process.env.APPDATA;
    if (appData) return join(appData, "gemiterm");
  }

  return join(homedir(), ".config", "gemiterm");
}

function resolvePath(...parts: string[]): string {
  return resolve(join(...parts));
}

function getConfigDir(): string {
  return _getConfigDir();
}

function getProfilesDir(): string {
  return join(getConfigDir(), PROFILES_DIR);
}

function getProfilePath(name: string): string {
  return join(getProfilesDir(), name, STORAGE_STATE_FILE);
}

function getProfileDir(name: string): string {
  return join(getProfilesDir(), name);
}

function getDefaultProfileMarkerPath(): string {
  return join(getProfilesDir(), DEFAULT_PROFILE_MARKER);
}

export {
  resolvePath,
  getConfigDir,
  getProfilesDir,
  getProfilePath,
  getProfileDir,
  getDefaultProfileMarkerPath,
  STORAGE_STATE_FILE,
  PROFILES_DIR,
  DEFAULT_PROFILE_MARKER,
};
