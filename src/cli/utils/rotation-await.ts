import chalk from "chalk";
import type { CookieSession } from "../../auth/cookie-session.ts";

// Shared await-in-flight-rotations choreography (fix-8 review dedup): one dim
// stderr notice before the bounded wait (only when at least one profile is
// passed — callers gate on `rotationInFlight` first), then one yellow
// still-in-flight hint after it, naming only the profiles whose rotation is
// STILL in flight (a landed rotation must stay silent). Returns the profiles
// whose rotation landed, in input order. `reRunTarget` keeps the hint tail
// byte-stable per call site: the default matches the read-command wording
// ("re-run the command."); `list` passes its pinned "'gemiterm list'" form.
export async function awaitRotationsWithNotice(
  cookieSession: CookieSession,
  profiles: string[],
  reRunTarget = "the command",
): Promise<string[]> {
  if (profiles.length === 0) return [];

  console.error(chalk.dim("Session refresh in progress — waiting for it to finish…"));
  const landed = await Promise.all(
    profiles.map((profile) => cookieSession.waitForRotation(profile).catch(() => null)),
  );
  const stillInFlight = profiles
    .filter((_, i) => landed[i] === null)
    .filter((profile) => cookieSession.rotationInFlight(profile));
  if (stillInFlight.length > 0) {
    console.error(chalk.yellow(
      `Session refresh still in progress for ${stillInFlight.length === 1 ? "profile" : "profiles"} '${stillInFlight.join("', '")}' — wait a few seconds and re-run ${reRunTarget}.`,
    ));
  }
  return profiles.filter((_, i) => landed[i] !== null);
}

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

  const landed = await awaitRotationsWithNotice(cookieSession, [profile]);

  if (landed.length > 0) {
    return await operation();
  }

  if (threw) throw error;
  return result as T;
}
