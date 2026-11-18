/**
 * User-Agent Pool — Random UA Generator (per-session persistent)
 *
 * Mục đích: Mỗi LOGIN SESSION có 1 UA cố định (giống real device — không đổi
 * UA mỗi request). Discord sẽ flag bot nếu 1 token đổi UA giữa các request
 * trong cùng 1 login flow (captcha_required → submit → MFA).
 *
 * Cấu trúc 2 lớp:
 *   1. Per-token persistent (lưu DB): mỗi Discord token có 1 UA cố định,
 *      dùng cho mọi API call sau khi login thành công (quests, Nitro, ...).
 *      → đã có trong discord.ts qua TokenFingerprint
 *   2. Per-session persistent (in-memory cache): mỗi login session có 1 UA
 *      cố định, dùng cho mọi request trong login flow (login → captcha → MFA).
 *      → implements trong file này qua pickSessionUA(sessionId)
 *
 * Random per-call (pickRandomUA) vẫn dùng cho QR session (mỗi QR là 1 session
 * riêng, không cần persist vì chỉ có 2 request: WS connect + HTTP exchange).
 */

import { randomUUID } from "node:crypto";
import { getBuildVersion, getElectronPairs, OS_VERSIONS as DESKTOP_OS_VERSIONS } from "./discord";

// Chrome stable releases (Nov 2026) — keep updated from
// https://chromereleases.googleblog.com
// Cập nhật: Chrome 158 Early Stable Nov 4 2026
const CHROME_VERSIONS = [
  // Chrome 158 (Nov 2026 — latest stable)
  "158.0.8127.18",
  "158.0.8127.19",
  // Chrome 157 (Oct 2026)
  "157.0.6533.120",
  "157.0.6533.88",
  // Chrome 156 (Sep 2026 — still widely used)
  "156.0.6993.120",
  "156.0.6993.92",
  // Chrome 155 (Aug 2026)
  "155.0.6700.80",
];

// Windows OS version pool — mix of Win 10 / Win 11 variants
const WINDOWS_OS_VERSIONS: Array<{ nt: string; platformVersion: string; label: string }> = [
  { nt: "10.0", platformVersion: "10.0.0", label: "Win 10" }, // Generic Win 10
  { nt: "10.0", platformVersion: "15.0.0", label: "Win 11 22H2" }, // Win 11 reports as 15+
];
// Real Win 11 reports platform-version as 13+ (kernel version), Win 10 reports as 10-13.
const SEC_CH_UA_PLATFORM_VERSIONS = [
  "10.0.0",  // Win 10
  "11.0.0",
  "12.0.0",
  "13.0.0",  // Win 11 22H2
  "14.0.0",  // Win 11 23H2
  "15.0.0",  // Win 11 24H2
];

// Architecture options (most common in real traffic)
const SEC_CH_UA_ARCH = ['"x86"', '"arm"'];
const SEC_CH_UA_BITNESS = ['"64"', '"32"'];

// Locale profiles — locale, Accept-Language and timezone must agree.
// A real browser never sends a vi-VN Accept-Language with an en-US system locale.
const LOCALE_PROFILES: Array<{ locale: string; acceptLanguage: string; timezone: string }> = [
  { locale: "en-US", acceptLanguage: "en-US,en;q=0.9", timezone: "America/New_York" },
  { locale: "en-US", acceptLanguage: "en-US,en;q=0.9,es;q=0.8", timezone: "America/Los_Angeles" },
  { locale: "en-GB", acceptLanguage: "en-GB,en;q=0.9,en-US;q=0.8", timezone: "Europe/London" },
  { locale: "vi-VN", acceptLanguage: "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7", timezone: "Asia/Saigon" },
  { locale: "ja-JP", acceptLanguage: "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7", timezone: "Asia/Tokyo" },
  { locale: "fr-FR", acceptLanguage: "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7", timezone: "Europe/Paris" },
  { locale: "de-DE", acceptLanguage: "de-DE,de;q=0.9,en-US;q=0.8,en;q=0.7", timezone: "Europe/Berlin" },
];

