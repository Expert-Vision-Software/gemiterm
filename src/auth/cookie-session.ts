import chalk from "chalk";
import type { AuthResult, Cookie } from "../core/types.ts";
import { Logger } from "../infrastructure/logger.ts";
import { AuthenticationError, LoginCancelledError, LoginTimeoutError, LoginUnroutableError } from "../core/errors.ts";
import { getDefaultProfileName } from "../infrastructure/config.ts";
import { validateProfileName } from "../infrastructure/validators.ts";
import { isRunningElevated, ElevationError } from "../infrastructure/elevation.ts";
import { CookieValidator, findRoutableCookieValue, isRoutableTo } from "./cookie-validation.ts";
import { CookieStore } from "./cookie-store.ts";
import { RotationCooldown, type RotationCooldownSeam } from "./rotation-cooldown.ts";
import { SessionKeepalive, type SessionKeepaliveOptions } from "./session-keepalive.ts";
import { SessionClassifier, type SessionProbeResult } from "./session-classifier.ts";

// The facade is the only sanctioned import surface outside src/auth — re-export the probe result type for commands.
export type { SessionProbeResult } from "./session-classifier.ts";
import { BrowserRefresher, type RefresherDriver, type RotationResult } from "./browser-refresher.ts";
import { RecoveryRung } from "./recovery.ts";
import { PlaywrightCliDriver, isBrowserClosedError } from "../services/playwright-cli-driver.ts";
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
// Wait ceiling >= the runner's rotation budget (60 s) plus browser-open
// margin (openspec/changes/fix-rotation-dead-end): the await must be able to
// cover the full rotation it is awaiting. Unraced field rotations land in
// ~6-10 s, so the common case still returns on the first or second poll.
const DEFAULT_ROTATION_WAIT_MS = 90_000;

