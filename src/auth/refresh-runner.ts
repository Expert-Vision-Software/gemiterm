#!/usr/bin/env bun

import { Logger } from "../infrastructure/logger.ts";
import { PlaywrightCliDriver } from "../services/playwright-cli-driver.ts";
import { CookieStore } from "./cookie-store.ts";
import { BrowserRefresher } from "./browser-refresher.ts";
import { PSIDTS_COOKIE_NAME } from "./auth-constants.ts";
import { findRoutableCookieValue } from "./cookie-validation.ts";
import { joinPath, getLogFilePath, getConfigDir, resolvePath } from "../infrastructure/path-utils.ts";
import { openAppendFd } from "../infrastructure/io.ts";

export function refreshRunnerEntryPath(): string {
  return joinPath(import.meta.dir, "refresh-runner.ts");
}

export interface DetachedSpawnOptions {
  stdin: "ignore";
  stdout: number | "ignore";
  stderr: number | "ignore";
  detached: boolean;
  env: Record<string, string | undefined>;
}

export interface DetachedSpawnDeps {
  openLogFd?: (path: string) => number;
  spawn?: (cmd: string[], options: DetachedSpawnOptions) => { exited: Promise<number> };
}

export function spawnDetachedRefreshRunner(profile: string, deps: DetachedSpawnDeps = {}): void {
  const spawn = deps.spawn ?? ((cmd: string[], options: DetachedSpawnOptions) => Bun.spawn(cmd, options));
  let output: number | "ignore" = "ignore";
  try {
    output = (deps.openLogFd ?? openAppendFd)(getLogFilePath());
  } catch {
    // a logging failure must never block a refresh (spec: "Detached refresh-runner
    // survives the CLI and is observable", openspec/changes/fix-1-cookie-session-core)
  }
  const proc = spawn([process.execPath, refreshRunnerEntryPath(), profile], {
    stdin: "ignore",
    stdout: output,
    stderr: output,
    detached: true,
    env: { ...process.env, GEMITERM_CONFIG_DIR: resolvePath(getConfigDir()) },
  });
  proc.exited.catch(() => {});
}

export interface RunRefreshDeps {
  refresher: Pick<BrowserRefresher, "rotatePsidts">;
  cookieStore: Pick<CookieStore, "load">;
  logger: Logger;
}

export async function runRefresh(profile: string, deps: RunRefreshDeps): Promise<{ rotated: boolean }> {
  deps.logger.info(`refresh-runner(${profile}): starting (pid=${process.pid})`);
  let baseline: string | null = null;
  try {
    const { cookies } = await deps.cookieStore.load(profile);
    baseline = findRoutableCookieValue(cookies, PSIDTS_COOKIE_NAME);
  } catch (err) {
    deps.logger.info(
      `refresh-runner: no stored jar for profile '${profile}' (${err instanceof Error ? err.message : String(err)}); refreshing with null baseline`,
    );
  }

  try {
    const result = await deps.refresher.rotatePsidts(profile, baseline);
    deps.logger.info(`refresh-runner(${profile}): rotated=${result.rotated}`);
    return { rotated: result.rotated };
  } catch (err) {
    deps.logger.warn(
      `refresh-runner(${profile}) failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return { rotated: false };
  }
}

if (import.meta.main) {
  const profile = process.argv[2];
  if (!profile) {
    process.stderr.write("usage: bun src/auth/refresh-runner.ts <profile>\n");
    process.exit(1);
  }
  const logger = new Logger("refresh-runner");
  await runRefresh(profile, {
    refresher: new BrowserRefresher({
      driver: new PlaywrightCliDriver(),
      cookieStore: new CookieStore(),
      logger,
    }),
    cookieStore: new CookieStore(),
    logger,
  });
  process.exit(0);
}

