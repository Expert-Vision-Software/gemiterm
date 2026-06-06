#!/usr/bin/env bun

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { readFileSync } from "node:fs";
import { showHelp } from "./commands/help.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(resolve(__dirname, "..", "..", "package.json"), "utf-8"));

const args = process.argv.slice(2);

if (args.length === 0) {
  showHelp();
  process.exit(0);
}

const program = new Command();

program
  .name("gemiterm")
  .description("Google Gemini Terminal Client")
  .version(pkg.version, "-v, --version", "Show version number")
  .helpOption("-h, --help", "Show help")
  .option("--verbose", "Enable verbose output");

program.parse(process.argv, { from: "user" });
