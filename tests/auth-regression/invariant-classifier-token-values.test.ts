// Invariant: init-token presence is value-extracted (fix-6).
// Gemini's signed-out init HTML still embeds the init-token keys with empty
// values (e.g. `"cfb2h":""`), which a substring-name check mis-reads as
// "tokens present" and lets the chats probe run — declaring a fully signed-out
// profile live/phantom instead of dead. Presence must be decided by extracting
// the values with the ablation §6.2 regexes (`/"<token>":\s*"(.*?)"/`); at
// least one required token must yield a non-empty value, otherwise the init GET
// classifies dead and the chats probe is never consulted.
import { describe, test, expect, mock, beforeEach, afterEach } from "bun:test";
import { CookieStore } from "../../src/auth/cookie-store.ts";
import { SessionClassifier } from "../../src/auth/session-classifier.ts";
import { freshFullJar } from "./fixtures.ts";
import { setupIsolation, teardownIsolation } from "./harness.ts";

beforeEach(setupIsolation);
afterEach(teardownIsolation);

async function seedJar(): Promise<void> {
  await new CookieStore().saveFullJar("test-profile", freshFullJar());
}

function classifierFor(html: string, chats: unknown[]) {
  return new SessionClassifier({
    fetchInitHtml: mock(async () => html),
    probeChats: mock(async () => chats),
  });
}

describe("auth-regression: classifier init-token value extraction", () => {
  // Signed-out shape: every required key present but value-extracted as empty.
  // A substring scan on the key names passes; a value-extraction scan must not.
  const SIGNED_OUT_KEYS_EMPTY = [
    "window.WIZ_global_data = {",
    '"SNlM0e":"",',
    '"cfb2h":"",',
    '"FdrFJe":"",',
    "};",
  ].join("");

  test("empty-value keys classify dead without consulting probeChats", async () => {
    await seedJar();
    const probeChats = mock(async () => [{ id: "should-not-be-seen" }]);
    const classifier = new SessionClassifier({
      fetchInitHtml: mock(async () => SIGNED_OUT_KEYS_EMPTY),
      probeChats,
    });

    expect(await classifier.classify("test-profile")).toBe("dead");
    expect(probeChats).not.toHaveBeenCalled();
  });

  test("empty-value keys -> classifyDetailed reports dead with chatCount 0", async () => {
    await seedJar();
    const probeChats = mock(async () => [{ id: "should-not-be-seen" }]);
    const classifier = new SessionClassifier({
      fetchInitHtml: mock(async () => SIGNED_OUT_KEYS_EMPTY),
      probeChats,
    });

    expect(await classifier.classifyDetailed("test-profile")).toEqual({
      state: "dead",
      chatCount: 0,
    });
    expect(probeChats).not.toHaveBeenCalled();
  });

  // One required token with a non-empty extracted value is sufficient to
  // proceed to the chats probe (per design: any-token sufficiency).
  const ONE_NON_EMPTY = [
    "window.WIZ_global_data = {",
    '"SNlM0e":"abc123",',
    '"cfb2h":"",',
    '"FdrFJe":"",',
    "};",
  ].join("");

  test("one non-empty extracted value proceeds to chats probe", async () => {
    await seedJar();
    const result = await classifierFor(ONE_NON_EMPTY, [{ id: "c1" }]).classifyDetailed("test-profile");
    expect(result).toEqual({ state: "live", chatCount: 1 });
  });

  test("one non-empty extracted value + zero chats -> phantom", async () => {
    await seedJar();
    const result = await classifierFor(ONE_NON_EMPTY, []).classifyDetailed("test-profile");
    expect(result).toEqual({ state: "phantom", chatCount: 0 });
  });

  // Whitespace tolerance mirrors the ablation §6.2 pattern (`\s*` between
  // key colon and value quote). A key that *looks* name-present by substring
  // but extracts to an empty value still classifies dead.
  const WHITESPACE_TOLERATED_EMPTY = [
    "window.WIZ_global_data = {",
    '"SNlM0e": "",',
    '"cfb2h":"",',
    '"FdrFJe":"",',
    "};",
  ].join("");

  test("whitespace-tolerated empty values classify dead", async () => {
    await seedJar();
    const probeChats = mock(async () => [{ id: "c1" }]);
    const classifier = new SessionClassifier({
      fetchInitHtml: mock(async () => WHITESPACE_TOLERATED_EMPTY),
      probeChats,
    });

    expect(await classifier.classify("test-profile")).toBe("dead");
    expect(probeChats).not.toHaveBeenCalled();
  });
});