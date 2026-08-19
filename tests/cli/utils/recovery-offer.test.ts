import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { offerExplicitProfileRecovery } from "../../../src/cli/utils/recovery-offer.ts";
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
