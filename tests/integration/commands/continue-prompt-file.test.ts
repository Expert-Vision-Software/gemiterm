import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { ContinueCommand } from "../../../src/cli/commands/continue-command.ts";
import { Mediator } from "../../../src/core/mediator.ts";
import { COMMAND_TYPES, type SendMessageCommandResult } from "../../../src/core/command-handlers.ts";
import type { CliCommandContext } from "../../../src/cli/command-registry.ts";
import { writeFileSync, existsSync, unlinkSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("continue command --prompt-file option", () => {
  let command: ContinueCommand;
  let context: CliCommandContext;
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;
  let mediatorSendSpy: ReturnType<typeof spyOn>;
  const tempFiles: string[] = [];

  function makeTempFile(content: string): string {
    const path = join(tmpdir(), `continue-prompt-file-test-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    writeFileSync(path, content, "utf-8");
    tempFiles.push(path);
    return path;
  }

  beforeEach(() => {
    command = new ContinueCommand();
    context = {
      verbose: false,
      mediator: new Mediator(),
      profileAuthManager: {
        getActiveProfiles: mock(() => ["default"]),
        findProfileForConversation: mock(() => "default"),
        ensureAuthenticated: mock(() => ({ secure_1psid: "", secure_1psidts: null })),
      } as unknown as CliCommandContext["profileAuthManager"],
    };
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
    exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__exit__:${code ?? "undefined"}`);
    }) as never);
    mediatorSendSpy = spyOn(context.mediator, "send").mockResolvedValue({
      response: "Hello from Gemini!",
    } as SendMessageCommandResult);
  });

  afterEach(() => {
    mock.restore();
    logSpy.mockRestore();
    errorSpy.mockRestore();
    for (const p of tempFiles) {
      if (existsSync(p)) {
        try { unlinkSync(p); } catch {}
      }
    }
    tempFiles.length = 0;
  });

  test("reads file content and sends it via SEND_MESSAGE to the given conversation", async () => {
    const content = "Hello from a prompt file";
    const path = makeTempFile(content);

    await command.execute(["conv-123", "--prompt-file", path], context);

    expect(mediatorSendSpy).toHaveBeenCalledTimes(1);
    const sentCommand = mediatorSendSpy.mock.calls[0][0] as { type: string; payload: { conversationId: string; message: string } };
    expect(sentCommand.type).toBe(COMMAND_TYPES.SEND_MESSAGE);
    expect(sentCommand.payload.conversationId).toBe("conv-123");
    expect(sentCommand.payload.message).toBe(content);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("sends the ENTIRE content of a file larger than 2048 code units without truncation", async () => {
    const content = "a".repeat(5000);
    const path = makeTempFile(content);

    await command.execute(["conv-123", "--prompt-file", path], context);

    expect(mediatorSendSpy).toHaveBeenCalledTimes(1);
    const sentCommand = mediatorSendSpy.mock.calls[0][0] as { payload: { message: string } };
    expect(sentCommand.payload.message.length).toBe(5000);
    expect(sentCommand.payload.message).toBe(content);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("reads multi-byte content from a file larger than 2048 code units without truncation", async () => {
    const emoji = "\u{1F600}";
    const content = emoji.repeat(1500);
    const path = makeTempFile(content);

    await command.execute(["conv-123", "--prompt-file", path], context);

    expect(mediatorSendSpy).toHaveBeenCalledTimes(1);
    const sentCommand = mediatorSendSpy.mock.calls[0][0] as { payload: { message: string } };
    expect(sentCommand.payload.message.length).toBe(3000);
    expect(sentCommand.payload.message).toBe(content);
  });

  test("works with the -f short alias", async () => {
    const content = "Short alias works";
    const path = makeTempFile(content);

    await command.execute(["conv-123", "-f", path], context);

    expect(mediatorSendSpy).toHaveBeenCalledTimes(1);
    const sentCommand = mediatorSendSpy.mock.calls[0][0] as { payload: { message: string } };
    expect(sentCommand.payload.message).toBe(content);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("works with --prompt-file before the conversation_id", async () => {
    const content = "Order independent";
    const path = makeTempFile(content);

    await command.execute(["--prompt-file", path, "conv-xyz"], context);

    expect(mediatorSendSpy).toHaveBeenCalledTimes(1);
    const sentCommand = mediatorSendSpy.mock.calls[0][0] as { payload: { conversationId: string; message: string } };
    expect(sentCommand.payload.conversationId).toBe("conv-xyz");
    expect(sentCommand.payload.message).toBe(content);
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("errors and exits when --prompt-file is given without a path", async () => {
    let thrown: Error | null = null;
    try {
      await command.execute(["conv-123", "--prompt-file"], context);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).not.toBeNull();
    expect(thrown?.message).toBe("__exit__:1");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mediatorSendSpy).not.toHaveBeenCalled();

    const stderr = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stderr).toContain("--prompt-file");
    expect(stderr).toContain("path");
  });

  test("errors when the file does not exist (error message contains the path)", async () => {
    const missingPath = join(tmpdir(), `continue-prompt-file-missing-${Date.now()}.txt`);

    let thrown: Error | null = null;
    try {
      await command.execute(["conv-123", "--prompt-file", missingPath], context);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).not.toBeNull();
    expect(thrown?.message).toBe("__exit__:1");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mediatorSendSpy).not.toHaveBeenCalled();

    const stderr = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stderr).toContain("Error:");
    expect(stderr).toContain(missingPath);
  });

  test("errors when --prompt-file is used together with a positional message", async () => {
    const path = makeTempFile("from file");

    let thrown: Error | null = null;
    try {
      await command.execute(["conv-123", "from-cli", "--prompt-file", path], context);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).not.toBeNull();
    expect(thrown?.message).toBe("__exit__:1");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mediatorSendSpy).not.toHaveBeenCalled();

    const stderr = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stderr).toContain("--prompt-file");
    expect(stderr.toLowerCase()).toContain("positional");
  });

  test("errors when --prompt-file is given but no conversation_id is provided", async () => {
    const path = makeTempFile("from file");

    let thrown: Error | null = null;
    try {
      await command.execute(["--prompt-file", path], context);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).not.toBeNull();
    expect(thrown?.message).toBe("__exit__:1");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(mediatorSendSpy).not.toHaveBeenCalled();

    const stderr = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stderr).toContain("--prompt-file");
    expect(stderr).toContain("conversation_id");
  });

  test("file content is read from disk at call time (round-trip via readFileSync)", async () => {
    const content = "round-trip content with newlines\nand special chars: \u{1F4A1}\ttabbed";
    const path = makeTempFile(content);

    const onDisk = readFileSync(path, "utf-8");
    expect(onDisk).toBe(content);

    await command.execute(["conv-123", "--prompt-file", path], context);

    const sentCommand = mediatorSendSpy.mock.calls[0][0] as { payload: { message: string } };
    expect(sentCommand.payload.message).toBe(onDisk);
  });

  test("--help output includes --prompt-file and the -f alias", async () => {
    await command.execute(["--help"], context);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("--prompt-file");
    expect(output).toContain("-f");
    expect(output).toContain("path");
  });
});
