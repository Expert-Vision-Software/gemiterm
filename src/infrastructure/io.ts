/**
 * Canonical home for file-system access in `src/`.
 *
 * No other source file in `src/` may import from `node:fs` or `node:path`
 * directly.
 *
 * This module is intentionally small: every function is a thin wrapper around
 * the corresponding `node:fs` call with consistent semantics (always-recursive
 * `mkdir`, safe returns, structured errors). New functions should be added
 * only when at least 2 call sites need them; ad-hoc single-use helpers should
 * stay in the call site.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getProfileHasChatsPath } from "./path-utils.ts";

export class IOError extends Error {
  override readonly name = "IOError";
  constructor(message: string, public readonly cause?: Error) {
    super(message);
  }
}

function wrap(op: string, path: string, cause?: Error): IOError {
  return new IOError(`${op} failed for ${path}`, cause);
}

function ensureDir(path: string): void {
  try {
    mkdirSync(path, { recursive: true });
  } catch (err) {
    throw wrap("ensureDir", path, err instanceof Error ? err : undefined);
  }
}

function existsFile(path: string): boolean {
  return existsSync(path);
}

function readTextFile(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch (err) {
    throw wrap("readTextFile", path, err instanceof Error ? err : undefined);
  }
}

/**
 * Reads the file at `path` and returns its UTF-8 content. On any error
 * (ENOENT, EACCES, EISDIR), returns the empty string `""` instead of
 * throwing.
 *
 * Note: the `""` return conflates "file does not exist" with "file exists
 * but is empty". This is appropriate for callers that only need a string
 * for `.includes()` / `.trim()` checks (for example, the WSL `/proc/version`
 * the two cases should use `readTextFile` and handle the `IOError`.
 */
function safeReadTextFile(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

function writeTextFile(path: string, content: string): void {
  const absolute = resolve(path);
  const parent = dirname(absolute);
  ensureDir(parent);
  try {
    writeFileSync(absolute, content, "utf-8");
  } catch (err) {
    throw wrap("writeTextFile", absolute, err instanceof Error ? err : undefined);
  }
}

function readJsonFile<T = unknown>(path: string): T {
  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    throw wrap("readJsonFile", path, err instanceof Error ? err : undefined);
  }
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new IOError(
      `readJsonFile: invalid JSON in ${path}: ${err instanceof Error ? err.message : String(err)}`,
      err instanceof Error ? err : undefined,
    );
  }
}

function writeJsonFile(path: string, data: unknown): void {
  writeTextFile(path, JSON.stringify(data, null, 2));
}

function removeDir(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch (err) {
    throw wrap("removeDir", path, err instanceof Error ? err : undefined);
  }
}

function removeFile(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch (err) {
    throw wrap("removeFile", path, err instanceof Error ? err : undefined);
  }
}

function renameDir(src: string, dest: string): void {
  try {
    renameSync(src, dest);
  } catch (err) {
    throw new IOError(
      `renameDir: ${src} -> ${dest}: ${err instanceof Error ? err.message : String(err)}`,
      err instanceof Error ? err : undefined,
    );
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function listSubdirectories(path: string): string[] {
  if (!existsSync(path)) {
    return [];
  }
  return readdirSync(path).filter((entry) => {
    try {
      return statSync(join(path, entry)).isDirectory();
    } catch {
      return false;
    }
  });
}

function getFileMtime(path: string): Date | null {
  try {
    return statSync(path).mtime;
  } catch {
    return null;
  }
}

function writeProfileHasChats(profileName: string): void {
  writeTextFile(getProfileHasChatsPath(profileName), "");
}

function readProfileHasChats(profileName: string): boolean {
  return existsFile(getProfileHasChatsPath(profileName));
}

export {
  ensureDir,
  existsFile,
  getFileMtime,
  readTextFile,
  safeReadTextFile,
  writeTextFile,
  readJsonFile,
  writeJsonFile,
  removeDir,
  removeFile,
  renameDir,
  isDirectory,
  listSubdirectories,
  writeProfileHasChats,
  readProfileHasChats,
};
