import { describe, test, expect } from "bun:test";
import {
  GemitermError,
  AuthenticationError,
  CookieExpiredError,
  GeminiAPIError,
  ConversationNotFoundError,
  ConversationPendingError,
} from "../../src/core/errors.ts";

describe("errors", () => {
  test("all error classes extend GemitermError", () => {
    expect(new AuthenticationError()).toBeInstanceOf(GemitermError);
    expect(new CookieExpiredError()).toBeInstanceOf(GemitermError);
    expect(new GeminiAPIError("test")).toBeInstanceOf(GemitermError);
    expect(new ConversationNotFoundError("abc")).toBeInstanceOf(GemitermError);
    expect(new ConversationPendingError()).toBeInstanceOf(GemitermError);
  });

  test("all error classes extend Error", () => {
    expect(new GemitermError("x")).toBeInstanceOf(Error);
    expect(new AuthenticationError()).toBeInstanceOf(Error);
    expect(new CookieExpiredError()).toBeInstanceOf(Error);
    expect(new GeminiAPIError("x")).toBeInstanceOf(Error);
    expect(new ConversationNotFoundError("x")).toBeInstanceOf(Error);
    expect(new ConversationPendingError()).toBeInstanceOf(Error);
  });

  describe("GemitermError", () => {
    test("preserves the provided message", () => {
      const err = new GemitermError("something went wrong");
      expect(err.message).toBe("something went wrong");
    });

    test("has name set to 'GemitermError'", () => {
      expect(new GemitermError("").name).toBe("GemitermError");
    });
  });

  describe("AuthenticationError", () => {
    test("uses default message when none provided", () => {
      const err = new AuthenticationError();
      expect(err.message).toBe(
        "Not authenticated. Please run 'gemiterm login' first.",
      );
    });

    test("preserves custom message", () => {
      const err = new AuthenticationError("custom auth failure");
      expect(err.message).toBe("custom auth failure");
    });

    test("has name set to 'AuthenticationError'", () => {
      expect(new AuthenticationError().name).toBe("AuthenticationError");
    });
  });

  describe("CookieExpiredError", () => {
    test("uses default message when none provided", () => {
      const err = new CookieExpiredError();
      expect(err.message).toBe(
        "Session has expired. Please run 'gemiterm login' again.",
      );
    });

    test("preserves custom message", () => {
      const err = new CookieExpiredError("token expired at 12:00");
      expect(err.message).toBe("token expired at 12:00");
    });

    test("has name set to 'CookieExpiredError'", () => {
      expect(new CookieExpiredError().name).toBe("CookieExpiredError");
    });
  });

  describe("GeminiAPIError", () => {
    test("preserves the provided message", () => {
      const err = new GeminiAPIError("rate limit exceeded");
      expect(err.message).toBe("rate limit exceeded");
    });

    test("has name set to 'GeminiAPIError'", () => {
      expect(new GeminiAPIError("").name).toBe("GeminiAPIError");
    });
  });

  describe("ConversationNotFoundError", () => {
    test("includes the conversation ID in the message", () => {
      const err = new ConversationNotFoundError("conv-123");
      expect(err.message).toBe("Conversation 'conv-123' not found.");
    });

    test("has name set to 'ConversationNotFoundError'", () => {
      expect(new ConversationNotFoundError("x").name).toBe(
        "ConversationNotFoundError",
      );
    });
  });

  describe("ConversationPendingError", () => {
    test("uses default message when none provided", () => {
      const err = new ConversationPendingError();
      expect(err.message).toBe(
        "Conversation operation is still pending.",
      );
    });

    test("preserves custom message", () => {
      const err = new ConversationPendingError("still generating");
      expect(err.message).toBe("still generating");
    });

    test("has name set to 'ConversationPendingError'", () => {
      expect(new ConversationPendingError().name).toBe(
        "ConversationPendingError",
      );
    });
  });
});
