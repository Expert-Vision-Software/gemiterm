// Jar-shape registry for the auth-regression suite (fix-4, design.md D2).
// Shapes derive from docs/cookie-ablation-findings.md — NOT from production
// code — so a production regression cannot redefine the fixtures.
import type { Cookie } from "../../src/core/types.ts";

type Clock = () => Date;

function cookie(
  name: string,
  value: string,
  domain = ".google.com",
  expires?: number,
): Cookie {
  const now = Math.floor(Date.now() / 1000);
  return {
    name,
    value,
    domain,
    path: "/",
    expires: expires ?? now + 365 * 24 * 60 * 60,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  };
}

// The identity family: individually droppable (ablation P1/P2) but always captured.
const IDENTITY_FAMILY = [
  cookie("__Secure-1PSID", "identity-psid"),
  cookie("SID", "identity-sid"),
  cookie("HSID", "identity-hsid"),
  cookie("SSID", "identity-ssid"),
  cookie("APISID", "identity-apisid"),
  cookie("SAPISID", "identity-sapisid"),
];

// SIDCC family: minted/rotated server-side alongside the session.
const SIDCC_FAMILY = [
  cookie("SIDCC", "sidcc-value"),
  cookie("__Secure-1PSIDCC", "secure1psidcc-value"),
  cookie("__Secure-3PSIDCC", "secure3psidcc-value"),
];

// Identity-service + other .google.com cookies from the validated 41-cookie shape.
const GOOGLE_FAMILY = [
  cookie("ACCOUNT_CHOOSER", "account-chooser-value"),
  cookie("LSID", "lsid-value"),
  cookie("NID", "nid-value"),
  cookie("1P_JAR", "1pjar-value"),
  cookie("CONSENT", "consent-value"),
];

const YOUTUBE_FAMILY = [
  cookie("VISITOR_INFO1_LIVE", "visitor-info-value", ".youtube.com"),
  cookie("YSC", "ysc-value", ".youtube.com"),
  cookie("PREF", "pref-value", ".youtube.com"),
];

const ACCOUNTS_FAMILY = [
  cookie("GAPS", "gaps-value", "accounts.google.com"),
  cookie("OTZ", "otz-value", "accounts.google.com"),
];

function psidtsPair(psidtsValue: string): Cookie[] {
  return [
    cookie("__Secure-1PSIDTS", psidtsValue),
    cookie("__Secure-3PSIDTS", `${psidtsValue}-3`),
  ];
}

/** The validated fresh 41-cookie-class shape: every family, future expiry. */
export function freshFullJar(clock: Clock = () => new Date()): Cookie[] {
  const psidts = `psidts-fresh-${clock().getTime()}`;
  return [
    ...IDENTITY_FAMILY,
    ...SIDCC_FAMILY,
    ...psidtsPair(psidts),
    ...GOOGLE_FAMILY,
    ...YOUTUBE_FAMILY,
    ...ACCOUNTS_FAMILY,
  ];
}

/**
 * Same shape as freshFullJar, but the PSIDTS family carries a value aged
 * 30 minutes behind `clock` — server-side supersession shape (ablation P2:
 * shape identical, freshness is the failure mode). Identity cookies are
 * byte-identical to freshFullJar's.
 */
export function staleFullJar(clock: Clock = () => new Date()): Cookie[] {
  const aged = new Date(clock().getTime() - 30 * 60 * 1000);
  const psidts = `psidts-stale-${aged.getTime()}`;
  return [
    ...IDENTITY_FAMILY,
    ...SIDCC_FAMILY,
    ...psidtsPair(psidts),
    ...GOOGLE_FAMILY,
    ...YOUTUBE_FAMILY,
    ...ACCOUNTS_FAMILY,
  ];
}

/** Tokens-shaped jar for the phantom scenario: fresh PSIDTS, identity family present. */
export function phantomShapedJar(clock: Clock = () => new Date()): Cookie[] {
  const psidts = `psidts-phantom-${clock().getTime()}`;
  return [
    ...IDENTITY_FAMILY,
    ...SIDCC_FAMILY,
    ...psidtsPair(psidts),
    ...GOOGLE_FAMILY,
  ];
}

/** Dead shape: no tier-1 or companion cookie names at all — anonymous, signed-out. */
export function deadJar(): Cookie[] {
  return [cookie("CONSENT", "YES+cb"), cookie("1P_JAR", "dead-1pjar"), cookie("OTZ", "dead-otz", "accounts.google.com")];
}

/**
 * The historical "bug jar": exactly the PSID/PSIDTS pair on .google.com and
 * .youtube.com. Works-when-fresh / fails-when-superseded — kept so that
 * behavior stays pinned (ablation P1: shape was never the problem).
 */
export function trimmedFourCookieJar(): Cookie[] {
  const psidts = `psidts-trimmed-${Date.now()}`;
  return [
    cookie("__Secure-1PSID", "trimmed-psid", ".google.com"),
    cookie("__Secure-1PSIDTS", psidts, ".google.com"),
    cookie("__Secure-1PSID", "trimmed-psid", ".youtube.com"),
    cookie("__Secure-1PSIDTS", psidts, ".youtube.com"),
  ];
}