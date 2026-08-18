import chalk from "chalk";
import type { CookieSession } from "../../auth/cookie-session.ts";

// Single-profile rotation-await + single retry (openspec/changes/
// extend-rotation-wait-to-read-commands). Mirrors list's reactive-only stage:
// the caller only reaches this path after its read has already failed
// (thrown or resolved to the `isFailure` predicate). One wait, one retry, then
// fall through to the caller's existing failure handling unchanged. The happy
// path never consults the rotation state. All notices are stderr-only.
export async function runWithRotationRetry<T>(
  cookieSession: CookieSession,
  profile: string,
  operation: () => Promise<T>,
  isFailure: (result: T) => boolean,
): Promise<T> {
  let result: T | undefined;
  let error: unknown;
  let threw = false;
  try {
    result = await operation();
  } catch (err) {
    error = err;
    threw = true;
  }

  if (!threw && !isFailure(result as T)) {
    return result as T;
  }

  if (!cookieSession.rotationInFlight(profile)) {
    if (threw) throw error;
    return result as T;
  }

  console.error(chalk.dim("Session refresh in progress — waiting for it to finish…"));
  const landed = await cookieSession.waitForRotation(profile).catch(() => null);

  if (landed !== null) {
    return await operation();
  }

  if (cookieSession.rotationInFlight(profile)) {
    console.error(chalk.yellow(
      `Session refresh still in progress for profile '${profile}' — wait a few seconds and re-run the command.`,
    ));
  }

  if (threw) throw error;
  return result as T;
}