interface ArmRecord {
  psidts: string | null;
  stale: boolean;
}

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
  cooldown: RotationCooldownSeam;
  classifier: Pick<SessionClassifier, "classify" | "classifyDetailed">;
  recovery: Pick<RecoveryRung, "recover">;
  logger: Logger;
  spawnRefreshRunner: (profile: string) => void | Promise<void>;
  listProfiles: () => Promise<string[]>;
  conversationLookup: { profileHasConversation(profileName: string, conversationId: string): Promise<boolean> };
  driver: CaptureDriver;
  pollIntervalMs?: number;
  rotationWaitMs?: number;
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
  private readonly rotationWaitMs: number;
  private readonly spawnedRunnerProfiles = new Set<string>();
  private readonly lastArm = new Map<string, ArmRecord>();

  constructor(deps: CookieSessionDeps) {
    this.deps = deps;
    this.pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.rotationWaitMs = deps.rotationWaitMs ?? DEFAULT_ROTATION_WAIT_MS;
  }

  createKeepalive(profile: string, options?: SessionKeepaliveOptions): SessionKeepalive {
    return new SessionKeepalive(profile, {
      cookieStore: this.deps.cookieStore,
      refresher: this.deps.refresher,
      cooldown: this.deps.cooldown,
      logger: new Logger("session-keepalive"),
    }, options);
  }

  async ensureSession(profile?: string): Promise<ArmedSession> {
    const name = profile ?? await getDefaultProfileName();
    validateProfileName(name);

    const { cookies } = await this.deps.cookieStore.load(name);
    this.deps.validator.validate(cookies);

    const mtime = await this.deps.cookieStore.getJarMtime(name);
    const stale = mtime === null || Date.now() - mtime.getTime() > STALE_JAR_MS;
    if (stale && !this.spawnedRunnerProfiles.has(name)) {
      this.spawnedRunnerProfiles.add(name);
      // Fire-and-forget: the spawn guard may skip (single-flight lock held by
      // another process's runner) and never rejects.
      void Promise.resolve(this.deps.spawnRefreshRunner(name)).catch(() => {});
    }
    this.lastArm.set(name, {
      psidts: findRoutableCookieValue(cookies, PSIDTS_COOKIE_NAME),
      stale,
    });

    return arm(cookies);
  }

  rotationInFlight(profile: string): boolean {
    const record = this.lastArm.get(profile);
    return record !== undefined && record.stale;
  }

  // Awaits the detached runner's rotation by observing the only cross-process
  // truth the facade shares with it: the on-disk jar (openspec/changes/
  // await-detached-rotation-on-empty-list, design D2). Passive by contract —
  // spawns nothing, writes nothing, never rejects.
  async waitForRotation(
    profile: string,
    opts: { timeoutMs?: number } = {},
  ): Promise<ArmedSession | null> {
    const record = this.lastArm.get(profile);
    if (!record || !record.stale) {
      return null;
    }

    const timeoutMs = opts.timeoutMs ?? this.rotationWaitMs;
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      try {
        const { cookies } = await this.deps.cookieStore.load(profile);
        const observed = findRoutableCookieValue(cookies, PSIDTS_COOKIE_NAME);
        if (observed !== null && observed !== record.psidts) {
          this.lastArm.set(profile, { psidts: observed, stale: false });
          this.deps.logger.info(
            `Rotation observed for profile '${profile}' — re-arming from the refreshed jar`,
          );
          return arm(cookies);
        }
      } catch (err) {
        this.deps.logger.debug(`waitForRotation(${profile}): jar poll failed: ${err}`);
      }
      if (Date.now() >= deadline) {
        this.deps.logger.info(
          `waitForRotation(${profile}): no PSIDTS change within ${timeoutMs}ms (detached rotation still in flight)`,
        );
        return null;
      }
      await sleep(this.pollIntervalMs);
    }
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
      try {
        this.deps.validator.validate(payload);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        throw new LoginUnroutableError(
          `Captured jar failed validation: ${detail}. The pre-existing jar has been preserved byte-for-byte.`,
        );
      }
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

  async probeDetailed(profile: string): Promise<SessionProbeResult> {
    return await this.deps.classifier.classifyDetailed(profile);
  }

  async refresh(profile: string): Promise<RotationResult> {
    if (!this.deps.cooldown.canRotate(profile)) {
      this.deps.logger.debug(
        `Manual refresh suppressed for profile '${profile}': within the shared rotation floor window`,
      );
      return { rotated: false };
    }
    const { cookies } = await this.deps.cookieStore.load(profile);
    const baseline = findRoutableCookieValue(cookies, PSIDTS_COOKIE_NAME);
    const result = await this.deps.refresher.rotatePsidts(profile, baseline);
    if (result.rotated) {
      this.deps.cooldown.record(profile);
    }
    return result;
  }

  async recover(profile: string): Promise<ArmedSession> {
    // De-race (openspec/changes/fix-rotation-dead-end): a detached rotation
    // may still be in flight for this profile; awaiting it is passive and,
    // when it lands, recovery re-arms without opening a browser - and without
    // colliding with the runner's shared playwright session/persistent dir.
    if (this.rotationInFlight(profile)) {
      const landed = await this.waitForRotation(profile);
      if (landed !== null) {
        this.deps.logger.info(
          `recover(${profile}): detached rotation landed during the wait - re-arming instead of opening a recovery browser`,
        );
        return landed;
      }
    }
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
    // Pass 1 (unchanged): live profiles only, list order. This is the
    // historical path — it preserves the "live-first" routing contract that
    // the multi-profile read commands rely on.
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

    // Cold-invocation arming (fix-8 review gap-3): in a fresh `fetch`/
    // `continue` without `-p`, nothing arms the configured profiles before
    // this method runs (activeProfiles/classifier load jars without arming),
    // so every waitForRotation below would return null and pass 2 would
    // consult no one — the exact field scenario this change exists for.
    // Arm each configured profile that has no arm record yet this invocation,
    // in listProfiles() order. Arming a stale jar spawns the detached runner
    // that backs the wait (single-flight guarded); a fresh jar is an
    // in-process read. A jar that fails validation or loading skips the
    // profile without aborting the routing for the others. Never re-arm:
    // an ensureSession after a landed rotation records stale:false and would
    // wrongly exclude that profile from the wait, which must compare against
    // the ORIGINAL stale-arm baseline.
    const toArm = await this.deps.listProfiles();
    for (const name of toArm) {
      if (this.lastArm.has(name)) continue;
      try {
        await this.ensureSession(name);
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        this.deps.logger.warn(
          `findProfileForConversation: arming skipped for profile '${name}': ${detail}`,
        );
      }
    }

    // Pass 2 (fix-8): conversations owned only by a stale-but-recoverable
    // profile would otherwise be unresolvable. `waitForRotation` resolves
    // non-null only when the profile was armed stale THIS invocation AND its
    // detached rotation has landed (it returns null for fresh arms and on
    // timeout). The waits run in parallel — the ceiling is per-profile, not
    // aggregate. We do NOT spawn a second runner, do NOT write cookies, and
    // preserve listProfiles() order. Live profiles retain priority in pass
    // 1 even when pass 2 would also match.
    const configuredProfiles = await this.deps.listProfiles();
    const settled = await Promise.all(
      configuredProfiles.map(async (name) => {
        const landed = await this.waitForRotation(name).catch(() => null);
        return { name, landed };
      }),
    );
    for (const { name, landed } of settled) {
      if (landed === null) continue;
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
    let sawBothNamed = false;
    const observedScopes = new Set<string>();
    for (;;) {
      try {
        const cookies = await this.deps.driver.cookieList(session);
        const hasRoutablePair =
          cookies.some((c) => c.name === PSID_COOKIE_NAME && isRoutableTo(c, GEMINI_APP_URL)) &&
          cookies.some((c) => c.name === PSIDTS_COOKIE_NAME && isRoutableTo(c, GEMINI_APP_URL));
        if (hasRoutablePair) {
          return;
        }
        const hasPsid = cookies.some((c) => c.name === PSID_COOKIE_NAME);
        const hasPsidts = cookies.some((c) => c.name === PSIDTS_COOKIE_NAME);
        if (hasPsid && hasPsidts) {
          sawBothNamed = true;
          for (const c of cookies) {
            if (c.name === PSID_COOKIE_NAME || c.name === PSIDTS_COOKIE_NAME) {
              observedScopes.add(c.domain);
            }
          }
        }
      } catch (err) {
        if (isBrowserClosedError(err)) {
          this.deps.logger.info(`Gate poll cancelled: browser session '${session}' is no longer open`);
          throw new LoginCancelledError();
        }
        this.deps.logger.debug(`Gate poll failed: ${err}`);
      }
      if (Date.now() >= deadline) {
        if (sawBothNamed) {
          const scopes = [...observedScopes].join(", ") || "(none)";
          throw new LoginUnroutableError(
            `Authentication timed out without a gemini-routable __Secure-1PSID/TS — observed scopes: [${scopes}]. Re-run 'gemiterm auth' and complete sign-in on the gemini.google.com page.`,
          );
        }
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
  spawnRefreshRunner?: (profile: string) => void | Promise<void>;
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
    // No limit: GeminiClientService.listChats fetches all chats and slices client-side,
    // so the probe sees the full list and classifyDetailed's chatCount is real.
    probeChats: async (profile) =>
      await makeProbeClient(profile).then((c) => c.listChats()).catch(() => []),
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
    cooldown: new RotationCooldown(),
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
