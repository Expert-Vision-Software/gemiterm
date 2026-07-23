import { describe, test, expect, mock, beforeAll } from "bun:test";

let realGeminiReverse: typeof import("gemini-reverse");

beforeAll(async () => {
  mock.restore();
  realGeminiReverse = await import("gemini-reverse");
});

describe("gemini-reverse surface contract (2.1.0)", () => {
  describe("named exports exist and are the right kind", () => {
    test("Gemini is a constructible function", () => {
      expect(realGeminiReverse.Gemini).toBeDefined();
      expect(typeof realGeminiReverse.Gemini).toBe("function");
      const instance = new (realGeminiReverse.Gemini as any)({ secure_1psid: "dummy" });
      expect(instance).toBeDefined();
    });

    test("AuthError is a function extending Error", () => {
      expect(typeof realGeminiReverse.AuthError).toBe("function");
      expect(new realGeminiReverse.AuthError("x")).toBeInstanceOf(Error);
    });

    test("APIError is a function extending Error", () => {
      expect(typeof realGeminiReverse.APIError).toBe("function");
      expect(new realGeminiReverse.APIError("x")).toBeInstanceOf(Error);
    });

    test("GeminiError is a function extending Error", () => {
      expect(typeof realGeminiReverse.GeminiError).toBe("function");
      expect(new realGeminiReverse.GeminiError("x")).toBeInstanceOf(Error);
    });

    test("UsageLimitExceeded is a function extending Error", () => {
      expect(typeof realGeminiReverse.UsageLimitExceeded).toBe("function");
      expect(new realGeminiReverse.UsageLimitExceeded("x")).toBeInstanceOf(Error);
    });

    test("ModelInvalid is a function extending Error", () => {
      expect(typeof realGeminiReverse.ModelInvalid).toBe("function");
      expect(new realGeminiReverse.ModelInvalid("x")).toBeInstanceOf(Error);
    });

    test("TemporarilyBlocked is a function extending Error", () => {
      expect(typeof realGeminiReverse.TemporarilyBlocked).toBe("function");
      expect(new realGeminiReverse.TemporarilyBlocked("x")).toBeInstanceOf(Error);
    });

    test("GeminiClient export is absent", () => {
      expect(realGeminiReverse.GeminiClient).toBeUndefined();
    });

    test("TimeoutError export is absent", () => {
      expect(realGeminiReverse.TimeoutError).toBeUndefined();
    });
  });

  describe("Gemini.prototype methods", () => {
    test("has init", () => {
      expect(typeof (realGeminiReverse.Gemini.prototype as any).init).toBe("function");
    });

    test("has close", () => {
      expect(typeof (realGeminiReverse.Gemini.prototype as any).close).toBe("function");
    });

    test("has newChat", () => {
      expect(typeof (realGeminiReverse.Gemini.prototype as any).newChat).toBe("function");
    });

    test("has chats", () => {
      expect(typeof (realGeminiReverse.Gemini.prototype as any).chats).toBe("function");
    });

    test("has readChat", () => {
      expect(typeof (realGeminiReverse.Gemini.prototype as any).readChat).toBe("function");
    });

    test("has deleteChat", () => {
      expect(typeof (realGeminiReverse.Gemini.prototype as any).deleteChat).toBe("function");
    });

    test("has models", () => {
      expect(typeof (realGeminiReverse.Gemini.prototype as any).models).toBe("function");
    });
  });

  describe("constructor contract", () => {
    test("new Gemini({ secure_1psid }) sets cookies.__Secure-1PSID without init()", () => {
      const instance = new (realGeminiReverse.Gemini as any)({ secure_1psid: "dummy" });
      expect((instance as any).cookies).toBeDefined();
      expect((instance as any).cookies["__Secure-1PSID"]).toBe("dummy");
    });
  });
});
