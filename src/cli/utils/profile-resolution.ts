import type { CliCommandContext } from "../command-registry.ts";
import { AuthenticationError } from "../../core/errors.ts";
import type { SessionProbeResult } from "../../auth/cookie-session.ts";
import { awaitRotationsWithNotice } from "./rotation-await.ts";

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
    // Wait-timeout contract (fix-8 commands spec): the helper's hint is only
    // true while the rotation is STILL in flight — a landed rotation must
    // stay silent and fall through to the probe/reclassify below unchanged.
    // The gate preserves the notice timing: it is printed only when the arm
    // actually reported a rotation in flight.
    if (context.cookieSession.rotationInFlight(explicitProfile)) {
      await awaitRotationsWithNotice(context.cookieSession, [explicitProfile]);
    }
    // gh#25: classify through probeDetailed so a rejected chats probe reports
    // "unreachable" — the recovery offer downstream must not fire for a
    // transport failure. A probeDetailed rejection here means the jar itself
    // is unreadable; that keeps the historical "dead" fallback.
    const probe: SessionProbeResult = await context.cookieSession
      .probeDetailed(explicitProfile)
      .catch(() => ({ state: "dead" as const, chatCount: 0 }));
    if (probe.state !== "live") {
      // gh#25: unreachable is a transport failure — rotating cookies cannot
      // fix it, so the remediation hint differs from the re-auth path.
      const remediation = probe.state === "unreachable"
        ? "Check connectivity and re-run the command."
        : `Run 'gemiterm auth --renew ${explicitProfile}' to re-authenticate.`;
      throw new AuthenticationError(
        `Profile '${explicitProfile}' session is ${probe.state} after the rotation wait. ${remediation}`,
        { profileName: explicitProfile, sessionState: probe.state },
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
