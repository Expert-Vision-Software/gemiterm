import chalk from "chalk";
import type { CliCommand, CliCommandContext } from "../command-registry.ts";
import { Logger } from "../../infrastructure/logger.ts";
import { InstallSkillsService, SkillsInstallError } from "../../services/skills-service.ts";

export class InstallSkillsCommand implements CliCommand {
  readonly name = "install-skills";
  readonly description = "Install GemiTerm opencode skills from expert-vision-software/opencode-gemiterm-skills";

  async execute(_args: string[], _context: CliCommandContext): Promise<void> {
    const logger = new Logger("install-skills-command");
    logger.debug("Executing install-skills command");
    const service = new InstallSkillsService({ logger });

    console.log(chalk.dim("Installing GemiTerm opencode skills..."));

    try {
      const output = await service.install();
      if (output) {
        console.log(output);
      }
      console.log(chalk.green("Skills installed successfully."));
    } catch (error) {
      if (error instanceof SkillsInstallError) {
        logger.error(error.message);
        if (error.cause) {
          logger.error(`Cause: ${error.cause.message}`);
        }
        console.error(chalk.red("Failed to install skills."));
        process.exit(1);
      }
      throw error;
    }
  }
}
