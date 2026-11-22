// Discord API helper functions for Next.js API routes
// Combined best logic from aiko-chan-ai/Discord-Quest-Auto-Completion-Selfbot
// and Nguoibianhz/Discord-Auto-Quests
//
// FINGERPRINT PER-TOKEN: Each token gets unique super-properties
// stored in database - persists across server restarts
// Deleted when token expires/logout (cascade)
//
// AUTO-UPDATE: Build number fetched from Discord on startup + every 6h
// RANDOM UA: Each token gets a unique Chrome version + OS variation

import { randomUUID } from "crypto";
import { isWebIdentity, webHeaders, userIdFromToken, tokenIdFromToken } from "./webIdentity";
import { db } from "./db";

const DISCORD_API = "https://discord.com/api/v10";

// ──────────────────────────────────────────────────
// Dynamic build version (auto-updated from Discord)
// ──────────────────────────────────────────────────

// Updated to match aiko-chan-ai latest constants
let CLIENT_VERSION = "1.0.9236";
let BUILD_NUMBER = 539951;
let NATIVE_BUILD_NUMBER = 81687;
let buildVersionLoaded = false;

// Allow other modules to read the current build constants (kept in sync by
// initBuildVersion()). Used by authPassword.ts.
export function getBuildVersion(): { clientVersion: string; buildNumber: number; nativeBuildNumber: number } {
  return { clientVersion: CLIENT_VERSION, buildNumber: BUILD_NUMBER, nativeBuildNumber: NATIVE_BUILD_NUMBER };
}

// Electron/Chromium pairs that actually ship together.
//
// A real Discord desktop client reports the Chromium build bundled in its
// Electron version (Electron 37 -> Chromium 138, 36 -> 136, 35 -> 134).
// The old code paired the newest Chrome (158) with Electron/37.6.0, a
// combination that never exists in the wild — an easy signal to flag and
// revoke a token. Keep the two halves of the UA in lockstep.
const ELECTRON_CHROMIUM_PAIRS: Array<{ electron: string; chrome: string }> = [
  { electron: "37.6.0", chrome: "138.0.7204.251" },
  { electron: "36.9.5", chrome: "136.0.7103.114" },
  { electron: "35.7.5", chrome: "134.0.6998.205" },
];

/** Cặp Electron/Chromium thật — uaPool dùng lại để REST và gateway cùng identity. */
export function getElectronPairs(): Array<{ electron: string; chrome: string }> {
  return ELECTRON_CHROMIUM_PAIRS;
}

/**
 * Hồ sơ locale THẬT: locale + Accept-Language + timezone luôn đi cùng nhau.
 * Khai báo tại chỗ thay vì import từ uaPool vì uaPool đã import discord (vòng).
 */
const FINGERPRINT_LOCALE_PROFILES: Array<{ locale: string; timezone: string }> = [
  { locale: "vi-VN", timezone: "Asia/Saigon" },
  { locale: "en-US", timezone: "America/New_York" },
  { locale: "en-GB", timezone: "Europe/London" },
  { locale: "ja-JP", timezone: "Asia/Tokyo" },
  { locale: "fr-FR", timezone: "Europe/Paris" },
  { locale: "de-DE", timezone: "Europe/Berlin" },
];

// OS version pool — mix of Windows 10/11 variants (most common in real traffic)
export const OS_VERSIONS = [
  "10.0.19045", // Windows 10 22H2 (most common Win10)
  "10.0.22621", // Windows 11 22H2
  "10.0.22631", // Windows 11 23H2
  "10.0.26100", // Windows 11 24H2 (newest)
];

// Discord's client_country / Accept-Language values to match real users

// ──────────────────────────────────────────────────
// Auto-update build version from Discord
// Fetches discord.com/app, parses JS assets for buildNumber
// ──────────────────────────────────────────────────

/**
 * Lấy version desktop thật từ manifest cập nhật của Discord.
 * Trước đây client_version bị hardcode (1.0.9236) trong khi bản thật đã lên
 * 1.0.92xx — Discord đối chiếu version cũ với build number mới là thấy lệch.
 */
