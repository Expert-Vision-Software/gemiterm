import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { NewCommand } from "../../../src/cli/commands/new-command.ts";
import { Mediator } from "../../../src/core/mediator.ts";
import { COMMAND_TYPES } from "../../../src/core/command-handlers.ts";
import type { CliCommandContext } from "../../../src/cli/command-registry.ts";
import {
  checkArgLength,
  WINDOWS_COMMAND_LINE_ARG_LIMIT,
} from "../../../src/cli/utils/long-arg-guard.ts";

describe("long-arg-guard (bunx Windows 2048 UTF-16 code unit limit)", () => {
  describe("checkArgLength", () => {
    test("short ASCII arg is safe", () => {
      const result = checkArgLength("Hello");
      expect(result.safe).toBe(true);
      if (result.safe) {
        expect(result.arg).toBe("Hello");
      }
    });

    test("empty string is safe", () => {
      const result = checkArgLength("");
      expect(result.safe).toBe(true);
    });

    test("arg of exactly 2048 ASCII chars is safe (boundary inclusive)", () => {
      const arg = "a".repeat(2048);
      const result = checkArgLength(arg);
      expect(result.safe).toBe(true);
      expect(arg.length).toBe(WINDOWS_COMMAND_LINE_ARG_LIMIT);
    });

    test("arg of 2049 ASCII chars is unsafe (boundary + 1)", () => {
      const result = checkArgLength("a".repeat(2049));
      expect(result.safe).toBe(false);
    });

    test("arg of 5000 ASCII chars is unsafe with correct length and limit", () => {
      const result = checkArgLength("a".repeat(5000));
      expect(result.safe).toBe(false);
      if (!result.safe) {
        expect(result.length).toBe(5000);
        expect(result.limit).toBe(2048);
        expect(result.arg.length).toBe(5000);
      }
    });

    test("multi-byte surrogate pair input is measured in UTF-16 code units, not UTF-8 bytes", () => {
      const emoji = "\u{1F600}";
      expect(emoji.length).toBe(2);
      expect(Buffer.byteLength(emoji, "utf8")).toBe(4);

      const arg = emoji.repeat(1500);
      expect(arg.length).toBe(3000);
      expect(Buffer.byteLength(arg, "utf8")).toBe(6000);

      const result = checkArgLength(arg);
      expect(result.safe).toBe(false);
      if (!result.safe) {
        expect(result.length).toBe(3000);
        expect(result.limit).toBe(2048);
        expect(result.suggestion).toContain("3000");
        expect(result.suggestion).toContain("2048");
      }
    });

    test("multi-byte input at 2048 code unit boundary is still safe", () => {
      const emoji = "\u{1F600}";
      const arg = emoji.repeat(1024);
      expect(arg.length).toBe(2048);
      const result = checkArgLength(arg);
      expect(result.safe).toBe(true);
    });

    test("suggestion mentions stdin and a prompt-file workaround", () => {
      const result = checkArgLength("a".repeat(3000));
      expect(result.safe).toBe(false);
      if (!result.safe) {
        expect(result.suggestion.toLowerCase()).toContain("stdin");
        expect(result.suggestion).toContain("--prompt-file");
      }
    });

    test("suggestion references the Bun panic location for diagnostic context", () => {
      const result = checkArgLength("a".repeat(3000));
      expect(result.safe).toBe(false);
      if (!result.safe) {
        expect(result.suggestion).toContain("appendWindowsArgument");
      }
    });
  });
});

describe("NewCommand with long-arg guard", () => {
  let command: NewCommand;
  let context: CliCommandContext;
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;
  let sendSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    command = new NewCommand();
    context = {
      verbose: false,
      mediator: new Mediator(),
      profileAuthManager: {
        getActiveProfiles: mock(() => ["default"]),
        findProfileForConversation: mock(() => null),
        ensureAuthenticated: mock(() => ({ secure_1psid: "", secure_1psidts: null })),
      } as unknown as CliCommandContext["profileAuthManager"],
    };
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
    exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__exit__:${code ?? "undefined"}`);
    }) as never);
    sendSpy = spyOn(context.mediator, "send").mockResolvedValue({
      response: "Hello from Gemini!",
      conversationId: "conv-1",
    } as never);
  });

  afterEach(() => {
    mock.restore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });

  test("short message is sent to the mediator normally", async () => {
    await command.execute(["Hello"], context);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("message of exactly 2048 ASCII chars is sent normally (boundary)", async () => {
    const arg = "a".repeat(2048);
    await command.execute([arg], context);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("message of 2049 ASCII chars does not crash and exits with a clear error", async () => {
    const arg = "a".repeat(2049);
    let thrown: Error | null = null;
    try {
      await command.execute([arg], context);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).not.toBeNull();
    expect(thrown?.message).toBe("__exit__:1");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(sendSpy).not.toHaveBeenCalled();

    const stderr = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stderr).toContain("Error:");
    expect(stderr).toContain("2049");
    expect(stderr).toContain("2048");
    expect(stderr.toLowerCase()).toContain("stdin");
  });

  test("message of 5000 chars does not crash and exits with a clear error", async () => {
    const arg = "a".repeat(5000);
    let thrown: Error | null = null;
    try {
      await command.execute([arg], context);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).not.toBeNull();
    expect(thrown?.message).toBe("__exit__:1");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(sendSpy).not.toHaveBeenCalled();

    const stderr = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stderr).toContain("5000");
  });

  test("multi-byte message exceeding 2048 code units exits with clear error", async () => {
    const arg = "\u{1F600}".repeat(1500);
    let thrown: Error | null = null;
    try {
      await command.execute([arg], context);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).not.toBeNull();
    expect(thrown?.message).toBe("__exit__:1");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(sendSpy).not.toHaveBeenCalled();

    const stderr = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stderr).toContain("3000");
    expect(stderr).toContain("2048");
  });

  test("multi-byte message at 2048 code unit boundary is accepted (does not crash, no exit)", async () => {
    const arg = "\u{1F600}".repeat(1024);
    await command.execute([arg], context);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("long-arg guard runs before START_NEW_CHAT handler is invoked", async () => {
    const arg = "a".repeat(3000);
    try {
      await command.execute([arg], context);
    } catch {
    }
    const calledWith = sendSpy.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(calledWith).not.toContain(COMMAND_TYPES.START_NEW_CHAT);
  });
});
