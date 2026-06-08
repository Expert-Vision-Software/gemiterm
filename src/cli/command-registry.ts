import type { Mediator } from "../core/mediator.ts";
import type { ProfileAuthManager } from "../services/profile-auth-manager.ts";
import { AuthCommand } from "./commands/auth-command.ts";
import { ProfileCommand } from "./commands/profile-command.ts";
import { StatusCommand } from "./commands/status-command.ts";
import { ListCommand } from "./commands/list-command.ts";
import { FetchCommand } from "./commands/fetch-command.ts";
import { ContinueCommand } from "./commands/continue-command.ts";
import { NewCommand } from "./commands/new-command.ts";
import { DeleteCommand } from "./commands/delete-command.ts";
import { ExportCommand } from "./commands/export-command.ts";
import { ExportAllCommand } from "./commands/export-all-command.ts";
import { InstallBrowserCommand } from "./commands/install-browser-command.ts";

export interface CliCommandContext {
  verbose: boolean;
  mediator: Mediator;
  profileAuthManager: ProfileAuthManager;
}

export interface CliCommand {
  readonly name: string;
  readonly description: string;
  execute(args: string[], context: CliCommandContext): Promise<void>;
}

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

  registerAllCommands(): void {
    this.register("auth", new AuthCommand());
    this.register("profile", new ProfileCommand());
    this.register("status", new StatusCommand());
    this.register("list", new ListCommand());
    this.register("fetch", new FetchCommand());
    this.register("continue", new ContinueCommand());
    this.register("new", new NewCommand());
    this.register("delete", new DeleteCommand());
    this.register("export", new ExportCommand());
    this.register("export-all", new ExportAllCommand());
    this.register("install-browser", new InstallBrowserCommand());
  }
}
