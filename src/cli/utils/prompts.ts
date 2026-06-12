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
  usePagination,
  makeTheme,
  isUpKey,
  isDownKey,
  isEnterKey,
  isBackspaceKey,
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
  initialFilter?: string;
  initialSort?: "recent" | "oldest" | "alpha";
  pageSize?: number;
  loop?: boolean;
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
    const pageSize = config.pageSize ?? 15;
    const loop = config.loop ?? true;

    const [mode, setMode] = useState<"browse" | "search" | "sort">("browse");
    const [filter, setFilter] = useState<string>(config.initialFilter ?? "");
    const [sort, setSort] = useState<"recent" | "oldest" | "alpha">(
      config.initialSort ?? "recent",
    );
    const [active, setActive] = useState<number>(0);
    const [searchInput, setSearchInput] = useState<string>(
      config.initialFilter ?? "",
    );

    const filteredSorted = useMemo(() => {
      const needle = filter.toLowerCase();
      const filtered = config.chats.filter((c) =>
        c.title.toLowerCase().includes(needle),
      );
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
    }, [config.chats, filter, sort]);

    useKeypress((key) => {
      const total = filteredSorted.length;

      if (mode === "search") {
        if (isEnterKey(key)) {
          setFilter(searchInput);
          setMode("browse");
        } else if (key.name === "escape") {
          setSearchInput("");
          setFilter("");
          setMode("browse");
        } else if (isBackspaceKey(key)) {
          setSearchInput(searchInput.slice(0, -1));
        } else if (key.name.length === 1 && !key.ctrl) {
          setSearchInput(searchInput + key.name);
        }
        return;
      }

      if (mode === "sort") {
        if (key.name === "escape") {
          setMode("browse");
        } else if (key.name === "1") {
          setSort("recent");
          setMode("browse");
        } else if (key.name === "2") {
          setSort("oldest");
          setMode("browse");
        } else if (key.name === "3") {
          setSort("alpha");
          setMode("browse");
        }
        return;
      }

      if (total === 0) {
        if (isEnterKey(key) || key.name === "q" || key.name === "escape") {
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

      if (key.name === "n") {
        setActive(Math.min(total - 1, active + pageSize));
        return;
      }

      if (key.name === "p") {
        setActive(Math.max(0, active - pageSize));
        return;
      }

      if (key.name === "g" && !key.shift) {
        setActive(0);
        return;
      }

      if (key.name === "G" && key.shift) {
        setActive(total - 1);
        return;
      }

      if (key.name === "s") {
        setMode("sort");
        return;
      }

      if (key.name === "/") {
        setSearchInput(filter);
        setMode("search");
        return;
      }
    });

    const titleBar = chalk.bold(
      `Browse conversations (PageSize: ${pageSize} | ${filteredSorted.length} chats | Sort: ${sort} | Filter: ${filter || "none"})`,
    );
    const hintLine = chalk.dim(
      "↑↓ navigate · n/p page · g/G top/bottom · / filter · s sort · enter pick · q quit",
    );

    const page = usePagination({
      items: filteredSorted,
      active: Math.min(active, Math.max(0, filteredSorted.length - 1)),
      pageSize,
      loop,
      renderItem: ({ item, isActive }) => {
        const cursor = isActive ? "> " : "  ";
        const id = chalk.dim(item.id);
        const date = chalk.cyan(formatDate(item.timestamp));
        const title = truncateTitle(item.title);
        const pin = item.isPinned ? chalk.yellow("★") : "";
        return `${cursor}${id}  ${date}  ${title}  ${pin}`;
      },
    });

    let top = titleBar;
    if (mode === "search") {
      top = `${top}\nSearch: ${searchInput}_`;
    } else if (mode === "sort") {
      top = `${top}\nSort: (1) recent  (2) oldest  (3) alpha  (esc cancel)`;
    }

    if (filteredSorted.length === 0) {
      return [`${top}\nNo conversations found.`, hintLine];
    }

    return [`${top}\n${page}`, hintLine];
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
