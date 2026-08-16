import chalk from "chalk";
import type { AuthResult, Cookie } from "../core/types.ts";
import type { Logger } from "../infrastructure/logger.ts";
import { AuthenticationError, LoginTimeoutError } from "../core/errors.ts";
import { getDefaultProfileName } from "../infrastructure/config.ts";
import { validateProfileName } from "../infrastructure/validators.ts";
import { isRunningElevated, ElevationError } from "../infrastructure/elevation.ts";
import { CookieValidator, findRoutableCookieValue } from "./cookie-validation.ts";
import { CookieStore } from "./cookie-store.ts";
import { SessionClassifier } from "./session-classifier.ts";
import { BrowserRefresher, type RefresherDriver, type RotationResult } from "./browser-refresher.ts";
import { RecoveryRung } from "./recovery.ts";
import { PlaywrightCliDriver } from "../services/playwright-cli-driver.ts";
import {
  GEMINI_APP_URL,
  PSIDTS_COOKIE_NAME,
  PSID_COOKIE_NAME,
  filterToGeminiDomains,
} from "./auth-constants.ts";
import { sleep } from "./timing.ts";
import { spawnDetachedRefreshRunner } from "./refresh-runner.ts";

const STALE_JAR_MS = 30 * 60 * 1000;
const DEFAULT_LOGIN_TIMEOUT_MS = 300_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;

export interface ArmedSession {
  secure_1psid: string;
  secure_1psidts: string | null;
  cookies: Cookie[];
}

export interface CaptureDriver {
  openHeaded(url: string, profile: string, session?: string): Promise<void>;
  cookieList(session: string): Promise<Cookie[]>;
  cookieListFromState(session: string): Promise<Cookie[]>;
  closeSession(session: string): Promise<void>;
}

export interface CookieSessionDeps {
  cookieStore: Pick<CookieStore, "load" | "getJarMtime" | "saveFullJar">;
  validator: Pick<CookieValidator, "validate">;
  refresher: Pick<BrowserRefresher, "rotatePsidts">;
  classifier: Pick<SessionClassifier, "classify">;
  recovery: Pick<RecoveryRung, "recover">;
  logger: Logger;
  spawnRefreshRunner: (profile: string) => void;
  listProfiles: () => Promise<string[]>;
  conversationLookup: { profileHasConversation(profileName: string, conversationId: string): Promise<boolean> };
  driver: CaptureDriver;
  pollIntervalMs?: number;
}

function arm(cookies: Cookie[]): ArmedSession {
  const config = toSdkCookieConfig(cookies);
  return {
    secure_1psid: config.secure1psid,
    secure_1psidts: config.secure1psidts,
    cookies,
  };
}

export function toSdkCookieConfig(cookies: Cookie[]): { secure1psid: string; secure1psidts: string | null } {
  return {
    secure1psid: findRoutableCookieValue(cookies, PSID_COOKIE_NAME) ?? "",
    secure1psidts: findRoutableCookieValue(cookies, PSIDTS_COOKIE_NAME),
  };
}

export function psidtsExpiry(cookies: Cookie[]): Date | null {
  for (const cookie of cookies) {
    if (cookie.name === PSIDTS_COOKIE_NAME && cookie.expires > 0) {
      return new Date(cookie.expires * 1000);
    }
  }
  return null;
}

export class CookieSession {
  private readonly deps: CookieSessionDeps;
  private readonly pollIntervalMs: number;
  private readonly spawnedRunnerProfiles = new Set<string>();

