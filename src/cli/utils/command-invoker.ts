import type { CliCommandContext } from "../command-registry.ts";

export async function invokeCommand(
  commandName: string,
  args: string[],
  context: CliCommandContext,
): Promise<void> {
  const { CommandRegistry } = await import("../command-registry.ts");
  const registry = new CommandRegistry();
  registry.registerAllCommands();

  const handler = registry.getHandler(commandName);
  if (!handler) {
    throw new Error(`Command not found: ${commandName}`);
  }

  await handler.execute(args, context);
}
