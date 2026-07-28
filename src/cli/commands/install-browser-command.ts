import chalk from "chalk";
import type { CliCommand, CliCommandContext } from "../command-registry.ts";
import { Logger } from "../../infrastructure/logger.ts";
import { InstallBrowserService, InstallBrowserError } from "../../services/install-browser-service.ts";

export class InstallBrowserCommand implements CliCommand {
  readonly name = "install-browser";
  readonly description = "Install Chrome for Testing browser for Playwright (hidden command)";

  async execute(_args: string[], _context: CliCommandContext): Promise<void> {
    const logger = new Logger("install-browser-command");
    logger.debug("Executing install-browser command");
    const service = new InstallBrowserService(logger);

    console.log(chalk.dim("Checking browser installation..."));

    try {
      await service.install();
      console.log(chalk.green("Browser ready."));
    } catch (error) {
      if (error instanceof InstallBrowserError) {
        logger.error(error.message);
        if (error.cause) {
          logger.error(`Cause: ${error.cause.message}`);
        }
        console.error(chalk.red("Failed to install browser."));
        console.error(chalk.dim("You may need to run: bunx @playwright/cli install-browser chrome-for-testing"));
        process.exit(1);
      }
      throw error;
    }
  }
}
