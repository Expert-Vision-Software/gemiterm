import { describe, test, expect } from "bun:test";

describe("gemini-reverse import regression", () => {
  test("Gemini export exists and is a function", async () => {
    const geminiReverse = await import("gemini-reverse");
    expect(geminiReverse.Gemini).toBeDefined();
    expect(typeof geminiReverse.Gemini).toBe("function");
  });
});
