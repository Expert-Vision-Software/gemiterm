import { describe, test, expect, mock, spyOn } from "bun:test";
import { resolveProfile } from "../../../src/cli/utils/profile-resolution.ts";
import type { CliCommandContext } from "../../../src/cli/command-registry.ts";
import { AuthenticationError } from "../../../src/core/errors.ts";

interface MakeContextOpts {
  activeProfiles: string[];
  findProfileForConversation: (id: string) => Promise<string | null>;
  configuredProfiles?: string[];
  ensureSession?: ReturnType<typeof mock>;
  rotationInFlight?: ReturnType<typeof mock>;
  waitForRotation?: ReturnType<typeof mock>;
  probe?: ReturnType<typeof mock>;
}

function makeContext(opts: MakeContextOpts): CliCommandContext {
  return {
    verbose: false,
    cookieSession: {
      activeProfiles: mock(() => opts.activeProfiles),
      findProfileForConversation: mock(opts.findProfileForConversation),
      ensureSession: opts.ensureSession ?? mock(() => ({ secure_1psid: "", secure_1psidts: null })),
      rotationInFlight: opts.rotationInFlight ?? mock(() => false),
      waitForRotation: opts.waitForRotation ?? mock(async () => null),
      probe: opts.probe ?? mock(async () => "live" as const),
    },
    listProfiles: mock(async () => opts.configuredProfiles ?? opts.activeProfiles),
  } as unknown as CliCommandContext;
}

