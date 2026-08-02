#!/usr/bin/env bun
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type Target = "bun-linux-x64" | "bun-windows-x64" | "bun-darwin-x64" | "bun-darwin-arm64";

interface Profile {
  target: Target | "host";
  outfile: string;
  minify: boolean;
}

function hostTarget(): Target {
  switch (process.platform) {
    case "win32":
      return "bun-windows-x64";
    case "darwin":
      return process.arch === "arm64" ? "bun-darwin-arm64" : "bun-darwin-x64";
    case "linux":
    default:
      return "bun-linux-x64";
  }
}

const PROFILES: Record<string, Profile> = {
  default: { target: "host", outfile: "dist/gemiterm", minify: false },
  linux: { target: "bun-linux-x64", outfile: "dist/linux/gemiterm", minify: true },
  windows: { target: "bun-windows-x64", outfile: "dist/windows/gemiterm.exe", minify: true },
};

function loadPackageJson(): { name: string; version: string } {
  const raw = readFileSync(resolve(import.meta.dir, "..", "package.json"), "utf-8");
  const parsed = JSON.parse(raw) as { name?: unknown; version?: unknown };
  if (typeof parsed.name !== "string" || typeof parsed.version !== "string") {
    throw new Error("scripts/build.ts: package.json is missing name/version strings");
  }
  return { name: parsed.name, version: parsed.version };
}

function pickProfile(): Profile {
  const requested = process.argv[2];
  if (!requested) return PROFILES.default!;
  const profile = PROFILES[requested];
  if (!profile) {
    const known = Object.keys(PROFILES).join(", ");
    throw new Error(`scripts/build.ts: unknown profile "${requested}". Known: ${known}`);
  }
  return profile;
}

function ensureWindowsExeSuffix(path: string, target: Target): string {
  if (target !== "bun-windows-x64") return path;
  return path.toLowerCase().endsWith(".exe") ? path : `${path}.exe`;
}

async function main(): Promise<void> {
  const profile = pickProfile();
  const pkg = loadPackageJson();
  const target = profile.target === "host" ? hostTarget() : profile.target;

  const projectRoot = resolve(import.meta.dir, "..");
  const outfile = resolve(projectRoot, ensureWindowsExeSuffix(profile.outfile, target));
  mkdirSync(dirname(outfile), { recursive: true });

  const result = await Bun.build({
    entrypoints: [resolve(projectRoot, "src/cli/index.ts")],
    target: "bun",
    compile: {
      target,
      outfile,
    },
    minify: profile.minify,
    define: {
      __GEMITERM_VERSION__: JSON.stringify(pkg.version),
      __GEMITERM_NAME__: JSON.stringify(pkg.name),
    },
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`scripts/build.ts: build failed for profile ${JSON.stringify(profile)}`);
  }

  console.log(`built ${profile.outfile} (target=${target}, minify=${profile.minify}, version=${pkg.version})`);
}

await main();
