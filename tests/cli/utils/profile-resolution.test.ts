import { describe, test, expect, mock } from "bun:test";
import { resolveProfile } from "../../../src/cli/utils/profile-resolution.ts";
import type { CliCommandContext } from "../../../src/cli/command-registry.ts";
import { AuthenticationError } from "../../../src/core/errors.ts";

function makeContext(
  activeProfiles: string[],
  findProfileForConversation: (id: string) => Promise<string | null>,
): CliCommandContext {
  return {
    verbose: false,
    profileAuthManager: {
      getActiveProfiles: mock(() => activeProfiles),
      findProfileForConversation: mock(findProfileForConversation),
      ensureAuthenticated: mock(() => ({ secure_1psid: "", secure_1psidts: null })),
    },
  } as unknown as CliCommandContext;
}

describe("resolveProfile", () => {
  test("returns null when only one profile is active (use default client)", async () => {
    const ctx = makeContext(["default"], async () => null);
    const result = await resolveProfile(ctx, "conv-1");
    expect(result).toBeNull();
  });

  test("returns null when no profiles are active", async () => {
    const ctx = makeContext([], async () => null);
    const result = await resolveProfile(ctx, "conv-1");
    expect(result).toBeNull();
  });

  test("auto-discovers owning profile across active profiles", async () => {
    const ctx = makeContext(
      ["dhb-work", "evs-diegohb"],
      async (id) => (id === "conv-evs" ? "evs-diegohb" : null),
    );
    const result = await resolveProfile(ctx, "conv-evs");
    expect(result).toBe("evs-diegohb");
  });

  test("throws AuthenticationError when no active profile owns the conversation", async () => {
    const ctx = makeContext(["dhb-work", "evs-diegohb"], async () => null);
    await expect(resolveProfile(ctx, "conv-orphan")).rejects.toThrow(
      AuthenticationError,
    );
    await expect(resolveProfile(ctx, "conv-orphan")).rejects.toThrow(
      /Could not find a profile that owns/,
    );
  });

  test("explicit --profile short-circuits discovery when the profile is active", async () => {
    const ctx = makeContext(
      ["dhb-work", "evs-diegohb"],
      async () => {
        throw new Error("discovery should not be called when --profile is given");
      },
    );
    const result = await resolveProfile(ctx, "conv-1", "evs-diegohb");
    expect(result).toBe("evs-diegohb");
  });

  test("throws AuthenticationError when --profile names a profile with no valid session", async () => {
    const ctx = makeContext(["dhb-work"], async () => null);
    await expect(resolveProfile(ctx, "conv-1", "expired-profile")).rejects.toThrow(
      AuthenticationError,
    );
    await expect(resolveProfile(ctx, "conv-1", "expired-profile")).rejects.toThrow(
      /has no valid session/,
    );
  });
});