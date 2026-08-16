import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { closeSync, writeSync } from "node:fs";
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
  openAppendFd,
  IOError,
} from "../../src/infrastructure/io.ts";

const TEST_ROOT = join(tmpdir(), `gemiterm-io-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);

beforeEach(async () => {
  await ensureDir(TEST_ROOT);
});

afterEach(async () => {
  try {
    await removeDir(TEST_ROOT);
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
  test("creates a directory that does not exist", async () => {
    const dir = join(TEST_ROOT, "new-dir");
    expect(await existsFile(dir)).toBe(false);
    await ensureDir(dir);
    expect(await existsFile(dir)).toBe(true);
    expect(await isDirectory(dir)).toBe(true);
  });

  test("creates nested directories recursively", async () => {
    const dir = join(TEST_ROOT, "a", "b", "c");
    expect(await existsFile(dir)).toBe(false);
    await ensureDir(dir);
    expect(await isDirectory(dir)).toBe(true);
    expect(await isDirectory(join(TEST_ROOT, "a", "b"))).toBe(true);
    expect(await isDirectory(join(TEST_ROOT, "a"))).toBe(true);
  });

  test("is a no-op on an existing directory", async () => {
    await ensureDir(TEST_ROOT);
    await expect(ensureDir(TEST_ROOT)).resolves.toBeUndefined();
  });
});

describe("existsFile", () => {
  test("returns true for an existing file", async () => {
    const file = join(TEST_ROOT, "marker.txt");
    await ensureDir(TEST_ROOT);
    await writeTextFile(file, "x");
    expect(await existsFile(file)).toBe(true);
  });

  test("returns false for a missing file", async () => {
    expect(await existsFile(join(TEST_ROOT, "nope.txt"))).toBe(false);
  });
});

describe("readTextFile", () => {
  test("reads an existing file as UTF-8", async () => {
    const file = join(TEST_ROOT, "read.txt");
    await writeTextFile(file, "hello");
    expect(await readTextFile(file)).toBe("hello");
  });

  test("throws IOError on a missing file", async () => {
    await expect(readTextFile(join(TEST_ROOT, "nope.txt"))).rejects.toThrow(IOError);
  });
});

describe("safeReadTextFile", () => {
  test("returns the content of an existing file", async () => {
    const file = join(TEST_ROOT, "safe.txt");
    await writeTextFile(file, "content");
    expect(await safeReadTextFile(file)).toBe("content");
  });

  test("returns the empty string on a missing file", async () => {
    expect(await safeReadTextFile(join(TEST_ROOT, "nope.txt"))).toBe("");
  });
});

describe("writeTextFile", () => {
  test("writes a new file", async () => {
    const file = join(TEST_ROOT, "out.txt");
    await writeTextFile(file, "data");
    expect(await existsFile(file)).toBe(true);
    expect(await readTextFile(file)).toBe("data");
  });

  test("creates nested directories that do not exist", async () => {
    const file = join(TEST_ROOT, "nested", "deep", "out.txt");
    await writeTextFile(file, "data");
    expect(await readTextFile(file)).toBe("data");
  });
});

describe("readJsonFile and writeJsonFile", () => {
  test("round-trips a JSON object", async () => {
    const file = join(TEST_ROOT, "obj.json");
    const original = { a: 1, b: ["x", "y"], c: { nested: true } };
    await writeJsonFile(file, original);
    const read = await readJsonFile<typeof original>(file);
    expect(read).toEqual(original);
  });

  test("readJsonFile throws on missing file", async () => {
    await expect(readJsonFile(join(TEST_ROOT, "missing.json"))).rejects.toThrow(IOError);
  });
});

describe("removeDir", () => {
  test("removes a directory recursively", async () => {
    const dir = join(TEST_ROOT, "rm");
    await ensureDir(dir);
    await writeTextFile(join(dir, "f.txt"), "x");
    expect(await existsFile(dir)).toBe(true);
    await removeDir(dir);
    expect(await existsFile(dir)).toBe(false);
  });

  test("is a no-op on a missing path", async () => {
    await expect(removeDir(join(TEST_ROOT, "nope"))).resolves.toBeUndefined();
  });
});

describe("renameDir", () => {
  test("renames a directory", async () => {
    const src = join(TEST_ROOT, "src");
    const dest = join(TEST_ROOT, "dest");
    await ensureDir(src);
    expect(await isDirectory(src)).toBe(true);
    await renameDir(src, dest);
    expect(await isDirectory(src)).toBe(false);
    expect(await isDirectory(dest)).toBe(true);
  });

  test("throws when source is missing", async () => {
    await expect(renameDir(join(TEST_ROOT, "nope"), join(TEST_ROOT, "dest"))).rejects.toThrow(IOError);
  });
});

describe("isDirectory", () => {
  test("returns true for a directory", async () => {
    expect(await isDirectory(TEST_ROOT)).toBe(true);
  });

  test("returns false for a file", async () => {
    const file = join(TEST_ROOT, "f.txt");
    await writeTextFile(file, "x");
    expect(await isDirectory(file)).toBe(false);
  });

  test("returns false for a missing path", async () => {
    expect(await isDirectory(join(TEST_ROOT, "nope"))).toBe(false);
  });
});

describe("listSubdirectories", () => {
  test("returns only subdirectory names", async () => {
    await ensureDir(join(TEST_ROOT, "a"));
    await ensureDir(join(TEST_ROOT, "b"));
    await writeTextFile(join(TEST_ROOT, "not-a-dir.txt"), "x");
    const subs = (await listSubdirectories(TEST_ROOT)).sort();
    expect(subs).toEqual(["a", "b"]);
  });

  test("returns an empty array for a missing path", async () => {
    expect(await listSubdirectories(join(TEST_ROOT, "nope"))).toEqual([]);
  });
});

describe("openAppendFd", () => {
  test("creates parent dirs and the file, and appends across reopens", async () => {
    const file = join(TEST_ROOT, "nested", "dir", "gemiterm.log");
    const fd1 = openAppendFd(file);
    writeSync(fd1, "first\n");
    closeSync(fd1);
    const fd2 = openAppendFd(file);
    writeSync(fd2, "second\n");
    closeSync(fd2);
    expect(await readTextFile(file)).toBe("first\nsecond\n");
  });

  test("wraps failures in IOError", async () => {
    await writeTextFile(join(TEST_ROOT, "blocker.txt"), "x");
    expect(() => openAppendFd(join(TEST_ROOT, "blocker.txt", "child.log"))).toThrow(IOError);
  });
});
