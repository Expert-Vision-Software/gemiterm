// Invariant: CAS semantics — a stale in-memory jar cannot clobber a fresher
// disk jar (#361 class, fix-4 task 2.4). Asserts on the on-disk artifact.
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import type { Cookie } from "../../src/core/types.ts";
import { CookieStore } from "../../src/auth/cookie-store.ts";
import { freshFullJar } from "./fixtures.ts";
import { TEST_DIR, setupIsolation, teardownIsolation, psidtsValue, withPsidts } from "./harness.ts";

beforeEach(setupIsolation);
afterEach(teardownIsolation);

const jarPath = (profile: string) => join(TEST_DIR, "profiles", profile, "storage_state.json");

function psidtsOnDisk(profile: string): string | undefined {
  return psidtsValue(JSON.parse(readFileSync(jarPath(profile), "utf-8")).cookies as Cookie[]);
}

describe("auth-regression: CAS semantics", () => {
  test("stale in-memory jar cannot clobber a sibling's fresh PSIDTS rotation", async () => {
    const store = new CookieStore();
    await store.saveFullJar("test-profile", freshFullJar());

    // A loads a snapshot, then idles (stale).
    const { cookies: staleCookies, snapshot } = await store.load("test-profile");

    // Sibling rotates PSIDTS to a fresh value on disk.
    const siblingValue = `sibling-fresh-${Date.now()}`;
    await store.saveFullJar("test-profile", withPsidts(freshFullJar(), siblingValue));

    // The stale process saves its (unchanged) cookies back.
    await store.save("test-profile", staleCookies, snapshot);

    expect(psidtsOnDisk("test-profile")).toBe(siblingValue);
  });

  test("CAS preserves the sibling's PSIDTS while applying the process's own unrelated change", async () => {
    const store = new CookieStore();
    await store.saveFullJar("test-profile", freshFullJar());
    const { snapshot } = await store.load("test-profile");

    const siblingValue = `sibling-fresh-${Date.now()}`;
    await store.saveFullJar("test-profile", withPsidts(freshFullJar(), siblingValue));

    // The process changes only SID (its own edit), not PSIDTS.
    const myJar = freshFullJar().map((c) => (c.name === "SID" ? { ...c, value: "my-new-sid" } : c));
    await store.save("test-profile", myJar, snapshot);

    const disk = JSON.parse(readFileSync(jarPath("test-profile"), "utf-8")).cookies as Cookie[];
    expect(psidtsValue(disk)).toBe(siblingValue);
    expect(disk.find((c) => c.name === "SID")?.value).toBe("my-new-sid");
  });
});