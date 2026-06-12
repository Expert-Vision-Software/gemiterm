import chalk from "chalk";
import figures from "@inquirer/figures";
import {
  input,
  confirm as inquirerConfirm,
  select as inquirerSelect,
} from "@inquirer/prompts";
import {
  createPrompt,
  useState,
  useKeypress,
  useMemo,
  makeTheme,
  isUpKey,
  isDownKey,
  isEnterKey,
  AbortPromptError,
  ExitPromptError,
} from "@inquirer/core";
import { GemitermError } from "../../core/errors.ts";
import type { ChatInfo } from "../../core/types.ts";

export class NonInteractiveError extends GemitermError {
  constructor(message: string) {
    super(message);
    this.name = "NonInteractiveError";
  }
}

export class CancellationError extends GemitermError {
  constructor(message: string) {
    super(message);
    this.name = "CancellationError";
  }
}

let activeController = new AbortController();

export function getAbortSignal(): AbortSignal {
  return activeController.signal;
}

export function abortActivePrompts(reason?: unknown): void {
  activeController.abort(reason);
}

export function resetAbortController(): void {
  activeController = new AbortController();
}

function requireTty(commandHint: string): void {
  if (process.stdin.isTTY !== true) {
    throw new NonInteractiveError(
      `Interactive prompts are disabled in non-TTY contexts. ${commandHint}`,
    );
  }
}

function mapCancellation(error: unknown): never {
  if (error instanceof ExitPromptError || error instanceof AbortPromptError) {
    throw new CancellationError(error.message);
  }
  throw error;
}

const theme = makeTheme({
  prefix: { idle: chalk.cyan("?"), done: chalk.green(figures.tick) },
  style: {
    error: (text: string) => chalk.red("> " + text),
    keysHelpTip: (_keys: ReadonlyArray<readonly [string, string]>) => undefined,
    description: (text: string) => chalk.cyan.dim(text),
    disabled: (text: string) => chalk.dim(text),
  },
});

export interface TextOptions {
  message: string;
  default?: string;
  validate?: (value: string) => boolean | string | Promise<string | boolean>;
}

export async function text(opts: TextOptions): Promise<string> {
  requireTty(`gemiterm new "Your message"`);
  try {
    return await input(
      {
        message: opts.message,
        default: opts.default,
        validate: opts.validate,
        theme,
      },
      { signal: getAbortSignal() },
    );
  } catch (error) {
    mapCancellation(error);
  }
}

export interface ConfirmOptions {
  message: string;
  default?: boolean;
}

export async function confirm(opts: ConfirmOptions): Promise<boolean> {
  requireTty(`gemiterm <subcommand> --force`);
  try {
    return await inquirerConfirm(
      { message: opts.message, default: opts.default, theme },
      { signal: getAbortSignal() },
    );
  } catch (error) {
    mapCancellation(error);
  }
}

export interface SelectChoice<T> {
  value: T;
  label: string;
  description?: string;
  disabled?: boolean | string;
}

export interface SelectOptions<T> {
  message: string;
  choices: ReadonlyArray<SelectChoice<T>>;
  default?: T;
  pageSize?: number;
}

export async function select<T>(opts: SelectOptions<T>): Promise<T> {
  requireTty(`gemiterm <subcommand> --format json`);
  const choices = opts.choices.map((c) => ({
    value: c.value,
    name: c.label,
    description: c.description,
    disabled: c.disabled,
  }));
  try {
    return await inquirerSelect(
      {
        message: opts.message,
        choices,
        default: opts.default,
        pageSize: opts.pageSize,
        theme,
      },
      { signal: getAbortSignal() },
    );
  } catch (error) {
    mapCancellation(error);
  }
}

export type BrowserAction =
  | "view"
  | "export-markdown"
  | "export-json"
  | "copy-id"
  | "back"
  | "quit";

export type BrowserResult =
  | { kind: "pick"; chat: ChatInfo; action: BrowserAction }
  | { kind: "quit" };

export interface BrowserConfig {
  chats: ReadonlyArray<ChatInfo>;
  initialSort?: "recent" | "oldest" | "alpha";
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 16).replace("T", " ");
}

const TITLE_MAX = 55;

export function truncateTitle(title: string): string {
  if (title.length <= TITLE_MAX) return title;
  return `${title.slice(0, TITLE_MAX - 1)}…`;
}

