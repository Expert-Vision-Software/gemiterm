/**
 * Canonical home for file-system access in `src/`.
 *
 * No other source file in `src/` may import from `node:fs` or `node:path`
 * directly.
 *
 * This module is intentionally small: every function is a thin async wrapper
 * around the corresponding `node:fs/promises` call with consistent semantics
 * (always-recursive `mkdir`, safe returns, structured errors). New functions
 * should be added only when at least 2 call sites need them; ad-hoc
 * single-use helpers should stay in the call site.
 */

import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { mkdirSync, openSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export class IOError extends Error {
  override readonly name = "IOError";
  constructor(message: string, public readonly cause?: Error) {
    super(message);
  }
}

function wrap(op: string, path: string, cause?: Error): IOError {
  return new IOError(`${op} failed for ${path}`, cause);
}

async function ensureDir(path: string): Promise<void> {
  try {
    await mkdir(path, { recursive: true });
  } catch (err) {
    throw wrap("ensureDir", path, err instanceof Error ? err : undefined);
  }
}

async function existsFile(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function readTextFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
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
 * probe in `path-utils.ts`). Callers that must distinguish
 * the two cases should use `readTextFile` and handle the `IOError`.
 */
async function safeReadTextFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf-8");
  } catch {
    return "";
  }
}

async function writeTextFile(path: string, content: string): Promise<void> {
  const absolute = resolve(path);
  const parent = dirname(absolute);
  await ensureDir(parent);
  try {
    await writeFile(absolute, content, "utf-8");
  } catch (err) {
    throw wrap("writeTextFile", absolute, err instanceof Error ? err : undefined);
  }
}

async function readJsonFile<T = unknown>(path: string): Promise<T> {
  let raw: string;
  try {
    raw = await readFile(path, "utf-8");
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

async function writeJsonFile(path: string, data: unknown): Promise<void> {
  await writeTextFile(path, JSON.stringify(data, null, 2));
}

/**
 * Creates the file at `path` with `content` only if it does not already
 * exist (the `wx` exclusive-create flag). Returns `true` when the file was
 * created, `false` when it already existed — the cross-process lock
 * acquisition primitive.
 */
async function writeFileExclusive(path: string, content: string): Promise<boolean> {
  const absolute = resolve(path);
  try {
    await writeFile(absolute, content, { encoding: "utf-8", flag: "wx" });
    return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException | null)?.code;
    if (code === "EEXIST") {
      return false;
    }
    throw wrap("writeFileExclusive", absolute, err instanceof Error ? err : undefined);
  }
}

/**
 * Atomic text write: writes to a temp file in the target's directory, then
 * renames it over the target. Readers observe either the old or the new
 * content, never a partial write. The temp file is removed on failure.
 */
async function writeTextFileAtomic(path: string, content: string): Promise<void> {
  const absolute = resolve(path);
  const parent = dirname(absolute);
  await ensureDir(parent);
  const tmp = join(
    parent,
    `.${basename(absolute)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  try {
    await writeFile(tmp, content, "utf-8");
    await rename(tmp, absolute);
  } catch (err) {
    try {
      await rm(tmp, { force: true });
    } catch {
    }
    throw wrap("writeTextFileAtomic", absolute, err instanceof Error ? err : undefined);
  }
}

async function removeDir(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true });
  } catch (err) {
    throw wrap("removeDir", path, err instanceof Error ? err : undefined);
  }
}

async function removeFile(path: string): Promise<void> {
  try {
    await rm(path, { force: true });
  } catch (err) {
    throw wrap("removeFile", path, err instanceof Error ? err : undefined);
  }
}

async function renameDir(src: string, dest: string): Promise<void> {
  try {
    await rename(src, dest);
  } catch (err) {
    throw new IOError(
      `renameDir: ${src} -> ${dest}: ${err instanceof Error ? err.message : String(err)}`,
      err instanceof Error ? err : undefined,
    );
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function listSubdirectories(path: string): Promise<string[]> {
  if (!(await existsFile(path))) {
    return [];
  }
  const entries = await readdir(path);
  const subdirectories: string[] = [];
  for (const entry of entries) {
    try {
      if ((await stat(join(path, entry))).isDirectory()) {
        subdirectories.push(entry);
      }
    } catch {
    }
  }
  return subdirectories;
}

async function getFileMtime(path: string): Promise<Date | null> {
  try {
    return (await stat(path)).mtime;
  } catch {
    return null;
  }
}

function openAppendFd(path: string): number {
  const absolute = resolve(path);
  try {
    mkdirSync(dirname(absolute), { recursive: true });
    return openSync(absolute, "a");
  } catch (err) {
    throw wrap("openAppendFd", absolute, err instanceof Error ? err : undefined);
  }
}

export {
  ensureDir,
  existsFile,
  getFileMtime,
  openAppendFd,
  readTextFile,
  safeReadTextFile,
  writeTextFile,
  writeFileExclusive,
  writeTextFileAtomic,
  readJsonFile,
  writeJsonFile,
  removeDir,
  removeFile,
  renameDir,
  isDirectory,
  listSubdirectories,
};
