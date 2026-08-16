import { describe, test, expect, mock, afterEach } from "bun:test";
import { invokeCommand } from "../../../src/cli/utils/command-invoker.ts";
import type { CliCommandContext } from "../../../src/cli/command-registry.ts";

function makeContext(): CliCommandContext {
  return {
    verbose: false,
    cookieSession: {},
    getGeminiClient: () => ({}),
    listProfiles: () => [],
  } as unknown as CliCommandContext;
}

describe("invokeCommand", () => {
  afterEach(() => {
    mock.restore();
  });

  test("executes a registered command with the given args and context", async () => {
    const execute = mock(() => Promise.resolve());
    mock.module("../../../src/cli/command-registry.ts", () => ({
      CommandRegistry: class {
        registerAllCommands(): void {}
        getHandler(name: string): { execute: ReturnType<typeof mock> } | undefined {
          if (name === "list") return { execute };
          return undefined;
        }
      },
    }));

    const context = makeContext();
    await invokeCommand("list", ["a", "b"], context);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(["a", "b"], context);
  });

  test("rejects with an Error naming an unknown command", async () => {
    mock.module("../../../src/cli/command-registry.ts", () => ({
      CommandRegistry: class {
        registerAllCommands(): void {}
        getHandler(): undefined {
          return undefined;
        }
      },
    }));

    await expect(invokeCommand("nope", [], makeContext())).rejects.toThrow(/nope/);
  });

  test("routes the list command with empty args for the no-id path", async () => {
    const execute = mock(() => Promise.resolve());
    mock.module("../../../src/cli/command-registry.ts", () => ({
      CommandRegistry: class {
        registerAllCommands(): void {}
        getHandler(name: string): { execute: ReturnType<typeof mock> } | undefined {
          if (name === "list") return { execute };
          return undefined;
        }
      },
    }));

    const context = makeContext();
    await invokeCommand("list", [], context);

    expect(execute).toHaveBeenCalledWith([], context);
  });
});
