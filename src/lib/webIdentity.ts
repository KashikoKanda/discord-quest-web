/**
 * Identity WEB thật, chép nguyên từ request của owner
 * (POST https://discord.com/api/v9/science, 22/11/2026 02:48 UTC).
 *
 * Vì sao cần: token này được tạo và đang sống trong Discord WEB (Chrome 157),
 * trong khi web DQA lại giả Electron desktop. Cùng một token mà REST/gateway
 * khai browser "Discord Client" + UA Electron là mâu thuẫn ngay từ request đầu.
 * Ở đây dùng đúng UA Chrome, sec-ch-ua, Accept-Language, x-discord-locale=vi,
 * x-discord-timezone=Asia/Saigon và QUAN TRỌNG NHẤT là x-fingerprint +
 * x-installation-id của chính phiên đó (Discord gắn hai id này với thiết bị).
 */

const UA =
  process.env.WEB_UA ||
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36";

const CHROME = process.env.WEB_CHROME_VERSION || "157.0.0.0";
const LOCALE = process.env.WEB_LOCALE || "vi";
const TIMEZONE = process.env.WEB_TIMEZONE || "Asia/Saigon";
const ACCEPT_LANGUAGE =
  process.env.WEB_ACCEPT_LANGUAGE ||
  "vi-VN,vi;q=0.9,fr-FR;q=0.8,fr;q=0.7,en-US;q=0.6,en;q=0.5";

/** Cặp id của phiên Chrome mà owner chụp được — chỉ dùng cho ĐÚNG account đó. */
const CAPTURE_USER_ID = process.env.WEB_CAPTURE_USER_ID || "732227829143699506";
const CAPTURE_FINGERPRINT =
  process.env.WEB_X_FINGERPRINT || "1573892907528753284.aNo04N2R01LnPE41YF8uL2HujJM";
const CAPTURE_INSTALLATION_ID =
  process.env.WEB_X_INSTALLATION_ID || "1545377557191458879.68Aw7SaRzmhgY6rvbJL_-sjKbi0";

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

/**
 * Mỗi ACCOUNT một thiết bị riêng: x-installation-id và x-fingerprint sinh
 * deterministic từ user id, nên cùng account luôn ra cùng cặp id (kể cả sau
 * deploy), còn hai account khác nhau thì không bao giờ trùng thiết bị.
 * Riêng account đã chụp capture thì trả đúng cặp id thật của owner.
 */
export function idsForUser(userId: string | null): { fingerprint: string; installationId: string } {
  if (userId && userId === CAPTURE_USER_ID) {
    return { fingerprint: CAPTURE_FINGERPRINT, installationId: CAPTURE_INSTALLATION_ID };
  }
  const key = userId || "anonymous";
  let seed = 2166136261;
  for (let i = 0; i < key.length; i++) {
    seed ^= key.charCodeAt(i);
    seed = Math.imul(seed, 16777619) >>> 0;
  }
  const rand = seeded(seed);
  const snowflake = () =>
    String(Math.floor(1.0e18 + rand() * 8.9e17)).slice(0, 19);
  const randPart = () => {
    let out = "";
    for (let i = 0; i < 22; i++) out += B64URL[Math.floor(rand() * 64)];
    return out;
  };
  return {
    fingerprint: `${snowflake()}.${randPart()}`,
    installationId: `${snowflake()}.${randPart()}`,
  };
}

/** Mặc định dùng identity web; đặt IDENTITY_MODE=electron để quay lại UA Electron. */
export function isWebIdentity(): boolean {
  return (process.env.IDENTITY_MODE || "web").toLowerCase() !== "electron";
}

/** x-super-properties: dùng đúng blob owner gửi (env X_SUPER_PROPERTIES) nếu có. */
export function webSuperProps(): string {
  const raw = process.env.X_SUPER_PROPERTIES;
  if (raw && raw.trim().length > 20) return raw.trim();
  return Buffer.from(
    JSON.stringify({
      os: "Windows",
      browser: "Chrome",
      device: "",
      device_model_name: "",
      system_locale: "vi-VN",
      has_client_mods: false,
      browser_user_agent: UA,
      browser_version: CHROME,
      os_version: "10",
      referrer: "",
      referring_domain: "",
      referrer_current: "",
      referring_domain_current: "",
      release_channel: "stable",
      client_build_number: 678976,
      client_event_source: null,
    }),
  ).toString("base64");
}

export function webUserAgent(): string {
  return UA;
}
export function webLocale(): string {
  return LOCALE;
}
export function webTimezone(): string {
  return TIMEZONE;
}
export function webChromeVersion(): string {
  return CHROME;
}

/** Toàn bộ header mang tính identity, khớp 1:1 với capture của owner. */
export function webHeaders(userId?: string | null): Record<string, string> {
  const ids = idsForUser(userId ?? null);
  return {
    "User-Agent": UA,
    "Accept-Language": ACCEPT_LANGUAGE,
    "x-super-properties": webSuperProps(),
    "x-discord-locale": LOCALE,
    "x-discord-timezone": TIMEZONE,
    "x-fingerprint": ids.fingerprint,
    "x-installation-id": ids.installationId,
    "x-debug-options": "bugReporterEnabled",
    "sec-ch-ua": `"Not-A.Brand";v="99", "Google Chrome";v="${CHROME.split(".")[0]}", "Chromium";v="${CHROME.split(".")[0]}"`,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    priority: "u=1, i",
    origin: "https://discord.com",
    referer: "https://discord.com/channels/@me",
    accept: "*/*",
  };
}
