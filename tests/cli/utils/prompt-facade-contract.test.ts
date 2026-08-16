import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_SRC = join(import.meta.dir, "..", "..", "..", "src");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.name.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

// Facade symbols are published by src/cli/utils/prompts.ts only (fix-3b prompt-layer delta).
const FACADE_SYMBOLS = /\b(text|confirm|select|browser|CancellationError|NonInteractiveError)\b/;

describe("prompt facade contract pins (fix-3b)", () => {
  test("interactive-prompt.ts does not re-export facade symbols", () => {
    const content = readFileSync(join(REPO_SRC, "cli", "utils", "interactive-prompt.ts"), "utf-8");
    const reExport = /export\s*\{[^}]*\}/g;
    for (const match of content.match(reExport) ?? []) {
      expect(FACADE_SYMBOLS.test(match)).toBe(false);
    }
  });

  test("no module imports facade symbols from interactive-prompt.ts", () => {
    for (const file of sourceFiles(REPO_SRC)) {
      const content = readFileSync(file, "utf-8");
      const importMatch = content.match(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*"[^"]*interactive-prompt\.ts"/);
      if (importMatch) {
        expect(FACADE_SYMBOLS.test(importMatch[1]!)).toBe(false);
      }
    }
  });
});
