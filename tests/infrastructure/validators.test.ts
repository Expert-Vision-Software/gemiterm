import { describe, test, expect } from "bun:test";
import {
  validateConversationId,
  parseIsoDate,
  validateProfileName,
} from "../../src/infrastructure/validators.ts";
import { GemitermError } from "../../src/core/errors.ts";

describe("validateConversationId", () => {
  test("does not throw for a valid non-empty id", () => {
    expect(() => validateConversationId("abc123")).not.toThrow();
  });

  test("throws for empty string", () => {
    expect(() => validateConversationId("")).toThrow(GemitermError);
    expect(() => validateConversationId("")).toThrow("Conversation ID must not be empty");
  });

  test("throws for whitespace-only string", () => {
    expect(() => validateConversationId("   ")).toThrow(GemitermError);
  });
});

describe("parseIsoDate", () => {
  test("returns timestamp for valid ISO date", () => {
    const ts = parseIsoDate("2025-01-15T10:30:00.000Z", "createdAt");
    expect(typeof ts).toBe("number");
    expect(ts).toBe(new Date("2025-01-15T10:30:00.000Z").getTime());
  });

  test("throws for invalid date string", () => {
    expect(() => parseIsoDate("not-a-date", "field")).toThrow(GemitermError);
    expect(() => parseIsoDate("not-a-date", "field")).toThrow("Invalid ISO date for 'field'");
  });

  test("includes field name in error message", () => {
    expect(() => parseIsoDate("bad", "updatedAt")).toThrow("'updatedAt'");
  });
});

describe("validateProfileName", () => {
  test("does not throw for valid names", () => {
    expect(() => validateProfileName("default")).not.toThrow();
    expect(() => validateProfileName("my-profile")).not.toThrow();
    expect(() => validateProfileName("profile_2")).not.toThrow();
    expect(() => validateProfileName("ABC123")).not.toThrow();
  });

  test("throws for empty string", () => {
    expect(() => validateProfileName("")).toThrow(GemitermError);
    expect(() => validateProfileName("")).toThrow("Profile name must not be empty");
  });

  test("throws for whitespace-only string", () => {
    expect(() => validateProfileName("   ")).toThrow(GemitermError);
  });

  test("throws for name with spaces", () => {
    expect(() => validateProfileName("my profile")).toThrow(GemitermError);
  });

  test("throws for name with special characters", () => {
    expect(() => validateProfileName("profile@bad")).toThrow(GemitermError);
    expect(() => validateProfileName("pro/ject")).toThrow(GemitermError);
    expect(() => validateProfileName("pro.file")).toThrow(GemitermError);
  });
});
