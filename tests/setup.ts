import { mkdirSync, rmSync, writeFileSync, mkdir } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const mkdirAsync = promisify(mkdir);

let testConfigDir: string | null = null;

export function createTestConfigDir(prefix = "gemiterm-test"): string {
  testConfigDir = resolve(
    join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`),
  );
  mkdirSync(testConfigDir, { recursive: true });
  return testConfigDir;
}

export async function createTestConfigDirAsync(prefix = "gemiterm-test"): Promise<string> {
  testConfigDir = resolve(
    join(tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`),
  );
  await mkdirAsync(testConfigDir, { recursive: true });
  return testConfigDir;
}

export function cleanupTestConfigDir(): void {
  if (testConfigDir) {
    try {
      rmSync(testConfigDir, { recursive: true, force: true });
    } catch {
      // temp dir cleanup is best-effort
    }
    testConfigDir = null;
  }
}

export function getTestConfigDir(): string {
  if (!testConfigDir) {
    throw new Error("Test config dir not initialized. Call createTestConfigDir() first.");
  }
  return testConfigDir;
}

export function setupTestConfig(prefix?: string): string {
  const dir = createTestConfigDir(prefix);
  process.env.GEMITERM_CONFIG_DIR = dir;
  return dir;
}

export function teardownTestConfig(originalEnv?: Record<string, string | undefined>): void {
  cleanupTestConfigDir();
  if (originalEnv) {
    if (originalEnv.GEMITERM_CONFIG_DIR !== undefined) {
      process.env.GEMITERM_CONFIG_DIR = originalEnv.GEMITERM_CONFIG_DIR;
    } else {
      delete process.env.GEMITERM_CONFIG_DIR;
    }
  } else {
    delete process.env.GEMITERM_CONFIG_DIR;
  }
}

export function createMockStorageStateFile(
  profileName: string,
  cookies: Array<{
    name: string;
    value: string;
    domain?: string;
    path?: string;
    expires?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: string;
  }>,
  configDir?: string,
): string {
  const dir = configDir || getTestConfigDir();
  const profileDir = join(dir, "profiles", profileName);
  mkdirSync(profileDir, { recursive: true });
  const content = JSON.stringify({
    cookies: cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: c.domain ?? ".google.com",
      path: c.path ?? "/",
      expires: c.expires ?? -1,
      httpOnly: c.httpOnly ?? true,
      secure: c.secure ?? true,
      sameSite: c.sameSite ?? "None",
    })),
  });
  const filePath = join(profileDir, "storage_state.json");
  writeFileSync(filePath, content, "utf-8");
  return filePath;
}
