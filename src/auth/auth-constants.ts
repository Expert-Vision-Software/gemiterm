export const GEMINI_APP_URL = "https://gemini.google.com/app";

export const PSID_COOKIE_NAME = "__Secure-1PSID";
export const PSIDTS_COOKIE_NAME = "__Secure-1PSIDTS";

export const COMPANION_COOKIE_NAMES = [
  "SID",
  "HSID",
  "SSID",
  "APISID",
  "SAPISID",
  "SIDCC",
  "NID",
] as const;

// Per ablation §6.2 (docs/auth-cookie-lifecycle.md): token presence is decided
// by value extraction, not by key-name substring. Gemini's signed-out init
// HTML embeds the keys with empty values (e.g. `"cfb2h":""`), so a substring
// scan mis-reads a fully signed-out page as token-bearing. Each pattern
// matches `/"<token>":\s*"(.*?)"/`; presence requires at least one non-empty
// capture group 1 (fix-6). The pattern is built from the `token` field so the
// name and the regex literal cannot drift apart.
const INIT_TOKEN_NAMES = ["SNlM0e", "cfb2h", "FdrFJe"] as const;

export const INIT_TOKEN_EXTRACTION = INIT_TOKEN_NAMES.map((token) => ({
  token,
  pattern: new RegExp(`"${token}":\\s*"(.*?)"`),
}));

export function hasAnyExtractedInitToken(html: string): boolean {
  return INIT_TOKEN_EXTRACTION.some(({ pattern }) => {
    const match = pattern.exec(html);
    return match !== null && match[1].length > 0;
  });
}

const GOOGLE_DOMAIN_SUFFIXES = [".google.com", ".youtube.com", "accounts.google.com"] as const;

export function isAllowedGeminiDomain(domain: string): boolean {
  const normalized = domain.startsWith(".") ? domain.slice(1) : domain;
  return GOOGLE_DOMAIN_SUFFIXES.some((suffix) => {
    const bare = suffix.startsWith(".") ? suffix.slice(1) : suffix;
    return normalized === bare || normalized.endsWith(`.${bare}`);
  });
}

export function filterToGeminiDomains<T extends { domain: string }>(cookies: T[]): T[] {
  return cookies.filter((c) => isAllowedGeminiDomain(c.domain));
}
