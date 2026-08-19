import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { offerExplicitProfileRecovery, resolveProfileWithRecovery } from "../../../src/cli/utils/recovery-offer.ts";
import { CancellationError, NonInteractiveError } from "../../../src/cli/utils/prompts.ts";
import { AuthenticationError } from "../../../src/core/errors.ts";
import type { CliCommandContext } from "../../../src/cli/command-registry.ts";
import { setStdinTty, restoreStdinTty } from "./tty-harness.ts";

function makeContext(recover: ReturnType<typeof mock>) {
  return {
    cookieSession: { recover },
  } as unknown as CliCommandContext;
}

describe("offerExplicitProfileRecovery", () => {
  let promptsModule: typeof import("../../../src/cli/utils/prompts.ts");

  beforeEach(async () => {
    promptsModule = await import("../../../src/cli/utils/prompts.ts");
  });

  afterEach(() => {
    mock.restore();
    restoreStdinTty();
  });

  test("interactive + accept: invokes recover and reports recovered=true", async () => {
    setStdinTty(true);
    const recover = mock(async () => ({}));
    const confirmSpy = spyOn(promptsModule, "confirm").mockResolvedValue(true);

    const result = await offerExplicitProfileRecovery(makeContext(recover), "p", "phantom");

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(recover).toHaveBeenCalledWith("p");
    expect(result.recovered).toBe(true);
  });

  test("interactive + decline: never invokes recover", async () => {
    setStdinTty(true);
    const recover = mock(async () => ({}));
    const confirmSpy = spyOn(promptsModule, "confirm").mockResolvedValue(false);

    const result = await offerExplicitProfileRecovery(makeContext(recover), "p", "phantom");

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(recover).not.toHaveBeenCalled();
    expect(result.recovered).toBe(false);
  });

  test("interactive + cancel: never invokes recover; returns decline", async () => {
    setStdinTty(true);
    const recover = mock(async () => ({}));
    spyOn(promptsModule, "confirm").mockRejectedValue(new CancellationError("cancel"));

    const result = await offerExplicitProfileRecovery(makeContext(recover), "p", "phantom");

    expect(recover).not.toHaveBeenCalled();
    expect(result.recovered).toBe(false);
  });

  test("non-interactive: rethrows as typed AuthenticationError naming profile+state", async () => {
    setStdinTty(false);
    const recover = mock(async () => ({}));
    spyOn(promptsModule, "confirm").mockRejectedValue(new NonInteractiveError("nope"));

    await expect(
      offerExplicitProfileRecovery(makeContext(recover), "p", "dead"),
    ).rejects.toBeInstanceOf(AuthenticationError);
    await expect(
      offerExplicitProfileRecovery(makeContext(recover), "p", "dead"),
    ).rejects.toMatchObject({ profileName: "p", sessionState: "dead" });
    expect(recover).not.toHaveBeenCalled();
  });
});

describe("resolveProfileWithRecovery", () => {
  let promptsModule: typeof import("../../../src/cli/utils/prompts.ts");

  beforeEach(async () => {
    promptsModule = await import("../../../src/cli/utils/prompts.ts");
  });

  afterEach(() => {
    mock.restore();
    restoreStdinTty();
  });

  function makeResolutionContext(recover: ReturnType<typeof mock>) {
    return {
      verbose: false,
      cookieSession: {
        activeProfiles: mock(() => ["stale"]),
        findProfileForConversation: mock(async () => null),
        ensureSession: mock(() => ({ secure_1psid: "psid", secure_1psidts: "ts" })),
        rotationInFlight: mock(() => false),
        waitForRotation: mock(async () => null),
        probe: mock(async () => "phantom" as const),
        recover,
      },
      listProfiles: mock(async () => ["stale"]),
    } as unknown as CliCommandContext;
  }

  test("accept: resolves to the explicit profile after recovery runs", async () => {
    setStdinTty(true);
    const recover = mock(async () => ({}));
    const confirmSpy = spyOn(promptsModule, "confirm").mockResolvedValue(true);

    const result = await resolveProfileWithRecovery(makeResolutionContext(recover), "conv-1", "stale");

    expect(result).toBe("stale");
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(recover).toHaveBeenCalledTimes(1);
    expect(recover).toHaveBeenCalledWith("stale");
  });

  test("decline: throws the original AuthenticationError instead of proceeding with the dead profile", async () => {
    setStdinTty(true);
    const recover = mock(async () => ({}));
    const confirmSpy = spyOn(promptsModule, "confirm").mockResolvedValue(false);

    let caught: unknown;
    try {
      await resolveProfileWithRecovery(makeResolutionContext(recover), "conv-1", "stale");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AuthenticationError);
    const authError = caught as AuthenticationError;
    expect(authError.profileName).toBe("stale");
    expect(authError.sessionState).toBe("phantom");
    expect(authError.message).toBe(
      "Profile 'stale' session is phantom after the rotation wait. Run 'gemiterm auth --renew stale' to re-authenticate.",
    );
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(recover).not.toHaveBeenCalled();
  });

  test("cancel (CancellationError maps to decline): throws the original AuthenticationError, no recovery", async () => {
    setStdinTty(true);
    const recover = mock(async () => ({}));
    spyOn(promptsModule, "confirm").mockRejectedValue(new CancellationError("cancel"));

    let caught: unknown;
    try {
      await resolveProfileWithRecovery(makeResolutionContext(recover), "conv-1", "stale");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AuthenticationError);
    expect((caught as AuthenticationError).profileName).toBe("stale");
    expect((caught as AuthenticationError).sessionState).toBe("phantom");
    expect(recover).not.toHaveBeenCalled();
  });

  test("non-interactive: throws typed naming profile+state (never silently proceeds)", async () => {
    setStdinTty(false);
    const recover = mock(async () => ({}));
    spyOn(promptsModule, "confirm").mockRejectedValue(new NonInteractiveError("nope"));

    let caught: unknown;
    try {
      await resolveProfileWithRecovery(makeResolutionContext(recover), "conv-1", "stale");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AuthenticationError);
    expect((caught as AuthenticationError).profileName).toBe("stale");
    expect((caught as AuthenticationError).sessionState).toBe("phantom");
    expect(recover).not.toHaveBeenCalled();
  });

  test("auto-discovery errors rethrow unchanged (no recovery offer)", async () => {
    setStdinTty(true);
    const recover = mock(async () => ({}));
    const confirmSpy = spyOn(promptsModule, "confirm").mockResolvedValue(true);
    const ctx = {
      verbose: false,
      cookieSession: {
        activeProfiles: mock(() => ["a", "b"]),
        findProfileForConversation: mock(async () => null),
        recover,
      },
      listProfiles: mock(async () => ["a", "b"]),
    } as unknown as CliCommandContext;

    let caught: unknown;
    try {
      await resolveProfileWithRecovery(ctx, "conv-orphan", null);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AuthenticationError);
    expect((caught as AuthenticationError).message).toContain("Could not find a profile that owns");
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(recover).not.toHaveBeenCalled();
  });
});
