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

export const INIT_TOKENS = ["SNlM0e", "cfb2h", "FdrFJe"] as const;

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

export function findCookieValue(cookies: { name: string; value: string }[], name: string): string | null {
  return cookies.find((c) => c.name === name)?.value ?? null;
}
