import type { Cookie } from "../core/types.ts";
import { LockUnavailableError } from "../core/errors.ts";
import {
  existsFile,
  getFileMtime,
  readJsonFile,
  removeFile,
  writeFileExclusive,
  writeTextFileAtomic,
} from "../infrastructure/io.ts";
import { getProfileLockPath, getProfilePath } from "../infrastructure/path-utils.ts";
import { sleep } from "./timing.ts";

const LOCK_RETRY_MS = 100;
const STALE_LOCK_MS = 120_000;
const CAS_LOCK_TIMEOUT_MS = 10_000;
const FULL_LOCK_TIMEOUT_MS = 90_000;

export type CookieSnapshot = Map<string, string>;

export interface LoadedJar {
  cookies: Cookie[];
  snapshot: CookieSnapshot;
}

export interface CookieStoreOptions {
  retryMs?: number;
  staleLockMs?: number;
  casLockTimeoutMs?: number;
  fullLockTimeoutMs?: number;
}

interface StorageState {
  cookies?: Cookie[];
}

function cookieKey(c: Pick<Cookie, "name" | "domain" | "path">): string {
  return `${c.name}|${c.domain}|${c.path}`;
}

async function readDiskCookies(filePath: string): Promise<Cookie[]> {
  if (!(await existsFile(filePath))) {
    return [];
  }
  const state = await readJsonFile<StorageState>(filePath);
  return Array.isArray(state.cookies) ? state.cookies : [];
}

async function acquireLock(lockPath: string, timeoutMs: number, retryMs: number, staleLockMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await existsFile(lockPath)) {
      const mtime = await getFileMtime(lockPath);
      if (mtime !== null && Date.now() - mtime.getTime() > staleLockMs) {
        await removeFile(lockPath);
      }
    }
    if (await writeFileExclusive(lockPath, String(process.pid))) {
      return true;
    }
    if (Date.now() + retryMs > deadline) {
      return false;
    }
    await sleep(retryMs);
  }
}

async function releaseLock(lockPath: string): Promise<void> {
  await removeFile(lockPath);
}

export class CookieStore {
  private readonly retryMs: number;
  private readonly staleLockMs: number;
  private readonly casLockTimeoutMs: number;
  private readonly fullLockTimeoutMs: number;

  constructor(opts: CookieStoreOptions = {}) {
    this.retryMs = opts.retryMs ?? LOCK_RETRY_MS;
    this.staleLockMs = opts.staleLockMs ?? STALE_LOCK_MS;
    this.casLockTimeoutMs = opts.casLockTimeoutMs ?? CAS_LOCK_TIMEOUT_MS;
    this.fullLockTimeoutMs = opts.fullLockTimeoutMs ?? FULL_LOCK_TIMEOUT_MS;
  }

  async load(profile: string): Promise<LoadedJar> {
    const filePath = getProfilePath(profile);
    if (!(await existsFile(filePath))) {
      throw new Error(
        `No storage state found for profile '${profile}'. Run 'gemiterm auth' to authenticate.`,
      );
    }
    const state = await readJsonFile<StorageState>(filePath);
    const cookies = Array.isArray(state.cookies) ? state.cookies : [];
    const snapshot = new Map(cookies.map((c) => [cookieKey(c), c.value]));
    return { cookies, snapshot };
  }

  async save(profile: string, cookies: Cookie[], snapshot: CookieSnapshot): Promise<void> {
    const lockPath = getProfileLockPath(profile);
    const acquired = await acquireLock(lockPath, this.casLockTimeoutMs, this.retryMs, this.staleLockMs);
    try {
      await this.saveUnderLock(profile, cookies, snapshot);
    } finally {
      if (acquired) {
        await releaseLock(lockPath);
      }
    }
  }

  async saveFullJar(profile: string, cookies: Cookie[]): Promise<void> {
    const lockPath = getProfileLockPath(profile);
    const acquired = await acquireLock(lockPath, this.fullLockTimeoutMs, this.retryMs, this.staleLockMs);
    if (!acquired) {
      throw new LockUnavailableError(lockPath, this.fullLockTimeoutMs);
    }
    try {
      await writeTextFileAtomic(getProfilePath(profile), JSON.stringify({ cookies }, null, 2));
    } finally {
      await releaseLock(lockPath);
    }
  }

  async getJarMtime(profile: string): Promise<Date | null> {
    return await getFileMtime(getProfilePath(profile));
  }

  private async saveUnderLock(profile: string, cookies: Cookie[], snapshot: CookieSnapshot): Promise<void> {
    const filePath = getProfilePath(profile);
    const disk = await readDiskCookies(filePath);
    const diskValues = new Map(disk.map((c) => [cookieKey(c), c.value]));
    const targets = new Map(cookies.map((c) => [cookieKey(c), c]));

    const merged: Cookie[] = [];
    const seen = new Set<string>();

    for (const diskCookie of disk) {
      const key = cookieKey(diskCookie);
      seen.add(key);
      const target = targets.get(key);
      const snapValue = snapshot.get(key);
      if (target) {
        if (snapValue === undefined) {
          merged.push(target);
        } else if (diskValues.get(key) === snapValue || diskCookie.value === target.value) {
          merged.push(target);
        } else {
          merged.push(diskCookie);
        }
      } else if (snapValue !== undefined && diskCookie.value === snapValue) {
        continue;
      } else {
        merged.push(diskCookie);
      }
    }

    for (const target of cookies) {
      const key = cookieKey(target);
      if (!seen.has(key)) {
        merged.push(target);
      }
    }

    await writeTextFileAtomic(filePath, JSON.stringify({ cookies: merged }, null, 2));
  }
}
