import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { AuthenticationError } from "../../src/core/errors.ts";
import { runReauthFlow } from "../../src/cli/utils/reauth.ts";
import { CancellationError, NonInteractiveError } from "../../src/cli/utils/prompts.ts";
import type { AuthService } from "../../src/services/auth-service.ts";

function createMockAuthService() {
  return {
    authenticate: mock(async (_profileName?: string) => ({ cookies: [], expiresAt: null })),
  };
}

describe("runReauthFlow", () => {
  let authService: ReturnType<typeof createMockAuthService>;

  beforeEach(() => {
    authService = createMockAuthService();
  });

  afterEach(() => {
    mock.restore();
  });

  test("calls confirm prompt with the profile name and launches auth flow on confirm", async () => {
    const confirmPrompt = mock(async (_opts: { message: string; default?: boolean }) => true);
    const originalError = new AuthenticationError("original session expired");

    await runReauthFlow("default", {
      authService: authService as unknown as AuthService,
      confirmPrompt,
      originalError,
    });

    expect(confirmPrompt).toHaveBeenCalledTimes(1);
    const message = confirmPrompt.mock.calls[0]![0].message;
    expect(message).toContain("Session for profile 'default'");
    expect(message).toContain("Would you like to launch browser to re-authenticate?");
    expect(authService.authenticate).toHaveBeenCalledWith("default");
  });

  test("rethrows original AuthenticationError when user declines", async () => {
    const confirmPrompt = mock(async (_opts: { message: string; default?: boolean }) => false);
    const originalError = new AuthenticationError("original session expired");

    try {
      await runReauthFlow("default", {
        authService: authService as unknown as AuthService,
        confirmPrompt,
        originalError,
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBe(originalError);
    }

    expect(authService.authenticate).not.toHaveBeenCalled();
  });

  test("rethrows original AuthenticationError when prompt throws NonInteractiveError", async () => {
    const confirmPrompt = mock(async (_opts: { message: string; default?: boolean }) => {
      throw new NonInteractiveError("non-interactive");
    });
    const originalError = new AuthenticationError("original session expired");

    try {
      await runReauthFlow("default", {
        authService: authService as unknown as AuthService,
        confirmPrompt,
        originalError,
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBe(originalError);
    }

    expect(authService.authenticate).not.toHaveBeenCalled();
  });

  test("rethrows original AuthenticationError when prompt throws CancellationError", async () => {
    const confirmPrompt = mock(async (_opts: { message: string; default?: boolean }) => {
      throw new CancellationError("cancelled");
    });
    const originalError = new AuthenticationError("original session expired");

    try {
      await runReauthFlow("default", {
        authService: authService as unknown as AuthService,
        confirmPrompt,
        originalError,
      });
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBe(originalError);
    }

    expect(authService.authenticate).not.toHaveBeenCalled();
  });

  test("re-throws non-prompt errors unchanged", async () => {
    const confirmPrompt = mock(async (_opts: { message: string; default?: boolean }) => {
      throw new Error("unexpected");
    });
    const originalError = new AuthenticationError("original session expired");

    await expect(
      runReauthFlow("default", {
        authService: authService as unknown as AuthService,
        confirmPrompt,
        originalError,
      }),
    ).rejects.toThrow("unexpected");

    expect(authService.authenticate).not.toHaveBeenCalled();
  });

  test("uses the explicitly-provided profile name in the prompt message", async () => {
    const confirmPrompt = mock(async (_opts: { message: string; default?: boolean }) => true);
    const originalError = new AuthenticationError("original session expired");

    await runReauthFlow("work", {
      authService: authService as unknown as AuthService,
      confirmPrompt,
      originalError,
    });

    const message = confirmPrompt.mock.calls[0]![0].message;
    expect(message).toContain("'work'");
    expect(authService.authenticate).toHaveBeenCalledWith("work");
  });
});
