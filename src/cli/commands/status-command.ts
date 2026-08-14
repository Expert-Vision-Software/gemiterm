import type { CliCommand, CliCommandContext } from "../command-registry.ts";
import { Logger } from "../../infrastructure/logger.ts";

export class StatusCommand implements CliCommand {
  readonly name = "status";
  readonly description = "Show configuration and profile status";

  async execute(args: string[], context: CliCommandContext): Promise<void> {
    const logger = new Logger("status-command");
    logger.debug("Executing status command", args);

    if (args.includes("--help") || args.includes("-h")) {
      console.log("Usage: gemiterm status");
      console.log("");
      console.log("Show configuration and profile status.");
      console.log("");
      console.log("Options:");
      console.log("  -h, --help    Show this help message");
      return;
    }

    const result = await context.profileLifecycle.manageProfiles("status", {});
    if (result && result.exitCode === 2) {
      process.exit(2);
    }
  }
}
