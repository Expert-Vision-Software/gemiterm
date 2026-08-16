import type { Cookie } from "../../src/core/types.ts";

type Clock = () => Date;

function cookie(
  name: string,
  value: string,
  domain = ".google.com",
  expires?: number,
  secure = true,
  httpOnly = true,
  sameSite: "Strict" | "Lax" | "None" = "Lax",
  path = "/"
): Cookie {
  const now = Math.floor(Date.now() / 1000);
  const expiresTimestamp = expires ?? now + 365 * 24 * 60 * 60;
  return { name, value, domain, path, expires: expiresTimestamp, httpOnly, secure, sameSite };
}

const BASE_IDENTITY_FAMILY = [
  cookie("__Secure-1PSID", "base-psid-value"),
  cookie("SID", "base-sid-value"),
  cookie("HSID", "base-hsid-value"),
  cookie("SSID", "base-ssid-value"),
  cookie("APISID", "base-apisid-value"),
  cookie("SAPISID", "base-sapisid-value"),
];

const BASE_SIDCC_FAMILY = [
  cookie("SIDCC", "base-sidcc-value"),
  cookie("__Secure-1PSIDCC", "base-secure1psidcc-value"),
  cookie("__Secure-3PSIDCC", "base-secure3psidcc-value"),
];

const BASE_PSIDTS_FAMILY = [
  cookie("__Secure-1PSIDTS", "base-psidts-value-fresh"),
  cookie("__Secure-3PSIDTS", "base-secure3psidts-value-fresh"),
];

const BASE_IDENTITY_SERVICE = [
  cookie("ACCOUNT_CHOOSER", "base-account-chooser-value"),
  cookie("LSID", "base-lsid-value"),
];

const BASE_YOUTUBE_FAMILY = [
  cookie("VISITOR_INFO1_LIVE", "base-visitor-info-value", ".youtube.com"),
  cookie("YSC", "base-ysc-value", ".youtube.com"),
  cookie("PREF", "base-pref-value", ".youtube.com"),
];

const BASE_OTHER_FAMILY = [
  cookie("NID", "base-nid-value"),
  cookie("1P_JAR", "base-1pjar-value"),
  cookie("CONSENT", "base-consent-value"),
];

const ACCOUNTS_GOOGLE_DOMAIN = [
  cookie("GAPS", "base-gaps-value", "accounts.google.com"),
  cookie("OTZ", "base-otz-value", "accounts.google.com"),
];

export function freshFullJar(clock: Clock = () => new Date()): Cookie[] {
  const freshTsValue = `psidts-fresh-${clock().getTime()}`;
  return [
    ...BASE_IDENTITY_FAMILY,
    ...BASE_SIDCC_FAMILY,
    [
      cookie("__Secure-1PSIDTS", freshTsValue),
      cookie("__Secure-3PSIDTS", `${freshTsValue}-3`),
    ],
    ...BASE_IDENTITY_SERVICE,
    ...BASE_YOUTUBE_FAMILY,
    ...BASE_OTHER_FAMILY,
    ...ACCOUNTS_GOOGLE_DOMAIN,
  ].flat();
}

export function staleFullJar(clock: Clock = () => new Date()): Cookie[] {
  const now = clock();
  const staleDate = new Date(now.getTime() - 30 * 60 * 1000);
  const freshTsValue = `psidts-stale-${staleDate.getTime()}`;
  
  return [
    ...BASE_IDENTITY_FAMILY,
    ...BASE_SIDCC_FAMILY,
    [
      cookie("__Secure-1PSIDTS", freshTsValue),
      cookie("__Secure-3PSIDTS", `${freshTsValue}-3`),
    ],
    ...BASE_IDENTITY_SERVICE,
    ...BASE_YOUTUBE_FAMILY,
    ...BASE_OTHER_FAMILY,
    ...ACCOUNTS_GOOGLE_DOMAIN,
  ].flat();
}

export function phantomShapedJar(clock: Clock = () => new Date()): Cookie[] {
  const freshTsValue = `psidts-phantom-${clock().getTime()}`;
  return [
    ...BASE_IDENTITY_FAMILY,
    ...BASE_SIDCC_FAMILY,
    [
      cookie("__Secure-1PSIDTS", freshTsValue),
      cookie("__Secure-3PSIDTS", `${freshTsValue}-3`),
    ],
    ...BASE_IDENTITY_SERVICE,
  ].flat();
}

export function deadJar(): Cookie[] {
  return [
    cookie("__Secure-1PSID", ""),
    cookie("SID", ""),
    cookie("HSID", ""),
    cookie("SSID", ""),
  ];
}

export function trimmedFourCookieJar(): Cookie[] {
  const freshTsValue = `psidts-trimmed-${Date.now()}`;
  return [
    cookie("__Secure-1PSID", "trimmed-psid-value", ".google.com"),
    cookie("__Secure-1PSIDTS", freshTsValue, ".google.com"),
    cookie("__Secure-1PSID", "trimmed-psid-value", ".youtube.com"),
    cookie("__Secure-1PSIDTS", freshTsValue, ".youtube.com"),
  ];
}