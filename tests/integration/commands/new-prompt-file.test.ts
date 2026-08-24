import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { NewCommand } from "../../../src/cli/commands/new-command.ts";
import type { CliCommandContext } from "../../../src/cli/command-registry.ts";
import { writeFileSync, existsSync, unlinkSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

function makeClient() {
  const client: any = {
    startNewChat: mock(async (_msg: string): Promise<{ response: string; conversationId: string }> => ({ response: "Hello from Gemini!", conversationId: "conv-1" })),
    forProfile: mock((_name: string) => client),
  };
  return client;
}

describe("new command --prompt-file option", () => {
  let command: NewCommand;
  let context: CliCommandContext;
  let client: ReturnType<typeof makeClient>;
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;
  const tempFiles: string[] = [];

  function makeTempFile(content: string): string {
    const path = join(tmpdir(), `new-prompt-file-test-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    writeFileSync(path, content, "utf-8");
    tempFiles.push(path);
    return path;
  }

  beforeEach(() => {
    command = new NewCommand();
    client = makeClient();
    context = {
      verbose: false,
      cookieSession: {
        activeProfiles: mock(() => ["default"]),
        findProfileForConversation: mock(() => null),
        ensureSession: mock(() => ({ secure_1psid: "", secure_1psidts: null })),
      } as unknown as CliCommandContext["cookieSession"],
      getGeminiClient: () => client,
      listProfiles: () => [],
    };
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
    exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__exit__:${code ?? "undefined"}`);
    }) as never);
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

  test("reads file content and sends it as the message to the client", async () => {
    const content = "Hello from a prompt file";
    const path = makeTempFile(content);

    await command.execute(["--prompt-file", path], context);

    expect(client.startNewChat).toHaveBeenCalledTimes(1);
    expect(client.startNewChat).toHaveBeenCalledWith(content, "gemini-3-flash");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("sends the ENTIRE content of a file larger than 2048 code units without truncation", async () => {
    const content = "a".repeat(5000);
    const path = makeTempFile(content);

    await command.execute(["--prompt-file", path], context);

    expect(client.startNewChat).toHaveBeenCalledTimes(1);
    expect(client.startNewChat).toHaveBeenCalledWith(content, "gemini-3-flash");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("reads multi-byte content from a file larger than 2048 code units without truncation", async () => {
    const emoji = "\u{1F600}";
    const content = emoji.repeat(1500);
    const path = makeTempFile(content);

    await command.execute(["--prompt-file", path], context);

    expect(client.startNewChat).toHaveBeenCalledTimes(1);
    expect(client.startNewChat).toHaveBeenCalledWith(content, "gemini-3-flash");
  });

  test("works with the -f short alias", async () => {
    const content = "Short alias works";
    const path = makeTempFile(content);

    await command.execute(["-f", path], context);

    expect(client.startNewChat).toHaveBeenCalledTimes(1);
    expect(client.startNewChat).toHaveBeenCalledWith(content, "gemini-3-flash");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("errors and exits when --prompt-file is given without a path", async () => {
    let thrown: Error | null = null;
    try {
      await command.execute(["--prompt-file"], context);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).not.toBeNull();
    expect(thrown?.message).toBe("__exit__:1");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(client.startNewChat).not.toHaveBeenCalled();

    const stderr = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stderr).toContain("--prompt-file");
    expect(stderr).toContain("path");
  });

  test("errors and exits when -f is given without a path", async () => {
    let thrown: Error | null = null;
    try {
      await command.execute(["-f"], context);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).not.toBeNull();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(client.startNewChat).not.toHaveBeenCalled();
  });

  test("errors when the file does not exist (error message contains the path)", async () => {
    const missingPath = join(tmpdir(), `new-prompt-file-missing-${Date.now()}.txt`);

    let thrown: Error | null = null;
    try {
      await command.execute(["--prompt-file", missingPath], context);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).not.toBeNull();
    expect(thrown?.message).toBe("__exit__:1");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(client.startNewChat).not.toHaveBeenCalled();

    const stderr = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stderr).toContain("Error:");
    expect(stderr).toContain(missingPath);
  });

  test("errors when --prompt-file is used together with a positional message", async () => {
    const path = makeTempFile("from file");

    let thrown: Error | null = null;
    try {
      await command.execute(["from-cli", "--prompt-file", path], context);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).not.toBeNull();
    expect(thrown?.message).toBe("__exit__:1");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(client.startNewChat).not.toHaveBeenCalled();

    const stderr = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stderr).toContain("--prompt-file");
    expect(stderr.toLowerCase()).toContain("positional");
  });

  test("errors when --prompt-file is given and a positional message is given in the other order", async () => {
    const path = makeTempFile("from file");

    let thrown: Error | null = null;
    try {
      await command.execute(["--prompt-file", path, "from-cli"], context);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).not.toBeNull();
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(client.startNewChat).not.toHaveBeenCalled();
  });

  test("when --prompt-file is the only input and a valid file is given, the client receives file content (not empty)", async () => {
    const content = "non-empty prompt content";
    const path = makeTempFile(content);

    await command.execute(["--prompt-file", path], context);

    expect(client.startNewChat).toHaveBeenCalledTimes(1);
    expect(client.startNewChat).toHaveBeenCalledWith(content, "gemini-3-flash");
    expect(content).not.toBe("");
  });

  test("file content is read from disk at call time (round-trip via readFileSync)", async () => {
    const content = "round-trip content with newlines\nand special chars: \u{1F4A1}\ttabbed";
    const path = makeTempFile(content);

    const onDisk = readFileSync(path, "utf-8");
    expect(onDisk).toBe(content);

    await command.execute(["--prompt-file", path], context);

    expect(client.startNewChat).toHaveBeenCalledWith(onDisk, "gemini-3-flash");
  });

  test("--help output includes --prompt-file and the -f alias", async () => {
    await command.execute(["--help"], context);

    const output = logSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("--prompt-file");
    expect(output).toContain("-f");
    expect(output).toContain("path");
  });
});

describe("new command spillover: long positional arg is written to a temp file and loaded from there", () => {
  let command: NewCommand;
  let context: CliCommandContext;
  let client: ReturnType<typeof makeClient>;
  let logSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;
  let exitSpy: ReturnType<typeof spyOn>;
  const tempFiles: string[] = [];

  function makeTempFile(content: string): string {
    const path = join(tmpdir(), `new-spillover-test-${Date.now()}-${Math.random().toString(36).slice(2)}.txt`);
    writeFileSync(path, content, "utf-8");
    tempFiles.push(path);
    return path;
  }

  function captureSpilledPath(): string | null {
    const logText = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    const match = logText.match(/Spilled to temp file '([^']+)'/);
    return match ? match[1] : null;
  }

  beforeEach(() => {
    command = new NewCommand();
    client = makeClient();
    context = {
      verbose: false,
      cookieSession: {
        activeProfiles: mock(() => ["default"]),
        findProfileForConversation: mock(() => null),
        ensureSession: mock(() => ({ secure_1psid: "", secure_1psidts: null })),
      } as unknown as CliCommandContext["cookieSession"],
      getGeminiClient: () => client,
      listProfiles: () => [],
    };
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
    exitSpy = spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`__exit__:${code ?? "undefined"}`);
    }) as never);
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

  test("5000-char positional is sent to the client (no error, no truncation)", async () => {
    const arg = "a".repeat(5000);
    await command.execute([arg], context);

    expect(client.startNewChat).toHaveBeenCalledTimes(1);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(client.startNewChat).toHaveBeenCalledWith(arg, "gemini-3-flash");
  });

  test("5000-char positional spills: a temp file is created in tmpdir and DELETED after send", async () => {
    const arg = "a".repeat(5000);
    await command.execute([arg], context);

    const spilledPath = captureSpilledPath();
    expect(spilledPath).not.toBeNull();
    expect(spilledPath).toMatch(/gemiterm-arg-spill-.*\.txt$/);
    expect(spilledPath!.startsWith(tmpdir())).toBe(true);
    expect(existsSync(spilledPath!)).toBe(false);
  });

  test("stdout log message mentions the spillover (contains 'spilled' and 'temp file')", async () => {
    const arg = "a".repeat(5000);
    await command.execute([arg], context);

    const logText = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logText.toLowerCase()).toContain("spilled");
    expect(logText.toLowerCase()).toContain("temp file");
    expect(logText).toContain("5000");
    expect(logText).toContain("2048");
  });

  test("2048-char positional does NOT trigger spillover (no temp file, no spillover log, direct send)", async () => {
    const arg = "a".repeat(2048);
    await command.execute([arg], context);

    expect(client.startNewChat).toHaveBeenCalledTimes(1);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(client.startNewChat).toHaveBeenCalledWith(arg, "gemini-3-flash");

    const logText = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logText.toLowerCase()).not.toContain("spilled to temp file");

    const spilledPath = captureSpilledPath();
    expect(spilledPath).toBeNull();
  });

  test("2049-char positional DOES trigger spillover (boundary + 1)", async () => {
    const arg = "a".repeat(2049);
    await command.execute([arg], context);

    expect(client.startNewChat).toHaveBeenCalledTimes(1);
    expect(client.startNewChat).toHaveBeenCalledWith(arg, "gemini-3-flash");

    const spilledPath = captureSpilledPath();
    expect(spilledPath).not.toBeNull();
    expect(existsSync(spilledPath!)).toBe(false);
  });

  test("multi-byte (emoji) message exceeding 2048 code units spills correctly", async () => {
    const emoji = "\u{1F600}";
    const arg = emoji.repeat(1500);
    expect(arg.length).toBe(3000);

    await command.execute([arg], context);

    expect(client.startNewChat).toHaveBeenCalledTimes(1);
    expect(client.startNewChat).toHaveBeenCalledWith(arg, "gemini-3-flash");

    const spilledPath = captureSpilledPath();
    expect(spilledPath).not.toBeNull();
    expect(existsSync(spilledPath!)).toBe(false);

    const logText = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logText).toContain("3000");
  });

  test("multi-byte message at 2048 code unit boundary is sent directly (no spillover)", async () => {
    const emoji = "\u{1F600}";
    const arg = emoji.repeat(1024);
    expect(arg.length).toBe(2048);

    await command.execute([arg], context);

    expect(client.startNewChat).toHaveBeenCalledTimes(1);
    const logText = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logText.toLowerCase()).not.toContain("spilled to temp file");
  });

  test("when --prompt-file is given (no positional), no spillover happens — user-provided file wins, no spillover log", async () => {
    const content = "short user-provided file content";
    const path = makeTempFile(content);

    await command.execute(["--prompt-file", path], context);

    expect(client.startNewChat).toHaveBeenCalledTimes(1);
    expect(client.startNewChat).toHaveBeenCalledWith(content, "gemini-3-flash");

    const logText = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logText.toLowerCase()).not.toContain("spilled to temp file");

    const spilledPath = captureSpilledPath();
    expect(spilledPath).toBeNull();
  });

  test("when --prompt-file is given AND a long positional is given, the user-provided file is the source of truth (no spillover, no truncation of file content)", async () => {
    const fileContent = "from the file, exactly as written";
    const path = makeTempFile(fileContent);
    const longPositional = "a".repeat(3000);

    let thrown: Error | null = null;
    try {
      await command.execute(["--prompt-file", path, longPositional], context);
    } catch (e) {
      thrown = e as Error;
    }
    expect(thrown).not.toBeNull();
    expect(thrown?.message).toBe("__exit__:1");
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(client.startNewChat).not.toHaveBeenCalled();

    const stderr = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(stderr).toContain("--prompt-file");

    const spilledPath = captureSpilledPath();
    expect(spilledPath).toBeNull();
  });

  test("temp file path follows the pattern gemiterm-arg-spill-*.txt in os.tmpdir()", async () => {
    const arg = "a".repeat(5000);
    await command.execute([arg], context);

    const spilledPath = captureSpilledPath();
    expect(spilledPath).not.toBeNull();
    expect(spilledPath).toMatch(new RegExp(`^${escapeRegExp(tmpdir())}[\\\\/]gemiterm-arg-spill-[^\\\\/]+\\.txt$`));
  });
});

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