// sec-ch-ua-platform-version -> real Windows build reported in x-super-properties
const PLATFORM_VERSION_TO_OS: Record<string, string> = {
  "10.0.0": "10.0.19045", // Win 10 22H2
  "11.0.0": "10.0.22000", // Win 11 21H2
  "12.0.0": "10.0.22000", // Win 11 21H2 variant
  "13.0.0": "10.0.22621", // Win 11 22H2
  "14.0.0": "10.0.22631", // Win 11 23H2
  "15.0.0": "10.0.26100", // Win 11 24H2
};

/** Pick random element from array */
function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/** Pick n unique random elements from array */
function pickMany<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, arr.length));
}

export interface UABundle {
  userAgent: string;
  secChUa: string;
  secChUaMobile: string;
  secChUaPlatform: string;
  secChUaArch: string;
  secChUaBitness: string;
  secChUaPlatformVersion: string;
  secChUaFullVersionList: string;
  secChUaModel: string;
  chromeVersion: string;
  osVersion: string;
  acceptLanguage: string;
  locale: string;
  timezone: string;
  /** Windows build that matches sec-ch-ua-platform-version (used by x-super-properties). */
  superPropsOsVersion: string;
  /** Electron version bundled in the Discord desktop build. */
  electronVersion: string;
  /** Discord desktop client version (discord/1.0.xxxx in the UA). */
  clientVersion: string;
}

/**
 * Pick a random User-Agent bundle — used for every Discord API request.
 * Each call returns a fresh, consistent bundle (UA matches sec-ch-ua matches
 * sec-ch-ua-full-version-list).
 */
