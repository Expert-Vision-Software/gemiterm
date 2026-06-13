import chalk from "chalk";
import { CancellationError, text, type TextOptions } from "./prompts.ts";

export interface MessageHandlerResult {
  response: string;
}

export type MessageHandler = (message: string) => Promise<MessageHandlerResult>;

export interface InteractiveLoopOptions {
  profileName?: string | null;
}

export interface InteractiveLoopDeps {
  text: (opts: TextOptions) => Promise<string>;
  CancellationError: typeof CancellationError;
}

export async function runInteractiveLoop(
  messageHandler: MessageHandler,
  options: InteractiveLoopOptions = {},
  deps: InteractiveLoopDeps = { text, CancellationError },
): Promise<void> {
  const profileLabel = options.profileName ?? "default";
  console.log(chalk.dim(`Starting chat session (profile: ${chalk.cyan(profileLabel)})`));
  console.log(chalk.dim("Type your message and press Enter. Type /exit to quit.\n"));

  let resolveOuter: () => void = () => {};
  const outerPromise = new Promise<void>((resolve) => {
    resolveOuter = resolve;
  });

  const prompt = async (): Promise<void> => {
    let input: string;
    try {
      input = await deps.text({ message: "You" });
    } catch (error) {
      if (error instanceof deps.CancellationError) {
        console.log(chalk.dim("\nGoodbye."));
        resolveOuter();
        return;
      }
      throw error;
    }
    const trimmed = input.trim();
    if (trimmed === "/exit" || trimmed === "/quit") {
      console.log(chalk.dim("\nGoodbye."));
      resolveOuter();
      return;
    }
    if (!trimmed) {
      await prompt();
      return;
    }
    try {
      console.log(chalk.dim("Thinking…"));
      const result = await messageHandler(trimmed);
      console.log(chalk.blue.bold("Model:"));
      console.log(result.response);
      console.log("");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`Error: ${message}`));
      console.log("");
    }
    await prompt();
  };

  prompt();

  await outerPromise;
}
