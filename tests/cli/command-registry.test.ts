import { describe, test, expect, mock, beforeEach } from "bun:test";
import { CommandRegistry } from "../../src/cli/command-registry.ts";
import { Mediator } from "../../src/core/mediator.ts";
import type { CliCommand, CliCommandContext } from "../../src/cli/command-registry.ts";

class FakeCommand implements CliCommand {
  constructor(
    public readonly name: string,
    public readonly description: string,
    private readonly executeFn: (args: string[], ctx: CliCommandContext) => Promise<void>,
  ) {}

  async execute(args: string[], ctx: CliCommandContext): Promise<void> {
    return this.executeFn(args, ctx);
  }
}

describe("CommandRegistry", () => {
  let registry: CommandRegistry;

  beforeEach(() => {
    registry = new CommandRegistry();
  });

  test("registers and retrieves a command handler", () => {
    const handler = new FakeCommand("test", "A test command", async () => {});
    registry.register("test", handler);
    expect(registry.getHandler("test")).toBe(handler);
  });

  test("returns undefined for unregistered command", () => {
    expect(registry.getHandler("nonexistent")).toBeUndefined();
  });

  test("throws when registering duplicate command", () => {
    const handler = new FakeCommand("dup", "desc", async () => {});
    registry.register("dup", handler);
    expect(() => registry.register("dup", handler)).toThrow("Command already registered: dup");
  });

  test("has() returns correct boolean", () => {
    registry.register("exists", new FakeCommand("exists", "desc", async () => {}));
    expect(registry.has("exists")).toBe(true);
    expect(registry.has("nope")).toBe(false);
  });

  test("getRegisteredNames() returns all registered names", () => {
    registry.register("login", new FakeCommand("login", "Login", async () => {}));
    registry.register("list", new FakeCommand("list", "List", async () => {}));
    const names = registry.getRegisteredNames();
    expect(names).toContain("login");
    expect(names).toContain("list");
    expect(names).toHaveLength(2);
  });

  test("execute dispatches to correct handler", async () => {
    const executeMock = mock(() => Promise.resolve());
    const handler = new FakeCommand("greet", "Greet", executeMock);
    registry.register("greet", handler);

    const ctx: CliCommandContext = { verbose: false, mediator: new Mediator() };
    await registry.getHandler("greet")!.execute(["--name", "World"], ctx);

    expect(executeMock).toHaveBeenCalledWith(["--name", "World"], ctx);
    expect(executeMock).toHaveBeenCalledTimes(1);
  });
});
