import chalk from "chalk";
import type { CliCommandContext } from "../command-registry.ts";
import { AuthenticationError } from "../../core/errors.ts";

// Explicit-profile path (fix-8): an explicit `-p <name>` is no longer
// required to classify `live` up front. We arm the profile (spawning a
// detached runner when the jar is stale), and if the arm reports a rotation
// in flight, we await it via the facade's bounded `waitForRotation`. Only
// after the rotation lands do we reclassify — still-not-live then surfaces
// failure handling in the calling command (interactive: recovery confirm
// mirroring `list`; non-interactive: typed error). The unknown-profile check
// (name not in the configured set) still fails fast: we never want to arm a
// profile the user didn't intend to use.
//
// The auto-discovery path (no `-p`) stays live-only for `findProfileForConversation`
// because the facade's second pass (stale-aware, post-rotation) handles
// stale owners there. This seam is what `fetch` / `continue` / `export` /
// `export-all` / `delete` route through.
export async function resolveProfile(
  context: CliCommandContext,
  conversationId: string,
  explicitProfile?: string,
): Promise<string | null> {
  if (explicitProfile) {
    const configured = await context.listProfiles();
    if (!configured.includes(explicitProfile)) {
      throw new AuthenticationError(
        `Profile '${explicitProfile}' is not a configured profile. Run 'gemiterm auth --add <name>' to create it.`,
      );
    }
    await context.cookieSession.ensureSession(explicitProfile);
    if (context.cookieSession.rotationInFlight(explicitProfile)) {
      console.error(chalk.dim("Session refresh in progress — waiting for it to finish…"));
      await context.cookieSession.waitForRotation(explicitProfile).catch(() => null);
    }
    const state = await context.cookieSession.probe(explicitProfile).catch(() => "dead" as const);
    if (state !== "live") {
      throw new AuthenticationError(
        `Profile '${explicitProfile}' session is ${state} after the rotation wait. Run 'gemiterm auth --renew ${explicitProfile}' to re-authenticate.`,
        { profileName: explicitProfile, sessionState: state },
      );
    }
    return explicitProfile;
  }

  // Auto-discovery: only short-circuit on a single configured profile. If
  // there are 2+ configured profiles (regardless of how many are currently
  // live — fix-8, gap 3), consult `findProfileForConversation` so its
  // two-pass lookup can resolve conversations owned by a stale-but-recovered
  // profile. The historical `activeProfiles.length <= 1` check misfired in
  // the field DHBGAMING2 case: 3 profiles, 1 live, 2 stale-armed → short-
  // circuit returned null, the stale owners were never consulted.
  const configuredProfiles = await context.listProfiles();
  if (configuredProfiles.length <= 1) {
    return null;
  }

  const profileName = await context.cookieSession.findProfileForConversation(conversationId);
  if (profileName === null) {
    throw new AuthenticationError(
      `Could not find a profile that owns conversation '${conversationId}'. Run 'gemiterm list --all-profiles' to see which profile it belongs to, or pass --profile <name> to specify it explicitly.`,
    );
  }
  return profileName;
}
