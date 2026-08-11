import type { AuthService } from "../../services/auth-service.ts";
import { CancellationError, NonInteractiveError } from "./prompts.ts";

export interface ReauthDeps {
  authService: AuthService;
  confirmPrompt: (opts: { message: string; default?: boolean }) => Promise<boolean>;
  originalError: Error;
}

export async function runReauthFlow(
  profileName: string | undefined,
  deps: ReauthDeps,
): Promise<void> {
  try {
    const name = profileName ?? "";
    const answer = await deps.confirmPrompt({
      message: `Session for profile '${name}' has expired. Would you like to launch browser to re-authenticate? (y/n)`,
      default: true,
    });
    if (!answer) throw deps.originalError;
  } catch (error) {
    if (error instanceof CancellationError || error instanceof NonInteractiveError) {
      throw deps.originalError;
    }
    throw error;
  }
  await deps.authService.authenticate(profileName);
}
