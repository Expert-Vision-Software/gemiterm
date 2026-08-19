// Interactive recovery ladder for explicit-profile stale (fix-8). Mirrors
// `list`'s confirm ladder (list-command.ts) but applied to a single-profile
// read command: when `resolveProfile` arms an explicit profile, awaits an
// in-flight rotation, and still classifies non-live, the calling command
// shows the recovery confirm — interactive TTY accepts/rejects via the
// prompts facade, non-interactive rethrows the typed AuthenticationError
// (the spec's "must not silently route to another profile" requirement).
// `CancellationError` is treated as a decline (user cancel).
import chalk from "chalk";
import { runInteractiveConfirm } from "./prompts.ts";
import type { CliCommandContext } from "../command-registry.ts";
import type { SessionProbeResult } from "../../auth/cookie-session.ts";
import { AuthenticationError } from "../../core/errors.ts";
import { resolveProfile } from "./profile-resolution.ts";

export interface OfferRecoveryResult {
  recovered: boolean;
}

export async function offerExplicitProfileRecovery(
  context: CliCommandContext,
  profileName: string,
  state: SessionProbeResult["state"],
): Promise<OfferRecoveryResult> {
  return runInteractiveConfirm<OfferRecoveryResult>({
    message: `Profile '${profileName}' session is ${state} after the rotation wait. Attempt session recovery now?`,
    onAccept: async () => {
      await context.cookieSession.recover(profileName);
      return { recovered: true };
    },
    onDecline: async () => ({ recovered: false }),
    onNonInteractive: () => {
      console.error(chalk.yellow(
        `Profile '${profileName}' session is ${state} after the rotation wait — Run 'gemiterm auth --renew ${profileName}' to re-authenticate.`,
      ));
      throw new AuthenticationError(
        `Profile '${profileName}' session is ${state} after the rotation wait. Run 'gemiterm auth --renew ${profileName}' to re-authenticate.`,
        { profileName, sessionState: state },
      );
    },
  });
}

// One routing seam for the read commands (fix-8, design D1): resolve the
// profile, and when the EXPLICIT path arms stale and never reaches live,
// surface the interactive recovery offer instead of an instant typed
// failure. The auto-discovery path (no `-p`) never enters the recovery
// branch — its AuthenticationError names the conversation, not a stale
// profile, so it propagates unchanged (the facade's two-pass
// findProfileForConversation already awaited what it could).
export async function resolveProfileWithRecovery(
  context: CliCommandContext,
  conversationId: string,
  explicitProfile: string | null | undefined,
): Promise<string | null> {
  try {
    return await resolveProfile(context, conversationId, explicitProfile ?? undefined);
  } catch (error) {
    if (
      error instanceof AuthenticationError &&
      explicitProfile &&
      error.profileName === explicitProfile &&
      error.sessionState &&
      error.sessionState !== "live"
    ) {
      await offerExplicitProfileRecovery(context, error.profileName, error.sessionState);
      return explicitProfile;
    }
    throw error;
  }
}
