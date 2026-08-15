import type { CliCommandContext } from "../command-registry.ts";
import { AuthenticationError } from "../../core/errors.ts";

export async function resolveProfile(
  context: CliCommandContext,
  conversationId: string,
  explicitProfile?: string,
): Promise<string | null> {
  const activeProfiles = await context.cookieSession.activeProfiles();

  if (explicitProfile) {
    if (!activeProfiles.includes(explicitProfile)) {
      throw new AuthenticationError(
        `Profile '${explicitProfile}' has no valid session. Run 'gemiterm auth --renew ${explicitProfile}' to refresh it.`,
      );
    }
    return explicitProfile;
  }

  if (activeProfiles.length <= 1) {
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
