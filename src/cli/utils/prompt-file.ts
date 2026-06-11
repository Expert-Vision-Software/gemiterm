import { IOError, readTextFile } from "../../infrastructure/io.ts";

export async function loadPromptFromFile(filePath: string): Promise<string> {
  try {
    return readTextFile(filePath);
  } catch (err) {
    if (err instanceof IOError) {
      throw new Error(`Could not read prompt file '${filePath}': ${err.message}`);
    }
    throw err;
  }
}
