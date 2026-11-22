/**
 * Identity THẬT, chép từ hai capture của owner (22/11/2026):
 *  A. PC web  — POST /api/v9/science, Chrome 157 Windows, referer /channels/@me
 *  B. Android — POST /api/v9/science, Chrome 154 Android WebView, referer /quest-home
 *
 * So sánh hai capture (phần này là cơ sở để chọn đúng profile cho từng token):
 *  GIỐNG NHAU (bắt buộc luôn khớp): x-discord-locale=vi, x-discord-timezone=
 *  Asia/Saigon, x-debug-options=bugReporterEnabled, origin https://discord.com,
 *  client_build_number 678976, release_channel stable, has_client_mods false,
 *  có x-installation-id, sec-ch-ua-* luôn khớp với UA đang khai.
 *  KHÁC NHAU: UA (Windows Chrome 157 vs Android WebView Chrome 154),
 *  sec-ch-ua-mobile (?0 vs ?1), sec-ch-ua-platform ("Windows" vs "Android"),
 *  brand list (Google Chrome vs Chromium/Lemur/Edge Simulate),
 *  referer (/channels/@me vs /quest-home),
 *  x-fingerprint (PC CÓ, Android KHÔNG có),
 *  super-properties (os Windows/browser Chrome/device "" vs os Android/browser
 *  "Android Chrome"/device "Android", và Android có thêm
 *  client_heartbeat_session_id).
 *
 * Vì vậy mỗi token phải khai đúng một profile và giữ nguyên suốt phiên: gửi
 * x-fingerprint cho một phiên mobile là header mà client Android không bao giờ
 * gửi, còn khai os Windows cho token tạo trên mobile cũng lệch y như trước.
 */

export type IdentityProfile = "pc-web" | "android-app";

const LOCALE = process.env.WEB_LOCALE || "vi";
const TIMEZONE = process.env.WEB_TIMEZONE || "Asia/Saigon";

/** Account đã chụp capture PC — giữ đúng cặp id thật của owner. */
const CAPTURE_USER_ID = process.env.WEB_CAPTURE_USER_ID || "732227829143699506";
const CAPTURE_FINGERPRINT =
  process.env.WEB_X_FINGERPRINT || "1573892907528753284.aNo04N2R01LnPE41YF8uL2HujJM";
const CAPTURE_INSTALLATION_ID =
  process.env.WEB_X_INSTALLATION_ID || "1545377557191458879.68Aw7SaRzmhgY6rvbJL_-sjKbi0";

const PC = {
  ua:
    process.env.WEB_UA ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36",
  chrome: process.env.WEB_CHROME_VERSION || "157.0.0.0",
  acceptLanguage:
    process.env.WEB_ACCEPT_LANGUAGE ||
    "vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5",
  brands: (v: string) => `"Not-A.Brand";v="99", "Google Chrome";v="${v}", "Chromium";v="${v}"`,
  mobile: "?0",
  platform: '"Windows"',
  referer: "https://discord.com/channels/@me",
  superProps: {
    os: "Windows",
    browser: "Chrome",
    device: "",
    device_model_name: "",
    system_locale: "vi-VN",
    browser_version: "157.0.0.0",
    os_version: "10",
  },
};

const ANDROID = {
  ua:
    process.env.WEB_ANDROID_UA ||
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36",
  chrome: process.env.WEB_ANDROID_CHROME_VERSION || "154.0.0.0",
  // Client Android gửi Accept-Language riêng; capture chỉ có x-discord-locale=vi.
  acceptLanguage: process.env.WEB_ANDROID_ACCEPT_LANGUAGE || "vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7",
  brands: () => `"Not A(Brand";v="99", "Chromium";v="154", "Microsoft Edge Simulate";v="154", "Lemur";v="154"`,
  mobile: "?1",
  platform: '"Android"',
  referer: "https://discord.com/quest-home",
  superProps: {
    os: "Android",
    browser: "Android Chrome",
    device: "Android",
    device_model_name: "",
    system_locale: "en-US",
    browser_version: "154.0.0.0",
    os_version: "10",
  },
};

/** Mặc định pc-web; IDENTITY_PROFILE=android-app để đổi mặc định toàn hệ thống. */
export function isWebIdentity(): boolean {
  return (process.env.IDENTITY_MODE || "web").toLowerCase() !== "electron";
}

/** IDENTITY_PROFILE_MAP="uid1:android,uid2:pc" — ghim profile cho từng account. */
export function profileForUser(userId?: string | null): IdentityProfile {
  const map = (process.env.IDENTITY_PROFILE_MAP || "").trim();
  if (map && userId) {
    for (const pair of map.split(",")) {
      const [uid, prof] = pair.split(":").map((s) => s.trim());
      if (uid && uid === userId) {
        return prof === "android" || prof === "android-app" ? "android-app" : "pc-web";
      }
    }
  }
  const def = (process.env.IDENTITY_PROFILE || "pc-web").toLowerCase();
  return def === "android" || def === "android-app" ? "android-app" : "pc-web";
}

