import { describe, test, expect } from "bun:test";
import { hasHighIntegrity, isRunningElevated, ElevationError } from "../../src/infrastructure/elevation.ts";

describe("ElevationError", () => {
  test("has correct name and an actionable message", () => {
    const error = new ElevationError();
    expect(error.name).toBe("ElevationError");
    expect(error.message).toContain("elevated");
    expect(error.message).toContain("non-Administrator");
  });
});

describe("hasHighIntegrity", () => {
  test("detects the High Mandatory Level SID in whoami /groups output", () => {
    const elevated = [
      "Group Information",
      "BUILTIN\\Administrators                 Alias group      S-1-5-32-544 Enabled, Group owner",
      "Mandatory Label\\High Mandatory Level   Label            S-1-16-12288",
    ].join("\n");
    expect(hasHighIntegrity(elevated)).toBe(true);
  });

  test("returns false for a non-elevated (Medium) token", () => {
    const nonelevated = [
      "BUILTIN\\Administrators                 Alias group      S-1-5-32-544 Group used for deny only",
      "Mandatory Label\\Medium Mandatory Level Label            S-1-16-8192",
    ].join("\n");
    expect(hasHighIntegrity(nonelevated)).toBe(false);
  });

  test("returns false for empty / unrelated output", () => {
    expect(hasHighIntegrity("")).toBe(false);
    expect(hasHighIntegrity("no integrity info here")).toBe(false);
  });
});

describe("isRunningElevated", () => {
  test("returns a boolean without throwing", () => {
    expect(typeof isRunningElevated()).toBe("boolean");
  });

  test("returns false on non-Windows platforms", () => {
    const original = process.platform;
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    try {
      expect(isRunningElevated()).toBe(false);
    } finally {
      Object.defineProperty(process, "platform", { value: original, configurable: true });
    }
  });
});
