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

const X_FINGERPRINT =
  process.env.WEB_X_FINGERPRINT || "1573892907528753284.aNo04N2R01LnPE41YF8uL2HujJM";
const X_INSTALLATION_ID =
  process.env.WEB_X_INSTALLATION_ID || "1545377557191458879.68Aw7SaRzmhgY6rvbJL_-sjKbi0";

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
export function webHeaders(): Record<string, string> {
  return {
    "User-Agent": UA,
    "Accept-Language": ACCEPT_LANGUAGE,
    "x-super-properties": webSuperProps(),
    "x-discord-locale": LOCALE,
    "x-discord-timezone": TIMEZONE,
    "x-fingerprint": X_FINGERPRINT,
    "x-installation-id": X_INSTALLATION_ID,
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
