import { describe, test, expect } from "bun:test";

describe("gemini-web-sdk import regression", () => {
  test("Gemini export exists and is a function", async () => {
    const geminiReverse = await import("gemini-web-sdk");
    expect(geminiReverse.Gemini).toBeDefined();
    expect(typeof geminiReverse.Gemini).toBe("function");
  });
});
