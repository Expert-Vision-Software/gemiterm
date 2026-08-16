import { describe, test, expect, beforeEach, mock, afterEach } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { SessionClassifier } from "../../src/auth/session-classifier.ts";
import { CookieStore } from "../../src/auth/cookie-store.ts";
import { freshFullJar, phantomShapedJar, deadJar } from "./fixtures.ts";

const TEST_DIR = join(tmpdir(), "gemiterm-auth-regression");

let logs: string[] = [];
const origLog = console.log;

beforeEach(() => {
  process.env.GEMITERM_CONFIG_DIR = TEST_DIR;
  mkdirSync(TEST_DIR, { recursive: true });
  mkdirSync(join(TEST_DIR, "profiles"), { recursive: true });
  logs = [];
  console.log = ((...args: unknown[]) => { logs.push(args.map(String).join(" ")); }) as typeof console.log;
});

afterEach(() => {
  console.log = origLog;
  delete process.env.GEMITERM_CONFIG_DIR;
  try {
    rmSync(TEST_DIR, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
});

function makeLogger() {
  return {
    debug: mock(() => {}),
    info: mock(() => {}),
    warn: mock(() => {}),
    error: mock(() => {}),
  };
}

async function setupTestProfile(jar: any[]) {
  const cookieStore = new CookieStore();
  await cookieStore.saveFullJar("test-profile", jar, new Map());
}

describe("auth-regression: classifier truth table", () => {
  test("reports 'live' for tokens present + listChats >= 1", async () => {
    await setupTestProfile(freshFullJar());
    
    const initHtmlWithTokens = `
      <html>
        <body>
          <script data-initial-state="SNIPET">SNlM0e</script>
        </body>
      </html>
    `;
    
    const fakeFetch = mock(async () => initHtmlWithTokens);
    const probeChats = mock(async () => ["chat1", "chat2"]);
    
    const classifier = new SessionClassifier({
      fetchInitHtml: fakeFetch,
      probeChats,
      logger: makeLogger() as never,
    });
    
    const result = await classifier.classifyDetailed("test-profile");
    
    expect(result.state).toBe("live");
    expect(result.chatCount).toBe(2);
  });

  test("reports 'phantom' for tokens present + listChats 0", async () => {
    await setupTestProfile(phantomShapedJar());
    
    const initHtmlWithTokens = `
      <html>
        <body>
          <script data-initial-state="SNIPET">SNlM0e</script>
        </body>
      </html>
    `;
    
    const fakeFetch = mock(async () => initHtmlWithTokens);
    const probeChats = mock(async () => []);
    
    const classifier = new SessionClassifier({
      fetchInitHtml: fakeFetch,
      probeChats,
      logger: makeLogger() as never,
    });
    
    const result = await classifier.classifyDetailed("test-profile");
    
    expect(result.state).toBe("phantom");
    expect(result.chatCount).toBe(0);
  });

  test("reports 'dead' for no tokens", async () => {
    await setupTestProfile(deadJar());
    
    const initHtmlWithoutTokens = `
      <html>
        <body>
          <p>Sign in to continue</p>
        </body>
      </html>
    `;
    
    const fakeFetch = mock(async () => initHtmlWithoutTokens);
    const probeChats = mock(async () => []);
    
    const classifier = new SessionClassifier({
      fetchInitHtml: fakeFetch,
      probeChats,
      logger: makeLogger() as never,
    });
    
    const result = await classifier.classifyDetailed("test-profile");
    
    expect(result.state).toBe("dead");
    expect(result.chatCount).toBe(0);
    expect(probeChats).not.toHaveBeenCalled();
  });

  test("deterministic across repeated runs with same jar shape", async () => {
    await setupTestProfile(freshFullJar());
    
    const initHtmlWithTokens = `
      <html>
        <body>
          <script data-initial-state="SNIPET">SNlM0e</script>
        </body>
      </html>
    `;
    
    const fakeFetch = mock(async () => initHtmlWithTokens);
    const probeChats = mock(async () => ["chat1"]);
    
    const classifier = new SessionClassifier({
      fetchInitHtml: fakeFetch,
      probeChats,
      logger: makeLogger() as never,
    });
    
    const results = await Promise.all([
      classifier.classify("test-profile"),
      classifier.classify("test-profile"),
      classifier.classify("test-profile"),
    ]);
    
    expect(results.every(r => r === "live")).toBe(true);
  });
});

describe("auth-regression: probe purity (read-only, no side effects)", () => {
  test("probe writes nothing to disk", async () => {
    const testJar = freshFullJar();
    await setupTestProfile(testJar);
    
    const initHtmlWithTokens = `
      <html>
        <body>
          <script data-initial-state="SNIPET">SNlM0e</script>
        </body>
      </html>
    `;
    
    const fakeFetch = mock(async () => initHtmlWithTokens);
    const probeChats = mock(async () => ["chat1"]);
    
    const classifier = new SessionClassifier({
      fetchInitHtml: fakeFetch,
      probeChats,
      logger: makeLogger() as never,
    });
    
    const result = await classifier.classifyDetailed("test-profile");
    
    expect(result.state).toBe("live");
    
    const cookieStore = new CookieStore();
    const finalJar = await cookieStore.load("test-profile");
    expect(finalJar.cookies.length).toBe(testJar.length);
  });

  test("probe does not fire rotation", async () => {
    await setupTestProfile(freshFullJar());
    
    const initHtmlWithTokens = `
      <html>
        <body>
          <script data-initial-state="SNIPET">SNlM0e</script>
        </body>
      </html>
    `;
    
    const fakeFetch = mock(async () => initHtmlWithTokens);
    const probeChats = mock(async () => ["chat1"]);
    
    const rotateCalls: any[] = [];
    const refresher = {
      rotatePsidts: mock(async () => {
        rotateCalls.push(Date.now());
        return { rotated: false };
      }),
    };
    
    const classifier = new SessionClassifier({
      fetchInitHtml: fakeFetch,
      probeChats,
      logger: makeLogger() as never,
    });
    
    await classifier.classifyDetailed("test-profile");
    
    expect(rotateCalls.length).toBe(0);
  });

  test("jar is byte-identical before and after probe", async () => {
    const testJar = freshFullJar();
    await setupTestProfile(testJar);
    const jarBefore = JSON.stringify(testJar);
    
    const initHtmlWithTokens = `
      <html>
        <body>
          <script data-initial-state="SNIPET">SNlM0e</script>
        </body>
      </html>
    `;
    
    const fakeFetch = mock(async () => initHtmlWithTokens);
    const probeChats = mock(async () => ["chat1"]);
    
    const classifier = new SessionClassifier({
      fetchInitHtml: fakeFetch,
      probeChats,
      logger: makeLogger() as never,
    });
    
    await classifier.classifyDetailed("test-profile");
    
    const cookieStore = new CookieStore();
    const finalJar = await cookieStore.load("test-profile");
    const jarAfter = JSON.stringify(finalJar.cookies);
    expect(jarAfter).toBe(jarBefore);
  });
});