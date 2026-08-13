import { describe, test, expect, mock, beforeEach, afterEach, spyOn } from "bun:test";
import { ModelsCommand } from "../../../src/cli/commands/models-command.ts";
import type { CliCommandContext } from "../../../src/cli/command-registry.ts";

function makeClient() {
  const client: any = {
    listModels: mock(async (): Promise<string[]> => ["gemini-3-pro", "gemini-3-flash", "gemini-3-lite"]),
  };
  return client;
}

function getOutput(logSpy: ReturnType<typeof spyOn>): string {
  return logSpy.mock.calls.map((c) => c[0]).join("\n");
}

describe("models command integration", () => {
  let command: ModelsCommand;
  let context: CliCommandContext;
  let client: ReturnType<typeof makeClient>;
  let logSpy: ReturnType<typeof spyOn>;
  let stderrSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    command = new ModelsCommand();
    client = makeClient();
    context = {
      verbose: false,
      profileAuthManager: {} as unknown as CliCommandContext["profileAuthManager"],
      getGeminiClient: () => client,
      listProfiles: () => [],
    };
    logSpy = spyOn(console, "log").mockImplementation(() => {});
    stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    mock.restore();
    logSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  describe("command metadata", () => {
    test("has correct name and description", () => {
      expect(command.name).toBe("models");
      expect(command.description).toBe("List available Gemini models");
    });
  });

  describe("--help flag", () => {
    test("--help shows usage information", async () => {
      await command.execute(["--help"], context);

      const output = getOutput(logSpy);
      expect(output).toContain("Usage: gemiterm models");
      expect(output).toContain("List available Gemini models");
      expect(output).toContain("Options:");
    });

    test("-h shows usage information", async () => {
      await command.execute(["-h"], context);

      const output = getOutput(logSpy);
      expect(output).toContain("Usage: gemiterm models");
    });
  });

  describe("model listing", () => {
    test("displays available models heading", async () => {
      await command.execute([], context);

      const output = getOutput(logSpy);
      expect(output).toContain("Available Gemini models:");
    });

    test("displays each model name", async () => {
      await command.execute([], context);

      const output = getOutput(logSpy);
      expect(output).toContain("gemini-3-pro");
      expect(output).toContain("gemini-3-flash");
      expect(output).toContain("gemini-3-lite");
    });

    test("calls listModels", async () => {
      await command.execute([], context);

      expect(client.listModels).toHaveBeenCalledTimes(1);
    });

    test("displays model count in info log", async () => {
      await command.execute([], context);

      const stderrOutput = stderrSpy.mock.calls.map((c) => c[0]).join("");
      expect(stderrOutput).toContain("3 model(s) available");
    });
  });

  describe("empty model list", () => {
    test("handles empty model list gracefully", async () => {
      client.listModels = mock(async () => []);

      await command.execute([], context);

      const output = getOutput(logSpy);
      expect(output).toContain("Available Gemini models:");
    });
  });
});
