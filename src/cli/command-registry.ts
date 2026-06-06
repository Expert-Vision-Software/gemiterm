import { readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Mediator } from "../core/mediator.ts";

export interface CliCommandContext {
  verbose: boolean;
  mediator: Mediator;
}

export interface CliCommand {
  readonly name: string;
  readonly description: string;
  execute(args: string[], context: CliCommandContext): Promise<void>;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const COMMANDS_DIR = resolve(__dirname, "commands");

export class CommandRegistry {
  private handlers = new Map<string, CliCommand>();

  register(commandName: string, handler: CliCommand): void {
    if (this.handlers.has(commandName)) {
      throw new Error(`Command already registered: ${commandName}`);
    }
    this.handlers.set(commandName, handler);
  }

  getHandler(commandName: string): CliCommand | undefined {
    return this.handlers.get(commandName);
  }

  has(commandName: string): boolean {
    return this.handlers.has(commandName);
  }

  getRegisteredNames(): string[] {
    return [...this.handlers.keys()];
  }

  async autoDiscover(): Promise<void> {
    let entries: string[];
    try {
      entries = readdirSync(COMMANDS_DIR);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (!entry.endsWith(".ts") || entry.startsWith("_")) continue;

      const filePath = join(COMMANDS_DIR, entry);
      const module = await import(
        `file://${filePath.replace(/\\/g, "/")}`
      );

      for (const exported of Object.values(module)) {
        if (exported == null || typeof exported !== "function") continue;

        let instance: unknown;
        try {
          instance = new (exported as new () => CliCommand)();
        } catch {
          continue;
        }

        if (
          instance &&
          typeof instance === "object" &&
          "name" in instance &&
          "execute" in instance &&
          typeof (instance as CliCommand).execute === "function"
        ) {
          const command = instance as CliCommand;
          this.register(command.name, command);
        }
      }
    }
  }
}