/** Lấy user id từ chính token (segment 1 là base64 của snowflake). */
export function userIdFromToken(token: string): string | null {
  const seg = (token || "").replace(/^mfa\./i, "").split(".")[0];
  if (!seg) return null;
  try {
    const id = Buffer.from(seg, "base64").toString("utf8").replace(/[^0-9]/g, "");
    return id.length >= 15 ? id : null;
  } catch {
    return null;
  }
}

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function seeded(seed: number) {
  let st = seed >>> 0 || 1;
  return () => {
    st ^= st << 13; st >>>= 0;
    st ^= st >>> 17;
    st ^= st << 5; st >>>= 0;
    return st / 4294967296;
  };
}

function hash(key: string): number {
  let seed = 2166136261;
  for (let i = 0; i < key.length; i++) {
    seed ^= key.charCodeAt(i);
    seed = Math.imul(seed, 16777619) >>> 0;
  }
  return seed;
}

/**
 * Mỗi ACCOUNT một thiết bị riêng: id sinh deterministic từ user id nên cùng
 * account luôn ra cùng bộ kể cả sau deploy, hai account khác nhau thì khác máy.
 * Account đã chụp capture PC vẫn dùng đúng cặp id thật của owner.
 */
export function idsForUser(userId: string | null): {
  fingerprint: string;
  installationId: string;
  heartbeatId: string;
} {
  if (userId && userId === CAPTURE_USER_ID) {
    return {
      fingerprint: CAPTURE_FINGERPRINT,
      installationId: CAPTURE_INSTALLATION_ID,
      heartbeatId: `${CAPTURE_INSTALLATION_ID.split(".")[0]}.${CAPTURE_INSTALLATION_ID.split(".")[1]?.slice(0, 22) || ""}`,
    };
  }
  const rand = seeded(hash(userId || "anonymous"));
  const snowflake = () => String(Math.floor(1.0e18 + rand() * 8.9e17)).slice(0, 19);
  const randPart = () => {
    let out = "";
    for (let i = 0; i < 22; i++) out += B64URL[Math.floor(rand() * 64)];
    return out;
  };
  const installationId = `${snowflake()}.${randPart()}`;
  return {
    fingerprint: `${snowflake()}.${randPart()}`,
    installationId,
    heartbeatId: `${snowflake()}.${randPart()}`,
  };
}

/** x-super-properties: dùng blob thật trong env nếu có, không thì dựng khớp profile. */
export function webSuperProps(userId?: string | null): string {
  const profile = profileForUser(userId);
  const raw =
    profile === "android-app"
      ? process.env.X_SUPER_PROPERTIES_ANDROID || process.env.X_SUPER_PROPERTIES_2
      : process.env.X_SUPER_PROPERTIES;
  if (raw && raw.trim().length > 20) return raw.trim();
  const base = profile === "android-app" ? ANDROID : PC;
  const ids = idsForUser(userId ?? null);
  const payload: Record<string, unknown> = {
    os: base.superProps.os,
    browser: base.superProps.browser,
    device: base.superProps.device,
    device_model_name: base.superProps.device_model_name,
    system_locale: base.superProps.system_locale,
    has_client_mods: false,
    browser_user_agent: base.ua,
    browser_version: base.superProps.browser_version,
    os_version: base.superProps.os_version,
    referrer: "",
    referring_domain: "",
    referrer_current: "",
    referring_domain_current: "",
    release_channel: "stable",
    client_build_number: 678976,
    client_event_source: null,
    client_launch_id: ids.installationId,
  };
  // Android có thêm client_heartbeat_session_id, PC web thì không.
  if (profile === "android-app") payload.client_heartbeat_session_id = ids.heartbeatId;
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

export function webUserAgent(userId?: string | null): string {
  return profileForUser(userId) === "android-app" ? ANDROID.ua : PC.ua;
}
export function webLocale(): string {
  return LOCALE;
}
export function webTimezone(): string {
  return TIMEZONE;
}
export function webChromeVersion(userId?: string | null): string {
  return profileForUser(userId) === "android-app" ? ANDROID.chrome : PC.chrome;
}

/** Bộ header identity, khớp 1:1 với capture của profile tương ứng. */
export function webHeaders(userId?: string | null): Record<string, string> {
  const profile = profileForUser(userId);
  const base = profile === "android-app" ? ANDROID : PC;
  const ids = idsForUser(userId ?? null);
  const major = base.chrome.split(".")[0];
  const headers: Record<string, string> = {
    "User-Agent": base.ua,
    "Accept-Language": base.acceptLanguage,
    "x-super-properties": webSuperProps(userId),
    "x-discord-locale": LOCALE,
    "x-discord-timezone": TIMEZONE,
    "x-installation-id": ids.installationId,
    "x-debug-options": "bugReporterEnabled",
    "sec-ch-ua": base.brands(major),
    "sec-ch-ua-mobile": base.mobile,
    "sec-ch-ua-platform": base.platform,
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    priority: "u=1, i",
    origin: "https://discord.com",
    referer: base.referer,
    accept: "*/*",
  };
  // Client Android KHÔNG gửi x-fingerprint, chỉ PC web mới có.
  if (profile !== "android-app") headers["x-fingerprint"] = ids.fingerprint;
  return headers;
}
