import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  ensureDir,
  existsFile,
  readTextFile,
  safeReadTextFile,
  writeTextFile,
  readJsonFile,
  writeJsonFile,
  removeDir,
  renameDir,
  isDirectory,
  listSubdirectories,
  IOError,
} from "../../src/infrastructure/io.ts";

const TEST_ROOT = join(tmpdir(), `gemiterm-io-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

beforeEach(() => {
  ensureDir(TEST_ROOT);
});

afterEach(() => {
  try {
    removeDir(TEST_ROOT);
  } catch {
    // ignore
  }
});

describe("IOError", () => {
  test("has correct name and message", () => {
    const err = new IOError("boom");
    expect(err.name).toBe("IOError");
    expect(err.message).toBe("boom");
    expect(err.cause).toBeUndefined();
  });

  test("preserves cause", () => {
    const cause = new Error("underlying");
    const err = new IOError("wrapper", cause);
    expect(err.cause).toBe(cause);
  });
});

describe("ensureDir", () => {
  test("creates a directory that does not exist", () => {
    const dir = join(TEST_ROOT, "new-dir");
    expect(existsFile(dir)).toBe(false);
    ensureDir(dir);
    expect(existsFile(dir)).toBe(true);
    expect(isDirectory(dir)).toBe(true);
  });

  test("creates nested directories recursively", () => {
    const dir = join(TEST_ROOT, "a", "b", "c");
    expect(existsFile(dir)).toBe(false);
    ensureDir(dir);
    expect(isDirectory(dir)).toBe(true);
    expect(isDirectory(join(TEST_ROOT, "a", "b"))).toBe(true);
    expect(isDirectory(join(TEST_ROOT, "a"))).toBe(true);
  });

  test("is a no-op on an existing directory", () => {
    ensureDir(TEST_ROOT);
    expect(() => ensureDir(TEST_ROOT)).not.toThrow();
  });
});

describe("existsFile", () => {
  test("returns true for an existing file", () => {
    const file = join(TEST_ROOT, "marker.txt");
    ensureDir(TEST_ROOT);
    writeTextFile(file, "x");
    expect(existsFile(file)).toBe(true);
  });

  test("returns false for a missing file", () => {
    expect(existsFile(join(TEST_ROOT, "nope.txt"))).toBe(false);
  });
});

describe("readTextFile", () => {
  test("reads an existing file as UTF-8", () => {
    const file = join(TEST_ROOT, "read.txt");
    writeTextFile(file, "hello");
    expect(readTextFile(file)).toBe("hello");
  });

  test("throws IOError on a missing file", () => {
    expect(() => readTextFile(join(TEST_ROOT, "nope.txt"))).toThrow(IOError);
  });
});

describe("safeReadTextFile", () => {
  test("returns the content of an existing file", () => {
    const file = join(TEST_ROOT, "safe.txt");
    writeTextFile(file, "content");
    expect(safeReadTextFile(file)).toBe("content");
  });

  test("returns the empty string on a missing file", () => {
    expect(safeReadTextFile(join(TEST_ROOT, "nope.txt"))).toBe("");
  });
});

describe("writeTextFile", () => {
  test("writes a new file", () => {
    const file = join(TEST_ROOT, "out.txt");
    writeTextFile(file, "data");
    expect(existsFile(file)).toBe(true);
    expect(readTextFile(file)).toBe("data");
  });

  test("creates nested directories that do not exist", () => {
    const file = join(TEST_ROOT, "nested", "deep", "out.txt");
    writeTextFile(file, "data");
    expect(readTextFile(file)).toBe("data");
  });
});

describe("readJsonFile and writeJsonFile", () => {
  test("round-trips a JSON object", () => {
    const file = join(TEST_ROOT, "obj.json");
    const original = { a: 1, b: ["x", "y"], c: { nested: true } };
    writeJsonFile(file, original);
    const read = readJsonFile<typeof original>(file);
    expect(read).toEqual(original);
  });

  test("readJsonFile throws on missing file", () => {
    expect(() => readJsonFile(join(TEST_ROOT, "missing.json"))).toThrow(IOError);
  });
});

describe("removeDir", () => {
  test("removes a directory recursively", () => {
    const dir = join(TEST_ROOT, "rm");
    ensureDir(dir);
    writeTextFile(join(dir, "f.txt"), "x");
    expect(existsFile(dir)).toBe(true);
    removeDir(dir);
    expect(existsFile(dir)).toBe(false);
  });

  test("is a no-op on a missing path", () => {
    expect(() => removeDir(join(TEST_ROOT, "nope"))).not.toThrow();
  });
});

describe("renameDir", () => {
  test("renames a directory", () => {
    const src = join(TEST_ROOT, "src");
    const dest = join(TEST_ROOT, "dest");
    ensureDir(src);
    expect(isDirectory(src)).toBe(true);
    renameDir(src, dest);
    expect(isDirectory(src)).toBe(false);
    expect(isDirectory(dest)).toBe(true);
  });

  test("throws when source is missing", () => {
    expect(() => renameDir(join(TEST_ROOT, "nope"), join(TEST_ROOT, "dest"))).toThrow(IOError);
  });
});

describe("isDirectory", () => {
  test("returns true for a directory", () => {
    expect(isDirectory(TEST_ROOT)).toBe(true);
  });

  test("returns false for a file", () => {
    const file = join(TEST_ROOT, "f.txt");
    writeTextFile(file, "x");
    expect(isDirectory(file)).toBe(false);
  });

  test("returns false for a missing path", () => {
    expect(isDirectory(join(TEST_ROOT, "nope"))).toBe(false);
  });
});

describe("listSubdirectories", () => {
  test("returns only subdirectory names", () => {
    ensureDir(join(TEST_ROOT, "a"));
    ensureDir(join(TEST_ROOT, "b"));
    writeTextFile(join(TEST_ROOT, "not-a-dir.txt"), "x");
    const subs = listSubdirectories(TEST_ROOT).sort();
    expect(subs).toEqual(["a", "b"]);
  });

  test("returns an empty array for a missing path", () => {
    expect(listSubdirectories(join(TEST_ROOT, "nope"))).toEqual([]);
  });
});
