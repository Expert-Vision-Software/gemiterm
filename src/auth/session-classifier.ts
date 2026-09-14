import type { Cookie, SessionState, SessionStateOrUnreachable } from "../core/types.ts";
import { CookieStore } from "./cookie-store.ts";
import { isRoutableTo } from "./cookie-validation.ts";
import { GEMINI_APP_URL, hasAnyExtractedInitToken } from "./auth-constants.ts";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export type { SessionState };

// Issue 25: "unreachable" is a probe-only extension of the core
// live/phantom/dead vocabulary (src/core/types.ts) — a transport failure in
// the chats probe is not a session verdict and must never be folded into
// phantom (which gates recovery offers).
export type ProbeState = SessionStateOrUnreachable;

export interface SessionProbeResult {
  state: ProbeState;
  chatCount: number;
  error?: unknown;
}

export interface SessionClassifierDeps {
  fetchInitHtml?: (cookieHeader: string) => Promise<string>;
  probeChats: (profile: string) => Promise<unknown[]>;
  cookieStore?: CookieStore;
}

async function defaultFetchInitHtml(cookieHeader: string): Promise<string> {
  const res = await fetch(GEMINI_APP_URL, {
    headers: {
      Cookie: cookieHeader,
      "User-Agent": USER_AGENT,
      "Accept-Language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });
  return await res.text();
}

export function buildCookieHeader(cookies: Cookie[], url: string): string {
  return cookies
    .filter((c) => isRoutableTo(c, url))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

export class SessionClassifier {
  private readonly cookieStore: CookieStore;
  private readonly fetchInitHtml: (cookieHeader: string) => Promise<string>;
  private readonly probeChats: (profile: string) => Promise<unknown[]>;

  constructor(deps: SessionClassifierDeps) {
    this.cookieStore = deps.cookieStore ?? new CookieStore();
    this.fetchInitHtml = deps.fetchInitHtml ?? defaultFetchInitHtml;
    this.probeChats = deps.probeChats;
  }

  async classify(profile: string): Promise<ProbeState> {
    return (await this.classifyDetailed(profile)).state;
  }

  async classifyDetailed(profile: string): Promise<SessionProbeResult> {
    const { cookies } = await this.cookieStore.load(profile);
    const cookieHeader = buildCookieHeader(cookies, GEMINI_APP_URL);

    let html: string;
    try {
      html = await this.fetchInitHtml(cookieHeader);
    } catch {
      return { state: "dead", chatCount: 0 };
    }

    if (!hasAnyExtractedInitToken(html)) {
      return { state: "dead", chatCount: 0 };
    }

    // A rejected probe is surfaced as "unreachable" with the cause attached
    // (issue 25): callers gate recovery on live/phantom/dead only, so a
    // header-overflow or 5xx can no longer trigger a bogus recovery prompt.
    try {
      const chats = await this.probeChats(profile);
      return { state: chats.length > 0 ? "live" : "phantom", chatCount: chats.length };
    } catch (error) {
      return { state: "unreachable", chatCount: 0, error };
    }
  }
}
