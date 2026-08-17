import { describe, test, expect, mock, beforeEach } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import type { Cookie } from "../../src/core/types.ts";
import { SessionClassifier } from "../../src/auth/session-classifier.ts";

const TEST_DIR = join(tmpdir(), "gemiterm-test-classifier");

beforeEach(() => {
  process.env.GEMITERM_CONFIG_DIR = TEST_DIR;
  mkdirSync(TEST_DIR, { recursive: true });
  rmSync(join(TEST_DIR, "profiles"), { recursive: true, force: true });
});

function cookie(name: string, value: string, overrides: Partial<Cookie> = {}): Cookie {
  return {
    domain: ".google.com",
    path: "/",
    expires: Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    name,
    value,
    ...overrides,
  };
}

function writeJar(profile: string, extra: Cookie[] = []): void {
  const dir = join(TEST_DIR, "profiles", profile);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "storage_state.json"),
    JSON.stringify({
      cookies: [
        cookie("__Secure-1PSID", "a"),
        cookie("__Secure-1PSIDTS", "b"),
        ...extra,
      ],
    }),
    "utf-8",
  );
}

const HTML_WITH_TOKENS = "<html>window.WIZ_global_data = {'SNlM0e':'tok','cfb2h':'x','FdrFJe':'y'};</html>";
const HTML_WITHOUT_TOKENS = "<html>Sign in to Gemini</html>";

interface DepsShape {
  fetchInitHtml: ReturnType<typeof mock>;
  probeChats: ReturnType<typeof mock>;
}

function makeDeps(overrides: { fetchInitHtml?: DepsShape["fetchInitHtml"]; probeChats?: DepsShape["probeChats"] } = {}): DepsShape {
  return {
    fetchInitHtml: overrides.fetchInitHtml ?? mock(async () => HTML_WITH_TOKENS),
    probeChats: overrides.probeChats ?? mock(async () => [{ id: "c1" }]),
  };
}

function makeClassifier(deps: DepsShape): SessionClassifier {
  return new SessionClassifier({ fetchInitHtml: deps.fetchInitHtml, probeChats: deps.probeChats });
}

describe("SessionClassifier", () => {
  test("tokens present + at least one chat -> live", async () => {
    writeJar("p");
    const deps = makeDeps();
    expect(await makeClassifier(deps).classify("p")).toBe("live");
  });

  test("tokens present + zero chats -> phantom", async () => {
    writeJar("p");
    const deps = makeDeps({ probeChats: mock(async () => []) });
    expect(await makeClassifier(deps).classify("p")).toBe("phantom");
  });

  test("no tokens -> dead (chats probe not consulted)", async () => {
    writeJar("p");
    const deps = makeDeps({ fetchInitHtml: mock(async () => HTML_WITHOUT_TOKENS) });
    expect(await makeClassifier(deps).classify("p")).toBe("dead");
    expect(deps.probeChats).not.toHaveBeenCalled();
  });

  test("init fetch failure -> dead", async () => {
    writeJar("p");
    const deps = makeDeps({ fetchInitHtml: mock(async () => { throw new Error("net down"); }) });
    expect(await makeClassifier(deps).classify("p")).toBe("dead");
  });

  test("tokens present + chats probe failure -> phantom", async () => {
    writeJar("p");
    const deps = makeDeps({ probeChats: mock(async () => { throw new Error("AuthError"); }) });
    expect(await makeClassifier(deps).classify("p")).toBe("phantom");
  });

  test("Cookie header includes gate cookies and excludes non-routable ones", async () => {
    writeJar("p", [
      cookie("YOUTUBE_COOKIE", "yt", { domain: ".youtube.com" }),
      cookie("EXPIRED", "old", { expires: Math.floor(Date.now() / 1000) - 100 }),
    ]);
    const deps = makeDeps();
    await makeClassifier(deps).classify("p");
    expect(deps.fetchInitHtml).toHaveBeenCalledTimes(1);
    const header = deps.fetchInitHtml.mock.calls[0]![0] as string;
    expect(header).toContain("__Secure-1PSID=a");
    expect(header).toContain("__Secure-1PSIDTS=b");
    expect(header).not.toContain("YOUTUBE_COOKIE");
    expect(header).not.toContain("EXPIRED");
  });
});

describe("classifyDetailed", () => {
  test("tokens present + 3 chats -> { state: 'live', chatCount: 3 }", async () => {
    writeJar("p");
    const deps = makeDeps({ probeChats: mock(async () => [{ id: "c1" }, { id: "c2" }, { id: "c3" }]) });
    expect(await makeClassifier(deps).classifyDetailed("p")).toEqual({ state: "live", chatCount: 3 });
  });

  test("tokens present + zero chats -> { state: 'phantom', chatCount: 0 }", async () => {
    writeJar("p");
    const deps = makeDeps({ probeChats: mock(async () => []) });
    expect(await makeClassifier(deps).classifyDetailed("p")).toEqual({ state: "phantom", chatCount: 0 });
  });

  test("no tokens -> { state: 'dead', chatCount: 0 } and chats probe not consulted", async () => {
    writeJar("p");
    const deps = makeDeps({ fetchInitHtml: mock(async () => HTML_WITHOUT_TOKENS) });
    expect(await makeClassifier(deps).classifyDetailed("p")).toEqual({ state: "dead", chatCount: 0 });
    expect(deps.probeChats).not.toHaveBeenCalled();
  });

  test("classify and classifyDetailed agree on state for the live case", async () => {
    writeJar("p");
    const classifier = makeClassifier(makeDeps());
    expect(await classifier.classify("p")).toBe("live");
    expect((await classifier.classifyDetailed("p")).state).toBe("live");
  });
});
