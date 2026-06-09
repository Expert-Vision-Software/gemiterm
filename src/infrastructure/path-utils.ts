import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { homedir, platform, tmpdir } from "node:os";

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

function joinPath(...parts: string[]): string {
  return join(...parts);
}

function dirnamePath(path: string): string {
  return dirname(path);
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

function getTempFilePath(prefix: string, extension = ".tmp"): string {
  const unique = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return join(tmpdir(), `${unique}${extension}`);
}

function isWSL(): boolean {
  if (process.platform !== "linux") {
    return false;
  }
  try {
    if (existsSync("/proc/version")) {
      const version = readFileSync("/proc/version", "utf-8").toLowerCase();
      if (version.includes("microsoft") || version.includes("wsl")) {
        return true;
      }
    }
  } catch {
    // ignore — fall through to env var check
  }
  const distro = process.env.WSL_DISTRO_NAME;
  return typeof distro === "string" && distro.length > 0;
}

function getProjectRoot(importMetaUrl?: string): string {
  const start = importMetaUrl
    ? dirname(new URL(importMetaUrl).pathname.replace(/^\/([A-Za-z]:)/, "$1"))
    : process.cwd();
  let dir = start;
  for (let i = 0; i < 32; i++) {
    if (existsSync(join(dir, "package.json"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  throw new Error(
    `getProjectRoot: could not find a 'package.json' in any parent of ${start}`,
  );
}

interface PackageJson {
  name: string;
  version: string;
  [key: string]: unknown;
}

const PACKAGE_JSON_FALLBACK: PackageJson = { name: "gemiterm", version: "unknown" };

function getPackageJson(importMetaUrl?: string): PackageJson {
  try {
    const root = getProjectRoot(importMetaUrl);
    const raw = readFileSync(join(root, "package.json"), "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as PackageJson;
    }
  } catch {
    // fall through to fallback
  }
  return PACKAGE_JSON_FALLBACK;
}

export {
  resolvePath,
  joinPath,
  dirnamePath,
  getConfigDir,
  getProfilesDir,
  getProfilePath,
  getProfileDir,
  getDefaultProfileMarkerPath,
  getTempFilePath,
  isWSL,
  getProjectRoot,
  getPackageJson,
  STORAGE_STATE_FILE,
  PROFILES_DIR,
  DEFAULT_PROFILE_MARKER,
};
