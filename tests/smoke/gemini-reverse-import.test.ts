import { describe, test, expect } from "bun:test";

describe("gemini-reverse import regression", () => {
  test("GeminiClient export exists and is a function", async () => {
    const geminiReverse = await import("gemini-reverse");
    expect(geminiReverse.GeminiClient).toBeDefined();
    expect(typeof geminiReverse.GeminiClient).toBe("function");
  });
});