export const browserPrompt = createPrompt<BrowserResult, BrowserConfig>(
  (config, done) => {
    const [sort, setSort] = useState<"recent" | "oldest" | "alpha">(
      config.initialSort ?? "recent",
    );
    const [profileFilter, setProfileFilter] = useState<"all" | string>("all");
    const [favoritesOnly, setFavoritesOnly] = useState<boolean>(false);
    const [active, setActive] = useState<number>(0);

    const profileNames = useMemo(() => {
      const seen = new Set<string>();
      for (const c of config.chats) {
        if (c.profile) seen.add(c.profile);
      }
      return Array.from(seen);
    }, [config.chats]);

    const filteredSorted = useMemo(() => {
      const filtered = config.chats.filter((c) => {
        if (profileFilter !== "all" && c.profile !== profileFilter) return false;
        if (favoritesOnly && !c.isPinned) return false;
        return true;
      });
      const sorted = [...filtered];
      switch (sort) {
        case "recent":
          sorted.sort((a, b) => b.timestamp - a.timestamp);
          break;
        case "oldest":
          sorted.sort((a, b) => a.timestamp - b.timestamp);
          break;
        case "alpha":
          sorted.sort((a, b) => a.title.localeCompare(b.title));
          break;
      }
      return sorted;
    }, [config.chats, sort, profileFilter, favoritesOnly]);

    useKeypress((key) => {
      if (key.name === "s") {
        const next =
          sort === "recent" ? "oldest" : sort === "oldest" ? "alpha" : "recent";
        setSort(next);
        return;
      }

      if (key.name === "p") {
        const cycle = ["all", ...profileNames];
        if (cycle.length === 0) {
          setProfileFilter("all");
        } else {
          const currentIndex = cycle.indexOf(profileFilter);
          const nextIndex = (currentIndex + 1) % cycle.length;
          setProfileFilter(cycle[nextIndex] ?? "all");
        }
        return;
      }

      if (key.name === "f") {
        setFavoritesOnly(!favoritesOnly);
        return;
      }

      const total = filteredSorted.length;

      if (total === 0) {
        if (key.name === "q" || key.name === "escape") {
          done({ kind: "quit" });
        }
        return;
      }

      if (isEnterKey(key)) {
        const chat = filteredSorted[active];
        if (chat) {
          done({ kind: "pick", chat, action: "back" });
        }
        return;
      }

      if (key.name === "q" || key.name === "escape") {
        done({ kind: "quit" });
        return;
      }

      if (isUpKey(key)) {
        setActive(Math.max(0, active - 1));
        return;
      }

      if (isDownKey(key)) {
        setActive(Math.min(total - 1, active + 1));
        return;
      }
    });

    const titleBar = chalk.bold(
      `Browse conversations (${filteredSorted.length} chats | Sort: ${sort} | Profile: ${profileFilter} | Favorites: ${favoritesOnly ? "on" : "off"})`,
    );
    const hintLine = chalk.dim(
      "↑↓ navigate · s sort · p profile · f favorites · enter pick · q quit",
    );

    const renderRow = (item: ChatInfo, isActive: boolean): string => {
      const cursor = isActive ? "> " : "  ";
      const id = chalk.dim(item.id);
      const date = chalk.cyan(formatDate(item.timestamp));
      const title = truncateTitle(item.title);
      const pin = item.isPinned ? chalk.yellow("★") : "";
      return `${cursor}${id}  ${date}  ${title}  ${pin}`;
    };

    const safeActive = Math.min(active, Math.max(0, filteredSorted.length - 1));
    const rows = filteredSorted
      .map((chat, i) => renderRow(chat, i === safeActive))
      .join("\n");

    if (filteredSorted.length === 0) {
      return [`${titleBar}\nNo conversations found.`, hintLine];
    }

    return [`${titleBar}\n${rows}`, hintLine];
  },
);

export async function browser(config: BrowserConfig): Promise<BrowserResult> {
  requireTty(
    "gemiterm list -i requires a TTY; use --format json for machine-readable output",
  );
  try {
    return await browserPrompt(config, { signal: getAbortSignal() });
  } catch (error) {
    if (error instanceof ExitPromptError || error instanceof AbortPromptError) {
      throw new CancellationError(error.message);
    }
    throw error;
  }
}