  constructor(deps: CookieSessionDeps) {
    this.deps = deps;
    this.pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  async ensureSession(profile?: string): Promise<ArmedSession> {
    const name = profile ?? await getDefaultProfileName();
    validateProfileName(name);

    const { cookies } = await this.deps.cookieStore.load(name);
    this.deps.validator.validate(cookies);

    const mtime = await this.deps.cookieStore.getJarMtime(name);
    if ((mtime === null || Date.now() - mtime.getTime() > STALE_JAR_MS) && !this.spawnedRunnerProfiles.has(name)) {
      this.spawnedRunnerProfiles.add(name);
      this.deps.spawnRefreshRunner(name);
    }

    return arm(cookies);
  }

  async captureLogin(
    profile?: string,
    opts: { mode?: "auth" | "renew"; timeoutMs?: number } = {},
  ): Promise<AuthResult> {
    const mode = opts.mode ?? "auth";
    const timeoutMs = opts.timeoutMs ?? DEFAULT_LOGIN_TIMEOUT_MS;
    const name = profile ?? await getDefaultProfileName();
    validateProfileName(name);

    if (isRunningElevated()) {
      throw new ElevationError();
    }

    this.notify(name, mode);
    try {
      await this.deps.driver.openHeaded(GEMINI_APP_URL, name, name);
      await this.waitForGate(name, timeoutMs);

      const jar = await this.deps.driver.cookieListFromState(name);
      const payload = filterToGeminiDomains(jar);
      await this.deps.cookieStore.saveFullJar(name, payload);

      const expiresAt = psidtsExpiry(payload);
      this.confirm(mode, payload.length, expiresAt, payload);
      return { cookies: payload, expiresAt };
    } finally {
      try {
        await this.deps.driver.closeSession(name);
      } catch (err) {
        this.deps.logger.warn(`Failed to close browser: ${err}`);
      }
    }
  }

  async probe(profile: string): Promise<"live" | "phantom" | "dead"> {
    return await this.deps.classifier.classify(profile);
  }

  async refresh(profile: string): Promise<RotationResult> {
    const { cookies } = await this.deps.cookieStore.load(profile);
    const baseline = findRoutableCookieValue(cookies, PSIDTS_COOKIE_NAME);
    return await this.deps.refresher.rotatePsidts(profile, baseline);
  }

  async recover(profile: string): Promise<ArmedSession> {
    return await this.deps.recovery.recover(profile);
  }

  async activeProfiles(): Promise<string[]> {
    const profiles = await this.deps.listProfiles();
    const active: string[] = [];
    for (const name of profiles) {
      const state = await this.deps.classifier.classify(name).catch(() => "dead" as const);
      if (state === "live") {
        active.push(name);
      }
    }
    return active;
  }

  async findProfileForConversation(conversationId: string): Promise<string | null> {
    const profiles = await this.activeProfiles();
    for (const name of profiles) {
      try {
        if (await this.deps.conversationLookup.profileHasConversation(name, conversationId)) {
          return name;
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  private async waitForGate(session: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        const cookies = await this.deps.driver.cookieList(session);
        const names = new Set(cookies.map((c) => c.name));
        if (names.has(PSID_COOKIE_NAME) && names.has(PSIDTS_COOKIE_NAME)) {
          return;
        }
      } catch (err) {
        this.deps.logger.debug(`Gate poll failed: ${err}`);
      }
      if (Date.now() >= deadline) {
        throw new LoginTimeoutError(timeoutMs);
      }
      await sleep(this.pollIntervalMs);
    }
  }

  private notify(profileName: string, mode: "auth" | "renew"): void {
    if (mode === "renew") {
      console.log(chalk.cyan(`\n🔄 Renewing session → ${GEMINI_APP_URL}  (profile: ${profileName})`));
      console.log(
        chalk.dim("   Loading existing cookies — if expired, log in to extend your session.\n"),
      );
      return;
    }
    console.log(chalk.cyan(`\n🔍 Opening headed browser → ${GEMINI_APP_URL}  (profile: ${profileName})`));
    console.log(
      chalk.dim("   Log in manually — we'll auto-detect and close the browser when you're in.\n"),
    );
  }

  private confirm(mode: "auth" | "renew", cookieCount: number, expiresAt: Date | null, cookies: Cookie[]): void {
    if (mode === "renew") {
      console.log(chalk.green(`\n✅ Session renewed — saving state…`));
      console.log(chalk.green(`Renewal successful! (${cookieCount} cookies captured)`));
    } else {
      console.log(chalk.green(`\n✅ Login auto-detected — saving state…`));
      console.log(chalk.green(`\nAuthentication successful! (${cookieCount} cookies captured)`));
    }
    if (expiresAt) {
      console.log(chalk.dim(`Session expires: ${expiresAt.toLocaleString()}`));
    }
    const hasSid = cookies.some((c) => c.name === PSID_COOKIE_NAME);
    console.log(chalk.dim(`   Has ${PSID_COOKIE_NAME}: ${hasSid ? "✅" : "❌"}`));
  }
}

export interface ProbeClient {
  listChats(options?: { limit?: number }): Promise<{ id: string }[]>;
}

export interface CreateCookieSessionDeps {
  logger: Logger;
  driver?: CaptureDriver & RefresherDriver;
  cookieStore?: CookieStore;
  listProfiles: () => Promise<string[]>;
  spawnRefreshRunner?: (profile: string) => void;
  createProbeClient: (
    config: { secure1psid: string; secure1psidts: string | null },
    profile: string,
  ) => ProbeClient | Promise<ProbeClient>;
}

export function createCookieSession(deps: CreateCookieSessionDeps): CookieSession {
  const logger = deps.logger;
  const cookieStore = deps.cookieStore ?? new CookieStore();
  const driver = deps.driver ?? new PlaywrightCliDriver();
  const refresher = new BrowserRefresher({ driver, cookieStore, logger });

  const makeProbeClient = async (profile: string): Promise<ProbeClient> => {
    const { cookies } = await cookieStore.load(profile);
    return await deps.createProbeClient(toSdkCookieConfig(cookies), profile);
  };

  const classifier = new SessionClassifier({
    cookieStore,
    probeChats: async (profile) =>
      await makeProbeClient(profile).then((c) => c.listChats({ limit: 1 })).catch(() => []),
  });

  let session!: CookieSession;
  const recovery = new RecoveryRung({
    refresher,
    cookieStore,
    logger,
    rearm: async (profile) => session.ensureSession(profile),
  });

  session = new CookieSession({
    cookieStore,
    validator: new CookieValidator({ logger }),
    refresher,
    classifier,
    recovery,
    logger,
    spawnRefreshRunner: deps.spawnRefreshRunner ?? spawnDetachedRefreshRunner,
    listProfiles: deps.listProfiles,
    conversationLookup: {
      profileHasConversation: async (profileName, conversationId) => {
        try {
          const chats = await makeProbeClient(profileName).then((c) => c.listChats());
          return chats.some((chat) => chat.id === conversationId);
        } catch {
          return false;
        }
      },
    },
    driver,
  });
  return session;
}
