import { existsFile, getFileMtime, removeFile, writeFileExclusive } from "../infrastructure/io.ts";
import { getRefreshRunnerLockPath } from "../infrastructure/path-utils.ts";
import { sleep } from "./timing.ts";

// Single-flight mediation for the detached refresh-runner (openspec/changes/
// fix-rotation-dead-end): concurrent CLI invocations arming the same stale
// profile each used to spawn their own runner, and the runners collided on
// the shared playwright session name and persistent profile dir. The lock is
// acquired by the spawning parent and released by the runner child; a crashed
// child leaves the lock to the stale sweep below.
const STALE_RUNNER_LOCK_MS = 120_000;
const SWEEP_RETRY_MS = 25;

export interface RunnerLockIo {
  existsFile(path: string): Promise<boolean>;
  getFileMtime(path: string): Promise<Date | null>;
  removeFile(path: string): Promise<void>;
  writeFileExclusive(path: string, content: string): Promise<boolean>;
}

const defaultIo: RunnerLockIo = { existsFile, getFileMtime, removeFile, writeFileExclusive };

export interface RunnerLock {
  tryAcquire(profile: string): Promise<boolean>;
  release(profile: string): Promise<void>;
}

// Contract: never rejects - a locking failure must not block a refresh (same
// axiom as the spawn log fd). On an io failure the acquire resolves true so
// the spawn proceeds unguarded.
export function makeRunnerLock(io: RunnerLockIo = defaultIo, staleMs = STALE_RUNNER_LOCK_MS): RunnerLock {
  async function tryAcquire(profile: string): Promise<boolean> {
    const lockPath = getRefreshRunnerLockPath(profile);
    try {
      if (await io.writeFileExclusive(lockPath, String(process.pid))) {
        return true;
      }
      const mtime = await io.getFileMtime(lockPath);
      if (mtime !== null && Date.now() - mtime.getTime() > staleMs) {
        await io.removeFile(lockPath);
        await sleep(SWEEP_RETRY_MS);
        return await io.writeFileExclusive(lockPath, String(process.pid));
      }
      return false;
    } catch {
      return true;
    }
  }

  async function release(profile: string): Promise<void> {
    try {
      await io.removeFile(getRefreshRunnerLockPath(profile));
    } catch {
      // best effort only - the stale sweep covers a lingering lock
    }
  }

  return { tryAcquire, release };
}