describe("resolveProfile", () => {
  test("returns null when only one profile is active (use default client)", async () => {
    const ctx = makeContext({ activeProfiles: ["default"], findProfileForConversation: async () => null });
    const result = await resolveProfile(ctx, "conv-1");
    expect(result).toBeNull();
  });

  test("returns null when no profiles are active", async () => {
    const ctx = makeContext({ activeProfiles: [], findProfileForConversation: async () => null });
    const result = await resolveProfile(ctx, "conv-1");
    expect(result).toBeNull();
  });

  test("auto-discovers owning profile across active profiles", async () => {
    const ctx = makeContext({
      activeProfiles: ["dhb-work", "evs-diegohb"],
      findProfileForConversation: async (id) => (id === "conv-evs" ? "evs-diegohb" : null),
    });
    const result = await resolveProfile(ctx, "conv-evs");
    expect(result).toBe("evs-diegohb");
  });

  test("throws AuthenticationError when no active profile owns the conversation", async () => {
    const ctx = makeContext({
      activeProfiles: ["dhb-work", "evs-diegohb"],
      findProfileForConversation: async () => null,
    });
    await expect(resolveProfile(ctx, "conv-orphan")).rejects.toThrow(
      AuthenticationError,
    );
    await expect(resolveProfile(ctx, "conv-orphan")).rejects.toThrow(
      /Could not find a profile that owns/,
    );
  });

  test("explicit --profile returns the named configured profile when it classifies live", async () => {
    const ensureSession = mock(() => ({ secure_1psid: "", secure_1psidts: null }));
    const ctx = makeContext({
      activeProfiles: ["dhb-work", "evs-diegohb"],
      configuredProfiles: ["dhb-work", "evs-diegohb"],
      findProfileForConversation: async () => {
        throw new Error("discovery should not be called when --profile is given");
      },
      ensureSession,
    });

    const result = await resolveProfile(ctx, "conv-1", "evs-diegohb");

    expect(result).toBe("evs-diegohb");
    expect(ensureSession).toHaveBeenCalledWith("evs-diegohb");
  });

  test("explicit --profile still resolves when the profile is not in activeProfiles but is configured", async () => {
    const ensureSession = mock(() => ({ secure_1psid: "", secure_1psidts: null }));
    const ctx = makeContext({
      activeProfiles: ["dhb-work"],
      configuredProfiles: ["dhb-work", "stale"],
      findProfileForConversation: async () => null,
      ensureSession,
      probe: mock(async () => "live" as const),
    });

    const result = await resolveProfile(ctx, "conv-1", "stale");

    expect(result).toBe("stale");
  });

  test("explicit --profile awaits the rotation when the arm reports in-flight and lands", async () => {
    const waitForRotation = mock(async () => ({ secure_1psid: "psid", secure_1psidts: "ts2", cookies: [] }));
    const ctx = makeContext({
      activeProfiles: ["stale"],
      configuredProfiles: ["stale"],
      findProfileForConversation: async () => null,
      rotationInFlight: mock(() => true),
      waitForRotation,
    });

    const result = await resolveProfile(ctx, "conv-1", "stale");

    expect(result).toBe("stale");
    expect(waitForRotation).toHaveBeenCalledWith("stale");
  });

  test("explicit --profile fails typed when the profile never reaches live (non-interactive)", async () => {
    const ctx = makeContext({
      activeProfiles: ["stale"],
      configuredProfiles: ["stale"],
      findProfileForConversation: async () => null,
      rotationInFlight: mock(() => true),
      waitForRotation: mock(async () => null),
      probe: mock(async () => "phantom" as const),
    });

    await expect(resolveProfile(ctx, "conv-1", "stale")).rejects.toThrow(
      AuthenticationError,
    );
    await expect(resolveProfile(ctx, "conv-1", "stale")).rejects.toThrow(/phantom/);
  });

  test("explicit --profile wait timeout with rotation still in flight prints the stderr hint naming the profile before the typed error", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const ctx = makeContext({
        activeProfiles: ["stale"],
        configuredProfiles: ["stale"],
        findProfileForConversation: async () => null,
        rotationInFlight: mock(() => true),
        waitForRotation: mock(async () => null),
        probe: mock(async () => "phantom" as const),
      });

      await expect(resolveProfile(ctx, "conv-1", "stale")).rejects.toThrow(
        AuthenticationError,
      );

      const stderr = errSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(stderr).toContain("Session refresh still in progress for profile 'stale'");
      expect(stderr).toContain("re-run the command");
    } finally {
      errSpy.mockRestore();
    }
  });

  test("explicit --profile wait timeout with the rotation no longer in flight prints no still-in-flight hint", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      let inFlight = true;
      const ctx = makeContext({
        activeProfiles: ["stale"],
        configuredProfiles: ["stale"],
        findProfileForConversation: async () => null,
        rotationInFlight: mock(() => {
          const value = inFlight;
          inFlight = false;
          return value;
        }),
        waitForRotation: mock(async () => null),
        probe: mock(async () => "phantom" as const),
      });

      await expect(resolveProfile(ctx, "conv-1", "stale")).rejects.toThrow(/phantom/);

      const stderr = errSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(stderr).toContain("waiting for it to finish");
      expect(stderr).not.toContain("still in progress");
    } finally {
      errSpy.mockRestore();
    }
  });

  test("explicit --profile rotation that lands prints no still-in-flight hint even when the profile stays non-live", async () => {
    const errSpy = spyOn(console, "error").mockImplementation(() => {});
    try {
      const ctx = makeContext({
        activeProfiles: ["stale"],
        configuredProfiles: ["stale"],
        findProfileForConversation: async () => null,
        rotationInFlight: mock(() => true),
        waitForRotation: mock(async () => ({ secure_1psid: "psid", secure_1psidts: "ts2", cookies: [] })),
        probe: mock(async () => "phantom" as const),
      });

      await expect(resolveProfile(ctx, "conv-1", "stale")).rejects.toThrow(/phantom/);

      const stderr = errSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(stderr).toContain("waiting for it to finish");
      expect(stderr).not.toContain("still in progress");
    } finally {
      errSpy.mockRestore();
    }
  });

  test("throws AuthenticationError when --profile names a profile that is not configured", async () => {
    const ctx = makeContext({
      activeProfiles: ["dhb-work"],
      configuredProfiles: ["dhb-work"],
      findProfileForConversation: async () => null,
    });

    await expect(resolveProfile(ctx, "conv-1", "expired-profile")).rejects.toThrow(
      AuthenticationError,
    );
    await expect(resolveProfile(ctx, "conv-1", "expired-profile")).rejects.toThrow(
      /not a configured profile/,
    );
  });
});
