import type { Cookie } from "../../src/core/types.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { getTestConfigDir, createTestConfigDir } from "../setup.ts";

const MOCK_COOKIE_DEFAULTS: Omit<Cookie, "name" | "value" | "expires"> = {
  domain: ".google.com",
  path: "/",
  httpOnly: true,
  secure: true,
  sameSite: "None",
};

const FUTURE_EXPIRY = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
const PAST_EXPIRY = Math.floor(Date.now() / 1000) - 30 * 24 * 60 * 60;

export interface MockCookiesOptions {
  count?: number;
  names?: string[];
  expiry?: number;
  values?: Record<string, string>;
}

export function createMockCookies(options: MockCookiesOptions = {}): Cookie[] {
  const {
    count = 4,
    names,
    expiry = FUTURE_EXPIRY,
    values = {},
  } = options;

  const defaultNames = [
    "__Secure-1PSID",
    "__Secure-1PSIDTS",
    "__Secure-1PSIDCC",
    "NID",
  ];

  const cookieNames = names ?? defaultNames.slice(0, count);

  return cookieNames.map((name) => ({
    name,
    value: values[name] ?? `mock-value-${name}`,
    ...MOCK_COOKIE_DEFAULTS,
    expires: expiry,
  }));
}

export interface MockStorageStateOptions {
  cookies?: Cookie[];
  expiry?: number;
}

export function createMockStorageState(options: MockStorageStateOptions = {}): object {
  const cookies = options.cookies ?? createMockCookies({ expiry: options.expiry ?? FUTURE_EXPIRY });
  return { cookies };
}

export function createExpiredStorageState(): object {
  const cookies = createMockCookies({ expiry: PAST_EXPIRY });
  return { cookies };
}

export interface MockProfileDirOptions {
  profileName?: string;
  configDir?: string;
  cookies?: Cookie[];
  expired?: boolean;
}

export function mockProfileDir(options: MockProfileDirOptions = {}): string {
  const {
    profileName = "test-profile",
    configDir,
    expired = false,
  } = options;

  let dir: string;
  try {
    dir = configDir ?? getTestConfigDir();
  } catch {
    dir = createTestConfigDir();
  }

  const resolvedDir = resolve(dir);
  const profileDir = join(resolvedDir, "profiles", profileName);
  mkdirSync(profileDir, { recursive: true });

  const state = expired
    ? createExpiredStorageState()
    : createMockStorageState({ cookies: options.cookies });

  const filePath = join(profileDir, "storage_state.json");
  writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");

  return profileDir;
}