export function pickRandomUA(): UABundle {
  // Identity PHẢI là Discord desktop client, không phải Chrome trình duyệt:
  // gateway Identify của token này gửi UA Electron (discord/1.0.x + Electron/x).
  // Trước đây REST/login lại khai browser "Chrome" với UA Chrome thuần → cùng
  // một token nói hai câu chuyện khác nhau, Discord gắn cờ và thu hồi phiên.
  const pair = pick(getElectronPairs());
  const chrome = pair.chrome;
  const electron = pair.electron;
  const major = chrome.split(".")[0];
  const { clientVersion } = getBuildVersion();
  const osVersion = pick(DESKTOP_OS_VERSIONS); // dạng 10.0.22631
  const profile = pick(LOCALE_PROFILES);

  const userAgent =
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ` +
    `discord/${clientVersion} Chrome/${chrome} Electron/${electron} Safari/537.36`;

  // Electron không có brand "Google Chrome" — chỉ Chromium + Not?A;Brand.
  const secChUa = `"Chromium";v="${major}", "Not?A;Brand";v="24"`;
  const secChUaFullVersionList = `"Chromium";v="${chrome}", "Not?A;Brand";v="24.0.0.0"`;

  // sec-ch-ua-platform-version của Windows suy ra từ build thật đang khai.
  const platformVersion = osVersion === "10.0.19045" ? "10.0.0"
    : osVersion === "10.0.22000" ? "13.0.0"
    : osVersion === "10.0.22621" ? "14.0.0"
    : osVersion === "10.0.22631" ? "14.0.0"
    : "15.0.0";

  return {
    userAgent,
    secChUa,
    secChUaMobile: "?0",
    secChUaPlatform: '"Windows"',
    secChUaArch: '"x86"', // Windows x64 luôn khai "x86" trong sec-ch-ua-arch
    secChUaBitness: '"64"',
    secChUaPlatformVersion: `"${platformVersion}"`,
    secChUaFullVersionList,
    secChUaModel: '""',
    chromeVersion: chrome,
    osVersion,
    acceptLanguage: profile.acceptLanguage,
    locale: profile.locale,
    timezone: profile.timezone,
    superPropsOsVersion: osVersion,
    electronVersion: electron,
    clientVersion,
  };
}

/**
 * Build x-super-properties header for a given UA bundle.
 * Each call generates fresh launch_id + signature + heartbeat_session_id
 * so requests look like they come from a fresh browser session.
 */
export function buildSuperProperties(ua: UABundle): {
  superProps: string;
} {
  const { clientVersion, buildNumber, nativeBuildNumber } = getBuildVersion();
  const sp = {
    os: "Windows",
    browser: "Discord Client",
    release_channel: "stable",
    client_version: clientVersion,
    os_version: ua.superPropsOsVersion, // matches sec-ch-ua-platform-version
    os_arch: "x64",
    app_arch: "x64",
    system_locale: ua.locale, // matches Accept-Language / x-discord-locale
    has_client_mods: false,
    client_launch_id: randomUUID(),
    browser_user_agent: ua.userAgent,
    browser_version: ua.chromeVersion,
    // Real Discord web sends the same full version three times —
    // "HeadlessChrome" here was a giveaway that the client was automated.
    browser_version_list: [ua.chromeVersion, ua.chromeVersion, ua.chromeVersion],
    client_build_number: buildNumber,
    native_build_number: nativeBuildNumber,
    client_event_source: null,
    launch_signature: randomUUID(),
    client_heartbeat_session_id: randomUUID(),
    client_app_state: "focused",
  };
  return {
    superProps: Buffer.from(JSON.stringify(sp)).toString("base64"),
  };
}

/**
 * Build full HTTP headers for Discord API requests — randomized per call.
 * Returns headers ready to spread into fetch() options.
 */
export function buildDiscordHeaders(ua: UABundle, superProps: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "User-Agent": ua.userAgent,
    "x-super-properties": superProps,
    "x-debug-options": "bugReporterEnabled",
    "x-discord-locale": ua.locale,
    "x-discord-timezone": ua.timezone,
    Accept: "application/json",
    "Accept-Language": ua.acceptLanguage,
    Origin: "https://discord.com",
    Referer: "https://discord.com/login",
    // Real Chrome high-entropy hints
    "sec-ch-ua": ua.secChUa,
    "sec-ch-ua-mobile": ua.secChUaMobile,
    "sec-ch-ua-platform": ua.secChUaPlatform,
    "sec-ch-ua-arch": ua.secChUaArch,
    "sec-ch-ua-bitness": ua.secChUaBitness,
    "sec-ch-ua-full-version-list": ua.secChUaFullVersionList,
    "sec-ch-ua-model": ua.secChUaModel,
    "sec-ch-ua-platform-version": ua.secChUaPlatformVersion,
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "Priority": "u=1, i",
  };
}

/**
 * Build WebSocket connection options — randomized per call.
 * Returns options ready to pass to `new WebSocket(url, options)`.
 */
export function buildWsOptions(ua: UABundle): {
  origin: string;
  headers: Record<string, string>;
  handshakeTimeout: number;
  perMessageDeflate?: Record<string, unknown>;
} {
  return {
    origin: "https://discord.com",
    headers: {
      "User-Agent": ua.userAgent,
      "Accept-Language": ua.acceptLanguage,
      "Accept-Encoding": "gzip, deflate, br, zstd",
      "Cache-Control": "no-cache",
      "Pragma": "no-cache",
      // High-entropy Sec-CH-UA hints (Chrome sends these on every WS upgrade)
      "sec-ch-ua": ua.secChUa,
      "sec-ch-ua-mobile": ua.secChUaMobile,
      "sec-ch-ua-platform": ua.secChUaPlatform,
      "sec-ch-ua-arch": ua.secChUaArch,
      "sec-ch-ua-bitness": ua.secChUaBitness,
      "sec-ch-ua-platform-version": ua.secChUaPlatformVersion,
    },
    handshakeTimeout: 8_000,
    // perMessageDeflate matches browser's "permessage-deflate; client_max_window_bits"
    perMessageDeflate: {
      clientNoContextTakeover: false,
      serverNoContextTakeover: false,
      clientMaxWindowBits: 15,
      serverMaxWindowBits: 15,
      zlibDeflateOptions: { level: 6 },
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Per-session persistent UA cache
// ─────────────────────────────────────────────────────────────

interface CachedUA {
  ua: UABundle;
  superProps: string;
  createdAt: number;
  lastUsedAt: number;
}

const SESSION_UA_TTL_MS = 10 * 60 * 1000;  // 10 phút — đủ cho 1 login flow

declare global {
  // Per-process cache Map<sessionId, CachedUA>. Persistent across HMR.
  var sessionUACache: Map<string, CachedUA> | undefined;
}

function getSessionUACache(): Map<string, CachedUA> {
  if (!globalThis.sessionUACache) {
    globalThis.sessionUACache = new Map();
    // Auto-sweep every 60s — xóa session UA cũ hơn TTL
    setInterval(() => {
      const now = Date.now();
      const cache = globalThis.sessionUACache!;
      let deleted = 0;
      for (const [id, entry] of cache) {
        if (now - entry.lastUsedAt > SESSION_UA_TTL_MS) {
          cache.delete(id);
          deleted++;
        }
      }
      if (deleted > 0) {
        console.log(`[UA Pool] Swept ${deleted} stale session UA caches`);
      }
    }, 60_000).unref?.();
  }
  return globalThis.sessionUACache;
}

/**
 * Pick (or reuse) a UA bundle for a given login session.
 *
 * Behavior:
 *   - If sessionId is provided AND cache has it → return cached UA (persisted)
 *   - If sessionId is provided but NOT cached → pick new random UA, cache it
 *   - If sessionId is undefined/null → return a fresh random UA (stateless)
 *
 * Use case: trong 1 login flow (login → captcha_required → submit với
 * captcha_key → MFA), mỗi request gửi cùng sessionId → cùng UA → Discord
 * thấy fingerprint consistent như real device.
 *
 * Frontend should generate sessionId ONCE on mount:
 *   const loginSessionId = useMemo(() => `ls_${Date.now()}_${Math.random().toString(36).slice(2,8)}`, []);
 * and pass it to every /api/auth/password and /api/auth/mfa call.
 */
export function pickSessionUA(sessionId?: string): { ua: UABundle; superProps: string; sessionId: string } {
  // Stateless mode — no persistence
  if (!sessionId) {
    const ua = pickRandomUA();
    const { superProps } = buildSuperProperties(ua);
    return { ua, superProps, sessionId: "" };
  }
  const cache = getSessionUACache();
  const existing = cache.get(sessionId);
  if (existing) {
    existing.lastUsedAt = Date.now();
    return { ua: existing.ua, superProps: existing.superProps, sessionId };
  }
  // Create new entry
  const ua = pickRandomUA();
  const { superProps } = buildSuperProperties(ua);
  cache.set(sessionId, {
    ua,
    superProps,
    createdAt: Date.now(),
    lastUsedAt: Date.now(),
  });
  console.log(`[UA Pool] New session UA cached for ${sessionId.slice(0, 16)} — Chrome ${ua.chromeVersion.split(".")[0]}, OS ${ua.osVersion}`);
  return { ua, superProps, sessionId };
}

/**
 * Clear session UA cache (e.g. when user logs out / closes tab).
 */
export function clearSessionUA(sessionId: string): void {
  if (sessionId) {
    getSessionUACache().delete(sessionId);
  }
}

/**
 * Get stats — number of cached session UAs (for debugging).
 */
export function getSessionUAStats(): { count: number; entries: Array<{ sessionId: string; chromeVersion: string; osVersion: string; ageMs: number }> } {
  const cache = getSessionUACache();
  const now = Date.now();
  const entries = Array.from(cache.entries()).map(([id, e]) => ({
    sessionId: id,
    chromeVersion: e.ua.chromeVersion,
    osVersion: e.ua.osVersion,
    ageMs: now - e.createdAt,
  }));
  return { count: cache.size, entries };
}