async function updateClientVersionFromManifest(): Promise<void> {
  try {
    const res = await fetch(
      "https://discord.com/api/updates/distributions/app/manifests/latest?channel=stable&platform=win&arch=x64&no-limit=1",
      { headers: { "User-Agent": `Discord/${CLIENT_VERSION}` } },
    );
    if (!res.ok) return;
    const data = await res.json() as { modules?: Record<string, { full?: { host_version?: number[] } }> };
    for (const mod of Object.values(data.modules || {})) {
      const hv = mod?.full?.host_version;
      if (Array.isArray(hv) && hv.length === 3) {
        const version = hv.join(".");
        if (version !== CLIENT_VERSION) {
          console.log(`[Discord] Client version updated: ${CLIENT_VERSION} → ${version}`);
          CLIENT_VERSION = version;
        }
        return;
      }
    }
  } catch (err) {
    console.warn("[Discord] Manifest version fetch failed:", err instanceof Error ? err.message : String(err));
  }
}

async function updateLatestBuildVersion(): Promise<void> {
  try {
    await updateClientVersionFromManifest();
    await refreshStoredFingerprintVersions();
    console.log("[Discord] Fetching latest build number...");
    const response = await fetch("https://discord.com/app", {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    if (!response.ok) {
      console.warn(`[Discord] Failed to fetch Discord page (${response.status})`);
      return;
    }
    const html = await response.text();

    // Find JS asset files
    const scripts = Array.from(
      html.match(/\/assets\/web.([a-f0-9]+)\.js/g) || [],
    );
    if (!scripts || scripts.length === 0) {
      console.warn("[Discord] No JS assets found in HTML");
      return;
    }

    for (const scriptPath of scripts) {
      try {
        const assetUrl = `https://discord.com${scriptPath}`;
        const assetResponse = await fetch(assetUrl, {
          headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
        });
        if (!assetResponse.ok) continue;
        const jsContent = await assetResponse.text();

        // Match buildNumber pattern
        const match = jsContent.match(/buildNumber["\s:]+["\s]*(\d{5,7})/);
        if (match) {
          const newBuildNumber = parseInt(match[1], 10);
          if (newBuildNumber !== BUILD_NUMBER) {
            console.log(`[Discord] Build number updated: ${BUILD_NUMBER} → ${newBuildNumber}`);
            BUILD_NUMBER = newBuildNumber;
            // Try to extract client version too
            const versionMatch = jsContent.match(/client_version["\s:]+["\s]*([\d.]+)/);
            if (versionMatch) {
              CLIENT_VERSION = versionMatch[1];
              console.log(`[Discord] Client version updated: ${CLIENT_VERSION}`);
            }
          } else {
            console.log(`[Discord] Build number up-to-date: ${BUILD_NUMBER}`);
          }
          return;
        }
      } catch {
        continue;
      }
    }
    console.warn("[Discord] Build number not found in any JS assets");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("[Discord] Error fetching build number:", errorMessage);
  }
}

/**
 * Initialize build version on startup + schedule refresh every 6 hours
 */
/**
 * Token đã lưu vẫn mang UA với version desktop cũ (discord/1.0.9236) trong khi
 * build number đã lên 675174 — lệch ngay trong cùng một header. Thay đoạn
 * discord/<version> trong UA đã lưu bằng version thật hiện tại.
 */
async function refreshStoredFingerprintVersions(): Promise<void> {
  try {
    const rows = await db.tokenFingerprint.findMany({ select: { tokenId: true, userAgent: true } });
    let updated = 0;
    for (const row of rows) {
      if (!row.userAgent || !row.userAgent.includes("discord/")) continue;
      const next = row.userAgent.replace(/discord\/[\d.]+/, `discord/${CLIENT_VERSION}`);
      if (next === row.userAgent) continue;
      await db.tokenFingerprint.update({ where: { tokenId: row.tokenId }, data: { userAgent: next } });
      updated++;
    }
    if (updated > 0) console.log(`[Discord] Refreshed client version in ${updated} stored fingerprint(s) → ${CLIENT_VERSION}`);
  } catch (err) {
    console.warn("[Discord] Fingerprint version refresh skipped:", err instanceof Error ? err.message : String(err));
  }
}

export async function initBuildVersion(): Promise<void> {
  if (buildVersionLoaded) return;
  buildVersionLoaded = true;
  await updateLatestBuildVersion();
  // Refresh every 6 hours
  setInterval(() => {
    updateLatestBuildVersion().catch((err) => {
      console.error("[Discord] Build version refresh failed:", err);
    });
  }, 6 * 60 * 60 * 1000);
}

// ──────────────────────────────────────────────────
// Per-token fingerprint (stored in database)
// Each token gets its own unique super-properties
// that persist across server restarts
// Deleted when token is deleted (cascade)
// ──────────────────────────────────────────────────

interface TokenFingerprint {
  launchId: string;
  launchSignature: string;
  heartbeatSessionId: string;
  sessionId: string;
  locale: string;
  timezone: string;
  chromeVersion: string;
  userAgent: string;
  osVersion: string;
}

/** Real Discord desktop clients report the bundled Electron version in
 *  `browser_version`, NOT the Chromium version. Reporting Chrome 138.x there
 *  while the UA says Electron/37.6.0 is a contradiction no real client has. */
function electronVersionFromUA(ua: string): string {
  return ua.match(/Electron\/([\d.]+)/)?.[1] || "37.6.0";
}

function buildUserAgent(chromeVersion: string, osVersion: string, electronVersion: string): string {
  // Discord Client UA - REQUIRED for heartbeat/video-progress API
  // Regular Chrome UA gets 401 Unauthorized from Discord
  return `Mozilla/5.0 (Windows NT ${osVersion.split(".").slice(0, 2).join(".")}; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/${CLIENT_VERSION} Chrome/${chromeVersion} Electron/${electronVersion} Safari/537.36`;
}

/**
 * Bộ sinh số giả ngẫu nhiên DETERMINISTIC theo tokenId.
 * Cùng một token → cùng một identity ở mọi lần tạo lại (kể cả sau deploy,
 * khi DB SQLite trong /tmp bị xoá). Đây là điểm quan trọng: client thật không
 * đổi UA/locale mỗi lần khởi động, còn trước đây mỗi lần mất DB là token lại
 * khoác một bộ identity mới, Discord thấy lạ.
 */
function seededRandom(seedText: string): () => number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seedText.length; i++) {
    h ^= seedText.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return () => {
    h += 0x6d2b79f5;
    let r = Math.imul(h ^ (h >>> 15), 1 | h);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function generateFingerprintData(tokenId: string): Omit<TokenFingerprint, "userAgent"> & { userAgent: string } {
  const rand = seededRandom(tokenId);
  const pairs = ELECTRON_CHROMIUM_PAIRS;
  const pair = pairs[Math.floor(rand() * pairs.length)];
  const osVersion = OS_VERSIONS[Math.floor(rand() * OS_VERSIONS.length)];
  const userAgent = buildUserAgent(pair.chrome, osVersion, pair.electron);

  // locale + timezone PHẢI cùng một hồ sơ. Trước đây hai giá trị được bốc độc
  // lập nên sinh ra tổ hợp không tồn tại trên đời (fr-FR + Asia/Seoul), và
  // Accept-Language / x-discord-locale lại khai bộ thứ ba.
  // Proxy hiện là VN nên ưu tiên hồ sơ vi-VN (IP VN + locale VN + Asia/Saigon mới
  // là tổ hợp thật); phần còn lại vẫn deterministic theo token.
  const profiles = FINGERPRINT_LOCALE_PROFILES;
  const profile = rand() < 0.6 ? profiles[0] : profiles[Math.floor(rand() * profiles.length)];

  return {
    launchId: randomUUID(),
    launchSignature: randomUUID(),
    heartbeatSessionId: randomUUID(),
    sessionId: randomUUID(),
    locale: profile.locale,
    timezone: profile.timezone,
    chromeVersion: pair.chrome,
    userAgent,
    osVersion,
  };
}

/**
 * Ghi đè fingerprint của token bằng ĐÚNG identity vừa login.
 *
 * Trước đây login dùng một UA ngẫu nhiên, xong worker lại tạo fingerprint khác
 * trong DB → REST/gateway nói bằng UA thứ hai ngay sau khi login. Giờ identity
 * của phiên login trở thành identity của token.
 */
export async function adoptFingerprint(
  tokenId: string,
  fp: { userAgent: string; chromeVersion: string; osVersion: string; locale: string; timezone: string },
): Promise<void> {
  try {
    const existing = await db.tokenFingerprint.findUnique({ where: { tokenId } });
    if (existing) {
      if (existing.userAgent === fp.userAgent) return;
      await db.tokenFingerprint.update({
        where: { tokenId },
        data: {
          userAgent: fp.userAgent,
          chromeVersion: fp.chromeVersion,
          osVersion: fp.osVersion,
          locale: fp.locale,
          timezone: fp.timezone,
        },
      });
    } else {
      await db.tokenFingerprint.create({
        data: {
          tokenId,
          launchId: randomUUID(),
          launchSignature: randomUUID(),
          heartbeatSessionId: randomUUID(),
          sessionId: randomUUID(),
          locale: fp.locale,
          timezone: fp.timezone,
          chromeVersion: fp.chromeVersion,
          userAgent: fp.userAgent,
          osVersion: fp.osVersion,
        },
      });
    }
    console.log(`[Discord] Adopted login identity for ${tokenId.slice(0, 12)}... Electron/${fp.userAgent.match(/Electron\/([\d.]+)/)?.[1] || "?"}`);
  } catch (err) {
    console.warn("[Discord] adoptFingerprint failed:", err instanceof Error ? err.message : String(err));
  }
}

/**
 * Get or create fingerprint for a token from database
 * If fingerprint exists in DB → load it (persists across restarts)
 * If not → create new one with random UA, locale, timezone
 */
export async function getOrCreateFingerprint(tokenId: string): Promise<TokenFingerprint> {
  // Try loading from DB
  const existing = await db.tokenFingerprint.findUnique({ where: { tokenId } });
  if (existing) {
    return {
      launchId: existing.launchId,
      launchSignature: existing.launchSignature,
      heartbeatSessionId: existing.heartbeatSessionId,
      sessionId: existing.sessionId,
      locale: existing.locale,
      timezone: existing.timezone,
      chromeVersion: existing.chromeVersion,
      userAgent: existing.userAgent,
      osVersion: existing.osVersion,
    };
  }

  // Create new fingerprint
  const data = generateFingerprintData(tokenId);

  try {
    await db.tokenFingerprint.create({
      data: {
        tokenId,
        launchId: data.launchId,
        launchSignature: data.launchSignature,
        heartbeatSessionId: data.heartbeatSessionId,
        sessionId: data.sessionId,
        locale: data.locale,
        timezone: data.timezone,
        chromeVersion: data.chromeVersion,
        userAgent: data.userAgent,
        osVersion: data.osVersion,
      },
    });
    console.log(`[Discord] Created new fingerprint for token ${tokenId.slice(0, 12)}... Electron/${data.userAgent.match(/Electron\/([\d.]+)/)?.[1] || "?"} Chrome/${data.chromeVersion} OS/${data.osVersion} locale/${data.locale} tz/${data.timezone}`);
  } catch (error) {
    // If create fails (e.g. tokenId doesn't exist in DiscordToken), still use in-memory
    console.warn(`[Discord] Could not save fingerprint to DB for ${tokenId}:`, error instanceof Error ? error.message : String(error));
  }

  return data;
}

/**
 * Remove fingerprint for a token (on logout/token expiry)
 * Deletes from DB → cascade means all related data cleaned up
 */
export async function clearFingerprint(tokenId: string): Promise<void> {
  try {
    await db.tokenFingerprint.deleteMany({ where: { tokenId } });
  } catch {
    // Ignore if not found
  }
}

/**
 * Build super-properties for a specific token
 * Each token has unique UUIDs, locale, timezone, UA
 */
export async function buildSuperProperties(tokenId: string): Promise<{ superProps: string; fp: TokenFingerprint }> {
  const fp = await getOrCreateFingerprint(tokenId);
  const props = {
    os: "Windows",
    browser: "Discord Client",
    release_channel: "stable",
    client_version: CLIENT_VERSION,
    os_version: fp.osVersion,
    os_arch: "x64",
    app_arch: "x64",
    system_locale: fp.locale,
    has_client_mods: false,
    client_launch_id: fp.launchId,
    browser_user_agent: fp.userAgent,
    browser_version: electronVersionFromUA(fp.userAgent),
    os_sdk_version: fp.osVersion.split(".").pop() || "19045",
    client_build_number: BUILD_NUMBER,
    native_build_number: NATIVE_BUILD_NUMBER,
    client_event_source: null,
    launch_signature: fp.launchSignature,
    client_heartbeat_session_id: fp.heartbeatSessionId,
    client_app_state: "focused",
  };
  return {
    superProps: Buffer.from(JSON.stringify(props)).toString("base64"),
    fp,
  };
}

// ──────────────────────────────────────────────────
// Discord fetch with per-token fingerprint (async)
// When gateway is connected, uses gateway's super-properties (CRITICAL for heartbeat/video-progress)
// When gateway is not connected, uses DB fingerprint or one-time fingerprint

import { getSuperProperties, getUserAgent, isGatewayReady, getGatewayLocale, getGatewayTimezone } from "./gateway";

export async function discordFetch(
  token: string,
  path: string,
  options: RequestInit = {},
  tokenId?: string
): Promise<Response> {
  const url = path.startsWith("http") ? path : `${DISCORD_API}${path}`;

  let superProps: string;
  let userAgent: string;
  let locale: string;
  let timezone: string;

  if (tokenId && isGatewayReady(tokenId)) {
    // Gateway is connected → use gateway's super-properties (MUST match Identify payload).
    // Locale/timezone cũng phải lấy từ chính fingerprint đó: trước đây header
    // x-discord-locale luôn là en-US/Asia-Saigon trong khi super-properties khai
    // locale của token (vd es-ES) → một request tự mâu thuẫn.
    superProps = getSuperProperties(tokenId);
    userAgent = getUserAgent(tokenId);
    locale = getGatewayLocale(tokenId);
    timezone = getGatewayTimezone(tokenId);
  } else if (tokenId) {
    // No gateway → use DB fingerprint
    const built = await buildSuperProperties(tokenId);
    superProps = built.superProps;
    userAgent = built.fp.userAgent;
    locale = built.fp.locale;
    timezone = built.fp.timezone;
  } else {
    // No tokenId → generate one-time fingerprint (stateless)
    const oneTimePair = ELECTRON_CHROMIUM_PAIRS[Math.floor(Math.random() * ELECTRON_CHROMIUM_PAIRS.length)];
    const oneTimeChrome = oneTimePair.chrome;
    const oneTimeOs = OS_VERSIONS[Math.floor(Math.random() * OS_VERSIONS.length)];
    const oneTimeUA = buildUserAgent(oneTimeChrome, oneTimeOs, oneTimePair.electron);
    superProps = Buffer.from(JSON.stringify({
      os: "Windows",
      browser: "Discord Client",
      release_channel: "stable",
      client_version: CLIENT_VERSION,
      os_version: oneTimeOs,
      os_arch: "x64",
      app_arch: "x64",
      system_locale: "en-US",
      has_client_mods: false,
      client_launch_id: randomUUID(),
      browser_user_agent: oneTimeUA,
      browser_version: electronVersionFromUA(oneTimeUA),
      os_sdk_version: oneTimeOs.split(".").pop() || "19045",
      client_build_number: BUILD_NUMBER,
      native_build_number: NATIVE_BUILD_NUMBER,
      client_event_source: null,
      launch_signature: randomUUID(),
      client_heartbeat_session_id: randomUUID(),
      client_app_state: "focused",
    })).toString("base64");
    userAgent = oneTimeUA;
    locale = "en-US";
    timezone = "Asia/Saigon";
  }

  // Check for Android request header (aiko-style handling)
  const customHeaders = (options.headers as Record<string, string>) || {};
  const isAndroidRequest = customHeaders["AndroidRequest"] === "true";
  // Remove AndroidRequest from headers (aiko does this — it's not a real HTTP header)
  delete customHeaders["AndroidRequest"];

  // Android uses different User-Agent and super-properties
  const androidUserAgent = "Discord-Android/316011;RNA";
  const androidSuperProps = Buffer.from(JSON.stringify({
    os: "Android",
    browser: "Discord Android",
    device: "b0q",
    system_locale: locale,
    has_client_mods: false,
    client_version: "316.11 - rn",
    release_channel: "googleRelease",
    device_vendor_id: randomUUID(),
    design_id: 2,
    browser_user_agent: "",
    browser_version: "",
    os_version: "28",
    client_build_number: 5169,
    client_event_source: null,
    client_launch_id: randomUUID(),
    launch_signature: "1771754995045142953",
    client_app_state: "active",
    client_heartbeat_session_id: randomUUID(),
  })).toString("base64");

  const finalUserAgent = isAndroidRequest ? androidUserAgent : userAgent;
  const finalSuperProps = isAndroidRequest ? androidSuperProps : superProps;
  const finalBrowserVer = isAndroidRequest ? "316" : (finalUserAgent.match(/Chrome\/([\d.]+)/)?.[1] || "138.0.7204.251");

  const headers: Record<string, string> = {
    Authorization: token.replace(/^Bot\s+/i, ""),
    "Content-Type": "application/json",
    "User-Agent": finalUserAgent,
    "x-super-properties": finalSuperProps,
    "x-debug-options": "bugReporterEnabled",
    "x-discord-locale": locale,
    "x-discord-timezone": timezone,
    ...(isAndroidRequest ? {} : {
      origin: "https://discord.com",
      referer: "https://discord.com/channels/@me",
      pragma: "no-cache",
      priority: "u=1, i",
      "sec-ch-ua": `"Not)A;Brand";v="8", "Chromium";v="${finalBrowserVer.split(".")[0]}"`,
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"Windows"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
    }),
    ...customHeaders,
  };

  // Identity WEB: ghi đè lên bộ Electron giả bằng đúng header của phiên Chrome
  // thật (UA Chrome 157, x-fingerprint, x-installation-id, super-properties).
  if (isWebIdentity()) {
    Object.assign(headers, webHeaders(userIdFromToken(token), tokenIdFromToken(token)));
    headers.Authorization = token.replace(/^Bot\s+/i, "");
    headers["Content-Type"] = "application/json";
  }

  // Đi qua proxy ĐÃ GHIM của token để cả phiên chỉ dùng một IP. Trước đây hàm này
  // gọi fetch() trần (IP server) trong khi login/enroll lại qua proxy ngẫu nhiên →
  // Discord thấy token xuất hiện từ nhiều IP và thu hồi phiên.
  const { fetchWithTokenProxy } = await import("./proxyHelper");
  const res = await fetchWithTokenProxy(tokenId, url, { ...options, headers });
  return res;
}

/**
 * Check if a Discord API response indicates the token has expired
 * Discord returns 401 with specific error codes for expired/invalid tokens
 */
export function isTokenExpiredResponse(res: Response): boolean {
  return res.status === 401;
}

// ──────────────────────────────────────────────────
// Public API functions
// ──────────────────────────────────────────────────

export async function verifyDiscordToken(token: string) {
  const res = await discordFetch(token, "/users/@me");
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Invalid token: ${res.status} ${text}`);
  }
  return res.json();
}

/**
 * Fetch quests from Discord API - returns full response including excluded_quests
 * Throws if quest enrollment is blocked
 */
export async function fetchDiscordQuests(token: string, tokenId?: string) {
  const res = await discordFetch(token, "/quests/@me", {}, tokenId);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to fetch quests: ${res.status} ${text}`);
  }
  const data = await res.json();

  // Check if enrollment is blocked (aiko logic)
  if (data.quest_enrollment_blocked_until != null) {
    throw new Error(
      `Quest enrollment bị chặn đến ${data.quest_enrollment_blocked_until}`
    );
  }

  return {
    quests: data.quests || [],
    excludedQuests: data.excluded_quests || [],
  };
}

export async function getDiscordProfile(token: string, tokenId?: string) {
  const userRes = await discordFetch(token, "/users/@me", {}, tokenId);
  if (!userRes.ok) throw new Error("Failed to fetch profile");
  const user = await userRes.json();

  // Fetch profile for banner data + settings for nsfw_allowed (age check)
  const [profileRes, settingsRes] = await Promise.all([
    discordFetch(token, `/users/${user.id}/profile`, {}, tokenId),
    discordFetch(token, "/users/@me/settings", {}, tokenId),
  ]);
  const profileMeta = profileRes.ok ? await profileRes.json().catch(() => ({})) : {};
  const settingsData = settingsRes.ok ? await settingsRes.json().catch(() => ({})) : {};

  return {
    user,
    profile: profileMeta || {},
    guilds: [],
    connections: [],
    billing: [],
    subscriptions: [],
    settings: settingsData || {},
  };
}

/**
 * Enroll in a quest (aiko-style full body)
 * location: 11 = desktop, 12 = mobile
 * Passes traffic_metadata from quest data (aiko requirement)
 */
export async function enrollQuest(
  token: string,
  questId: string,
  isAndroid: boolean = false,
  tokenId?: string,
  questData?: Record<string, unknown>
): Promise<Response> {
  const location = isAndroid ? 12 : 11;
  // aiko: pass traffic_metadata_raw and traffic_metadata_sealed from quest data
  const trafficMetadataRaw = questData?.traffic_metadata_raw as string || null;
  const trafficMetadataSealed = questData?.traffic_metadata_sealed as string || null;
  return discordFetch(token, `/quests/${questId}/enroll`, {
    method: "POST",
    body: JSON.stringify({
      location,
      is_targeted: false,
      metadata_sealed: null,
      traffic_metadata_raw: trafficMetadataRaw,
      traffic_metadata_sealed: trafficMetadataSealed,
    }),
    headers: {
      "AndroidRequest": isAndroid ? "true" : "false",
    },
  }, tokenId);
}

/**
 * Claim quest reward (aiko-style full body)
 * Uses rewards_config.platforms[0] and traffic_metadata from quest data
 */
export async function claimQuestReward(
  token: string,
  questId: string,
  questData?: Record<string, unknown>,
  tokenId?: string
): Promise<Response> {
  // Extract platform from rewards_config (aiko logic)
  let platform = 1;
  let trafficMetadataRaw: string | null = null;
  let trafficMetadataSealed: string | null = null;

  if (questData) {
    const config = questData.config as Record<string, unknown> | undefined;
    const rewardsConfig = config?.rewards_config as Record<string, unknown> | undefined;
    const platforms = rewardsConfig?.platforms as number[] | undefined;
    if (platforms && platforms.length > 0) {
      platform = platforms[0];
    }
    trafficMetadataRaw = (questData.traffic_metadata_raw as string) || null;
    trafficMetadataSealed = (questData.traffic_metadata_sealed as string) || null;
  }

  const body: Record<string, unknown> = {
    platform,
    location: 11,
    is_targeted: false,
    metadata_raw: null,
    metadata_sealed: null,
  };
  if (trafficMetadataRaw) body.traffic_metadata_raw = trafficMetadataRaw;
  if (trafficMetadataSealed) body.traffic_metadata_sealed = trafficMetadataSealed;

  return discordFetch(token, `/quests/${questId}/claim-reward`, {
    method: "POST",
    body: JSON.stringify(body),
  }, tokenId);
}

/**
 * Get virtual currency balance
 */
export async function getVirtualCurrencyBalance(token: string, tokenId?: string): Promise<number> {
  try {
    const res = await discordFetch(token, "/users/@me/virtual-currency/balance", {}, tokenId);
    if (!res.ok) return 0;
    const data = await res.json();
    return data.balance ?? 0;
  } catch {
    return 0;
  }
}

// ──────────────────────────────────────────────────
// Quest data parsing helpers (unchanged)
// ──────────────────────────────────────────────────

export function getQuestType(quest: Record<string, unknown>): string {
  const tasks = (quest.config as Record<string, unknown>)?.task_config_v2 as Record<string, unknown> | undefined;
  const taskMap = tasks?.tasks as Record<string, unknown> | undefined;
  if (!taskMap) return "UNKNOWN";
  const types = [
    "WATCH_VIDEO",
    "WATCH_VIDEO_ON_MOBILE",
    "PLAY_ON_DESKTOP",
    "PLAY_ON_XBOX",
    "PLAY_ON_PLAYSTATION",
    "STREAM_ON_DESKTOP",
    "PLAY_ACTIVITY",
    "ACHIEVEMENT_IN_ACTIVITY",
  ];
  for (const t of types) {
    if (taskMap[t] != null) return t;
  }
  return "UNKNOWN";
}

export function getVideoSecondsNeeded(quest: Record<string, unknown>): number {
  const tasks = ((quest.config as Record<string, unknown>)?.task_config_v2 as Record<string, unknown>)?.tasks as Record<string, unknown> | undefined;
  if (!tasks) return 900;
  const watchVideo = tasks.WATCH_VIDEO || tasks.WATCH_VIDEO_ON_MOBILE;
  // API returns "target" in seconds (v2), fallback to seconds_needed (v1)
  const target = (watchVideo as Record<string, unknown>)?.target as number | undefined;
  if (target) return target;
  return (watchVideo as Record<string, unknown>)?.seconds_needed as number || 900;
}

export function getPlayDurationNeeded(quest: Record<string, unknown>): number {
  const tasks = ((quest.config as Record<string, unknown>)?.task_config_v2 as Record<string, unknown>)?.tasks as Record<string, unknown> | undefined;
  if (!tasks) return 900;
  const playTask =
    tasks.PLAY_ON_DESKTOP ||
    tasks.PLAY_ON_XBOX ||
    tasks.PLAY_ON_PLAYSTATION ||
    tasks.PLAY_ACTIVITY ||
    tasks.ACHIEVEMENT_IN_ACTIVITY;
  // API returns "target" in seconds (v2), fallback to minutes_needed (v1)
  const target = (playTask as Record<string, unknown>)?.target as number | undefined;
  if (target) return target;
  const minutesNeeded = (playTask as Record<string, unknown>)?.minutes_needed as number | undefined;
  return minutesNeeded ? minutesNeeded * 60 : 900;
}

export function getApplicationId(quest: Record<string, unknown>): string | null {
  const tasks = ((quest.config as Record<string, unknown>)?.task_config_v2 as Record<string, unknown>)?.tasks as Record<string, unknown> | undefined;
  if (!tasks) return ((quest.config as Record<string, unknown>)?.content_id as string) || null;
  const playTask =
    tasks.PLAY_ON_DESKTOP ||
    tasks.PLAY_ON_XBOX ||
    tasks.PLAY_ON_PLAYSTATION;
  // v2 uses "applications" array with {id: "..."}, v1 uses "application_id" string
  const apps = (playTask as Record<string, unknown>)?.applications as Array<Record<string, unknown>> | undefined;
  if (apps && apps.length > 0 && apps[0].id) return apps[0].id as string;
  return ((playTask as Record<string, unknown>)?.application_id as string) || ((quest.config as Record<string, unknown>)?.content_id as string) || null;
}

export function isQuestCompleted(quest: Record<string, unknown>): boolean {
  const userStatus = quest.user_status as Record<string, unknown> | undefined;
  return userStatus?.completed_at != null;
}

export function isQuestExpired(quest: Record<string, unknown>): boolean {
  const config = quest.config as Record<string, unknown> | undefined;
  const expiresAt = config?.expires_at as string | undefined;
  if (!expiresAt) return false;
  return new Date(expiresAt).getTime() < Date.now();
}

export function isQuestClaimed(quest: Record<string, unknown>): boolean {
  const userStatus = quest.user_status as Record<string, unknown> | undefined;
  return userStatus?.claimed_at != null;
}

export function getQuestMessages(quest: Record<string, unknown>): {
  questName: string;
  gameTitle: string;
  gamePublisher: string;
} {
  const config = quest.config as Record<string, unknown> | undefined;
  const messages = config?.messages as Record<string, string> | undefined;
  return {
    questName: messages?.quest_name || (config?.quest_id as string) || `Quest ${(quest.id as string)?.slice(0, 8)}`,
    gameTitle: messages?.game_title || "",
    gamePublisher: messages?.game_publisher || "",
  };
}

export function getQuestColors(quest: Record<string, unknown>): {
  primary: string;
  secondary: string;
} {
  const config = quest.config as Record<string, unknown> | undefined;
  const colors = config?.colors as Record<string, string> | undefined;
  return {
    primary: colors?.primary || "#5865F2",
    secondary: colors?.secondary || "#1e2029",
  };
}

export function getQuestAssets(quest: Record<string, unknown>): {
  hero: string;
  gameTile: string;
  logotype: string;
  logotypeLight: string;
  logotypeDark: string;
} {
  const config = quest.config as Record<string, unknown> | undefined;
  const assets = config?.assets as Record<string, string> | undefined;
  // Discord API returns `logotype` (per aiko-chan-ai interface).
  // Some older quests may return `logotype_light`/`logotype_dark` variants —
  // fallback to `logotype` if the variant is missing so the logo still shows.
  const logotype = assets?.logotype || "";
  return {
    hero: assets?.hero || "",
    gameTile: assets?.game_tile || "",
    logotype,
    logotypeLight: assets?.logotype_light || logotype,
    logotypeDark: assets?.logotype_dark || logotype,
  };
}

export function buildBannerUrl(questId: string, heroAsset: string): string | undefined {
  if (!heroAsset) return undefined;
  if (heroAsset.includes('/')) {
    return `https://cdn.discordapp.com/${heroAsset}`;
  }
  return `https://cdn.discordapp.com/quests/${questId}/assets/${heroAsset}.webp`;
}

export function getOrbsReward(quest: Record<string, unknown>): number | null {
  const config = quest.config as Record<string, unknown> | undefined;
  const rewardsConfig = config?.rewards_config as Record<string, unknown> | undefined;
  const rewards = rewardsConfig?.rewards as Array<Record<string, unknown>> | undefined;
  if (!rewards || rewards.length === 0) return null;
  return (rewards[0].orb_quantity as number) || null;
}

export function calculateQuestProgress(quest: Record<string, unknown>): number {
  const questType = getQuestType(quest);
  const userStatus = quest.user_status as Record<string, unknown> | undefined;
  const raw = userStatus?.progress;

  if (raw == null) return 0;
  if (typeof raw === "number") return raw;
  if (typeof raw === "object" && raw !== null) {
    const taskProgress = (raw as Record<string, unknown>)[questType] as Record<string, unknown> | undefined;
    if (taskProgress?.completed_at) return 100;
    if (taskProgress?.value != null) {
      const value = taskProgress.value as number;
      const isVideoType = questType.startsWith("WATCH_VIDEO") || questType === "STREAM_ON_DESKTOP";
      const denominator = isVideoType ? getVideoSecondsNeeded(quest) : getPlayDurationNeeded(quest);
      if (denominator > 0) {
        return Math.min(100, Math.round((value / denominator) * 100));
      }
    }
    return 0;
  }
  return 0;
}
