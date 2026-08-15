import chalk from "chalk";
import { IOError, readTextFile, writeTextFile, removeFile } from "../../infrastructure/io.ts";
import { getTempFilePath } from "../../infrastructure/path-utils.ts";
import { checkArgLength } from "./long-arg-guard.ts";

export async function loadPromptFromFile(filePath: string): Promise<string> {
  try {
    return await readTextFile(filePath);
  } catch (err) {
    if (err instanceof IOError) {
      throw new Error(`Could not read prompt file '${filePath}': ${err.message}`);
    }
    throw err;
  }
}

export async function spillOverToTempFile(content: string): Promise<string> {
  const path = getTempFilePath("gemiterm-arg-spill", ".txt");
  try {
    await writeTextFile(path, content);
  } catch (err) {
    if (err instanceof IOError) {
      throw new Error(`Could not spill message to temp file: ${err.message}`);
    }
    throw err;
  }
  return path;
}

export async function loadEffectivePrompt(
  message: string | null,
  promptFile: string | null,
): Promise<string | null> {
  let effectivePromptFile: string | null = null;
  let isSpillover = false;

  if (promptFile) {
    effectivePromptFile = promptFile;
  } else if (message) {
    const guard = checkArgLength(message);
    if (!guard.safe) {
      const spilled = await spillOverToTempFile(message);
      effectivePromptFile = spilled;
      isSpillover = true;
      console.log(
        chalk.dim(
          `[gemiterm] Message is ${guard.length} UTF-16 code units, exceeding the ${guard.limit} limit. ` +
            `Spilled to temp file '${spilled}' and loading from there.`,
        ),
      );
    }
  }

  if (!effectivePromptFile) {
    return message;
  }

  try {
    const loaded = await loadPromptFromFile(effectivePromptFile);
    if (isSpillover) {
      try {
        await removeFile(effectivePromptFile);
      } catch {
      }
    }
    return loaded;
  } catch (err) {
    console.error(chalk.red(`Error: ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }
}
