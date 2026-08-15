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

async function getDefaultProfileName(): Promise<string> {
  const marker = getDefaultProfileMarkerPath();
  if (await existsFile(marker)) {
    return (await readTextFile(marker)).trim() || "default";
  }
  return "default";
}

async function setDefaultProfileName(name: string): Promise<void> {
  const marker = getDefaultProfileMarkerPath();
  await ensureDir(dirnamePath(marker));
  await writeTextFile(marker, name);
}

async function listProfiles(): Promise<string[]> {
  const profilesPath = getProfilesDir();
  if (!(await isDirectory(profilesPath))) return [];
  return (await listSubdirectories(profilesPath))
    .filter((entry) => entry !== DEFAULT_PROFILE_MARKER)
    .sort();
}

async function ensureConfigDir(): Promise<string> {
  const configDir = getConfigDir();
  await ensureDir(configDir);
  await ensureDir(getProfilesDir());
  return configDir;
}

export {
  getConfigDir,
  getDefaultProfileName,
  setDefaultProfileName,
  listProfiles,
  ensureConfigDir,
};
