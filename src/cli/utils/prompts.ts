import chalk from "chalk";
import figures from "@inquirer/figures";
import {
  confirm as inquirerConfirm,
  select as inquirerSelect,
} from "@inquirer/prompts";
import {
  createPrompt,
  useState,
  useKeypress,
  useMemo,
  useEffect,
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

const textInputPrompt = createPrompt<string, TextOptions>(
  (config, done) => {
    const [status, setStatus] = useState<"idle" | "loading" | "done">("idle");
    const [defaultValue, setDefaultValue] = useState(
      String(config.default ?? ""),
    );
    const [errorMsg, setError] = useState<string | undefined>(undefined);
    const [value, setValue] = useState("");

    async function validateValue(val: string): Promise<true | string> {
      if (typeof config.validate === "function") {
        return (await config.validate(val)) || "You must provide a valid value";
      }
      return true;
    }

    useKeypress(async (key, rl) => {
      if (status !== "idle") return;

      if (isEnterKey(key)) {
        const answer = value || defaultValue;
        setStatus("loading");
        const isValid = await validateValue(answer);
        if (isValid === true) {
          setValue(answer);
          setStatus("done");
          done(answer);
        } else {
          rl.write(value);
          setError(isValid);
          setStatus("idle");
        }
        return;
      }

      if (isBackspaceKey(key)) {
        if (!value) {
          setDefaultValue("");
        } else if (rl.line === value) {
          rl.line = value.slice(0, -1);
          setValue(rl.line);
        } else {
          setValue(rl.line);
        }
        setError(undefined);
        return;
      }

      setValue(rl.line);
      setError(undefined);
    });

    const message = theme.style.message(config.message, status);
    let formattedValue = value;
    if (status === "done") {
      formattedValue = theme.style.answer(value);
    }
    let defaultStr: string | undefined;
    if (defaultValue && status !== "done" && !value) {
      defaultStr = theme.style.defaultAnswer(defaultValue);
    }
    let error = "";
    if (errorMsg) {
      error = theme.style.error(errorMsg);
    }
    return [
      [theme.prefix.idle, message, defaultStr, formattedValue]
        .filter((v) => v !== undefined)
        .join(" "),
      error,
    ];
  },
);

export async function text(opts: TextOptions): Promise<string> {
  requireTty(`gemiterm new "Your message"`);
  try {
    return await textInputPrompt(
      {
        message: opts.message,
        default: opts.default,
        validate: opts.validate,
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
  | "delete"
  | "back"
  | "quit";

export type BrowserResult =
  | { kind: "pick"; chat: ChatInfo; action: BrowserAction }
  | { kind: "quit" };

export interface BrowserConfig {
  chats: ReadonlyArray<ChatInfo>;
  initialSort?: "recent" | "oldest" | "alpha";
  pageSize?: number;
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
    const [windowStart, setWindowStart] = useState<number>(0);

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

    const pageSize = useMemo(() => {
      if (typeof config.pageSize === "number" && config.pageSize > 0) {
        return config.pageSize;
      }
      const rows = process.stdout.rows ?? 24;
      return Math.max(5, Math.floor((rows - 4) * 0.8));
    }, [config.pageSize]);

    useEffect(() => {
      setActive(0);
      setWindowStart(0);
    }, [filteredSorted]);

    useKeypress((key) => {
      if (key.name === "s") {
        const next =
          sort === "recent" ? "oldest" : sort === "oldest" ? "alpha" : "recent";
        setSort(next);
        setActive(0);
        setWindowStart(0);
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
        setActive(0);
        setWindowStart(0);
        return;
      }

      if (key.name === "f") {
        setFavoritesOnly(!favoritesOnly);
        setActive(0);
        setWindowStart(0);
        return;
      }

      const total = filteredSorted.length;

      if (total === 0) {
        if (key.name === "q" || key.name === "escape") {
          done({ kind: "quit" });
        }
        return;
      }

      if (key.name === "left") {
        const currentPage = Math.floor(windowStart / pageSize);
        const newPage = Math.max(0, currentPage - 1);
        if (newPage !== currentPage) {
          setWindowStart(newPage * pageSize);
          setActive(newPage * pageSize);
        }
        return;
      }

      if (key.name === "right") {
        const totalPages = Math.max(1, Math.ceil(total / pageSize));
        const currentPage = Math.floor(windowStart / pageSize);
        const newPage = Math.min(totalPages - 1, currentPage + 1);
        if (newPage !== currentPage) {
          setWindowStart(newPage * pageSize);
          setActive(newPage * pageSize);
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
        const newActive = Math.max(0, active - 1);
        setActive(newActive);
        if (newActive < windowStart) {
          setWindowStart(newActive);
        }
        return;
      }

      if (isDownKey(key)) {
        const newActive = Math.min(total - 1, active + 1);
        setActive(newActive);
        if (newActive >= windowStart + pageSize) {
          setWindowStart(newActive - pageSize + 1);
        }
        return;
      }
    });

    const safeActive = Math.min(active, Math.max(0, filteredSorted.length - 1));
    const totalPages = Math.max(
      1,
      Math.ceil(filteredSorted.length / pageSize),
    );
    const currentPage = Math.min(
      totalPages,
      Math.floor(safeActive / pageSize) + 1,
    );
    const pageIndicator =
      totalPages > 1 ? ` | Page: ${currentPage}/${totalPages}` : "";

    const titleBar = chalk.bold(
      `Browse conversations (${filteredSorted.length} chats${pageIndicator} | Sort: ${sort} | Profile: ${profileFilter} | Favorites: ${favoritesOnly ? "on" : "off"})`,
    );
    const hintLine = chalk.dim(
      "↑↓ navigate · ← → page · s sort · p profile · f favorites · enter pick · q quit",
    );

    const renderRow = (item: ChatInfo, isActive: boolean): string => {
      const cursor = isActive ? "> " : "  ";
      const id = chalk.dim(item.id);
      const date = chalk.cyan(formatDate(item.timestamp));
      const title = truncateTitle(item.title);
      const pin = item.isPinned ? chalk.yellow("★") : "";
      return `${cursor}${id}  ${date}  ${title}  ${pin}`;
    };

    if (filteredSorted.length === 0) {
      return [`${titleBar}\nNo conversations found.`, hintLine];
    }

    const windowEnd = Math.min(
      filteredSorted.length,
      windowStart + pageSize,
    );
    const visibleItems = filteredSorted.slice(windowStart, windowEnd);
    const rows = visibleItems
      .map((item) => renderRow(item, item === filteredSorted[safeActive]))
      .join("\n");

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
