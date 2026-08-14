import type { CliCommand, CliCommandContext } from "../command-registry.ts";
import { Logger } from "../../infrastructure/logger.ts";
import {
  renderUsage,
  type ArgFlagSpec,
  type UsageSpec,
} from "../utils/command-args.ts";

interface AuthFlags {
  list: boolean;
  add: string | null;
  delete: string | null;
  rename: { old: string; new: string } | null;
  default: string | null;
  renew: string | null;
  yes: boolean;
  profileName: string | null;
}

const AUTH_FLAGS: readonly ArgFlagSpec[] = [
  { key: "help", long: "--help", short: "-h", type: "boolean", description: "Show this help message", helpLabel: "-h, --help" },
  { key: "list", long: "--list", short: "-l", type: "boolean", description: "List all profiles (non-interactive)", helpLabel: "-l, --list" },
  { key: "add", long: "--add", short: "-a", type: "string", description: "Create a new profile and authenticate", helpLabel: "-a, --add <name>" },
  { key: "delete", long: "--delete", short: "-d", type: "string", description: "Delete a profile", helpLabel: "-d, --delete <name>" },
  { key: "yes", long: "--yes", short: "-y", type: "boolean", description: "Skip confirmation prompts", helpLabel: "-y, --yes" },
  { key: "rename", long: "--rename", short: "-r", type: "string", description: "Rename a profile", helpLabel: "-r, --rename <old> <new>" },
  { key: "default", long: "--default", short: "-s", type: "string", description: "Set default profile", helpLabel: "-s, --default <name>" },
  { key: "renew", long: "--renew", short: "-e", type: "string", description: "Renew session (extend/refresh cookies)", helpLabel: "-e, --renew <name>" },
];

const AUTH_USAGE: UsageSpec = {
  usageLine: "Usage: gemiterm auth [profileName] [options]",
  arguments: [
    { name: "profileName", description: "Authenticate to an existing profile directly" },
  ],
  flags: AUTH_FLAGS,
};

export class AuthCommand implements CliCommand {
  readonly name = "auth";
  readonly description = "Authenticate with Google Gemini";

  async execute(args: string[], context: CliCommandContext): Promise<void> {
    const logger = new Logger("auth-command");
    logger.debug("Executing auth command", args);

    if (args.includes("--help") || args.includes("-h")) {
      this.showUsage();
      return;
    }

    const flags = this.parseFlags(args);

    if (flags.list) {
      await context.profileLifecycle.manageProfiles("list", {});
      return;
    }

    if (flags.add !== null) {
      await context.profileLifecycle.manageProfiles("create", { name: flags.add });
      return;
    }

    if (flags.delete !== null) {
      await context.profileLifecycle.manageProfiles("delete", {
        name: flags.delete,
        skipConfirm: flags.yes,
      });
      return;
    }

    if (flags.rename !== null) {
      await context.profileLifecycle.manageProfiles("rename", {
        oldName: flags.rename.old,
        newName: flags.rename.new,
      });
      return;
    }

    if (flags.default !== null) {
      await context.profileLifecycle.manageProfiles("set-default", { name: flags.default });
      return;
    }

    if (flags.renew !== null) {
      await context.profileLifecycle.manageProfiles("auth", { renewProfile: flags.renew });
      return;
    }

    if (flags.profileName !== null) {
      await context.profileLifecycle.manageProfiles("auth", { profileName: flags.profileName });
      return;
    }

    await context.profileLifecycle.manageProfiles("auth", {});
  }

  private parseFlags(args: string[]): AuthFlags {
    const flags: AuthFlags = {
      list: false,
      add: null,
      delete: null,
      rename: null,
      default: null,
      renew: null,
      yes: false,
      profileName: null,
    };

    const remaining: string[] = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];

      if (arg === "--list" || arg === "-l") {
        flags.list = true;
      } else if (arg === "--yes" || arg === "-y") {
        flags.yes = true;
      } else if (arg === "--add" || arg === "-a") {
        if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
          flags.add = args[++i];
        }
      } else if (arg === "--delete" || arg === "-d") {
        if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
          flags.delete = args[++i];
        }
      } else if (arg === "--rename" || arg === "-r") {
        if (i + 2 < args.length && !args[i + 1].startsWith("-") && !args[i + 2].startsWith("-")) {
          flags.rename = { old: args[++i], new: args[++i] };
        }
      } else if (arg === "--default" || arg === "-s") {
        if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
          flags.default = args[++i];
        }
      } else if (arg === "--renew" || arg === "-e") {
        if (i + 1 < args.length && !args[i + 1].startsWith("-")) {
          flags.renew = args[++i];
        }
      } else if (!arg.startsWith("-")) {
        remaining.push(arg);
      }
    }

    if (remaining.length > 0) {
      flags.profileName = remaining[0];
    }

    return flags;
  }

  private showUsage(): void {
    console.log(renderUsage(AUTH_USAGE));
  }
}
