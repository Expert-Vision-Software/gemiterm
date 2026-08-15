import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const AUTH_DIR = join(import.meta.dir, "..", "..", "src", "auth");

function authSourceFiles(): string[] {
  return readdirSync(AUTH_DIR)
    .filter((f) => f.endsWith(".ts"))
    .map((f) => join(AUTH_DIR, f));
}

describe("full-jar contract pins (fix-1)", () => {
  test("no cookie-name filtering sets exist under src/auth", () => {
    const forbidden = /REQUIRED_COOKIES|COOKIE_NAMES_OF_INTEREST|REQUIRED_COOKIE_NAMES/;
    for (const file of authSourceFiles()) {
      const content = readFileSync(file, "utf-8");
      expect(forbidden.test(content)).toBe(false);
    }
  });

  test("capture and persistence paths filter by domain only, never by cookie name", () => {
    for (const file of authSourceFiles()) {
      const content = readFileSync(file, "utf-8");
      const nameFilters = content.match(/\.filter\(\s*\(?[^)]*\)?\s*=>[^)\n]*c\.name\s*(===|!==|\.includes)|\.filter\(\s*\(?[^)]*\)?\s*=>[^)\n]*cookie\.name\s*(===|!==|\.includes)/g);
      expect(nameFilters).toBeNull();
    }
  });

  test("domain filter keeps .google.com, .youtube.com and accounts.google.com only", async () => {
    const { filterToGeminiDomains } = await import("../../src/auth/auth-constants.ts");
    const domains = [
      ".google.com",
      "accounts.google.com",
      "gemini.google.com",
      ".youtube.com",
      "youtube.com",
      ".example.com",
      "evil-google.com.attacker.test",
      "google.com.evil.test",
    ];
    const kept = filterToGeminiDomains(domains.map((domain) => ({ domain }))).map((c) => c.domain);
    expect(kept).toEqual([".google.com", "accounts.google.com", "gemini.google.com", ".youtube.com", "youtube.com"]);
  });
});
