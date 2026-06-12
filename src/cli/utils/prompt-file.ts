import { IOError, readTextFile, writeTextFile } from "../../infrastructure/io.ts";
import { getTempFilePath } from "../../infrastructure/path-utils.ts";

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

export async function spillOverToTempFile(content: string): Promise<string> {
  const path = getTempFilePath("gemiterm-arg-spill", ".txt");
  try {
    writeTextFile(path, content);
  } catch (err) {
    if (err instanceof IOError) {
      throw new Error(`Could not spill message to temp file: ${err.message}`);
    }
    throw err;
  }
  return path;
}
