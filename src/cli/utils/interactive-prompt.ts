import chalk from "chalk";
import { createInterface } from "node:readline";

export interface MessageHandlerResult {
  response: string;
}

export type MessageHandler = (message: string) => Promise<MessageHandlerResult>;

export interface InteractiveLoopOptions {
  profileName?: string | null;
}

export async function runInteractiveLoop(
  messageHandler: MessageHandler,
  options: InteractiveLoopOptions = {},
): Promise<void> {
  const profileLabel = options.profileName ?? "default";
  console.log(chalk.dim(`Starting chat session (profile: ${chalk.cyan(profileLabel)})`));
  console.log(chalk.dim("Type your message and press Enter. Type /exit to quit.\n"));

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = (): void => {
    rl.question(chalk.green.bold("You: "), async (input) => {
      const trimmed = input.trim();

      if (trimmed === "/exit" || trimmed === "/quit") {
        rl.close();
        return;
      }

      if (!trimmed) {
        prompt();
        return;
      }

      try {
        const result = await messageHandler(trimmed);
        console.log(chalk.blue.bold("Model:"));
        console.log(result.response);
        console.log("");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(chalk.red(`Error: ${message}`));
        console.log("");
      }

      prompt();
    });
  };

  prompt();

  await new Promise<void>((resolve) => {
    rl.on("close", () => {
      console.log(chalk.dim("\nGoodbye."));
      resolve();
    });
  });
}