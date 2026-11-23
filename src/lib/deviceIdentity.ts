/**
 * Dữ liệu thiết bị lấy từ chính phiên Discord đang sống (console) và gắn cứng
 * vào token. Mục đích: mọi request web gửi đi có ĐÚNG bộ header mà client thật
 * của người dùng đang gửi (x-super-properties, x-fingerprint, x-installation-id,
 * locale, timezone), nên Discord thấy cùng một thiết bị thay vì hai client.
 */

export type DeviceIdentity = {
  token: string;
  userAgent?: string;
  locale?: string;
  timezone?: string;
  superProperties?: string;
  fingerprint?: string;
  installationId?: string;
  debugOptions?: string;
  acceptLanguageHeader?: string;
  platform?: string;
  capturedAt?: number;
};

const PREFIX = "dqa_dev_";

export function identityKey(token: string): string {
  const clean = (token || "").trim().replace(/^["'`]|["'`]$/g, "").replace(/^(bot|bearer)\s+/i, "").replace(/\s+/g, "");
  return PREFIX + clean.slice(0, 16);
}

export function saveDeviceIdentity(token: string, id: DeviceIdentity) {
  try {
    localStorage.setItem(identityKey(token), JSON.stringify({ ...id, token: undefined, capturedAt: Date.now() }));
  } catch { /* localStorage bị chặn */ }
}

export function getDeviceIdentity(token: string): DeviceIdentity | null {
  try {
    const raw = localStorage.getItem(identityKey(token));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DeviceIdentity;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function clearDeviceIdentity(token: string) {
  try { localStorage.removeItem(identityKey(token)); } catch { /* ignore */ }
}

function defaultSuperProps(): string {
  return JSON.stringify({
    os: "Windows",
    browser: "Chrome",
    device: "",
    system_locale: "vi-VN",
    has_client_mods: false,
    client_version: "1.0.9269",
    release_channel: "stable",
  });
}

/** Header gửi Discord: ưu tiên dữ liệu đã lấy từ máy người dùng. */
export function buildDiscordHeaders(token: string, extra?: Record<string, string>): Record<string, string> {
  const id = getDeviceIdentity(token);
  const h: Record<string, string> = {
    Authorization: token,
    "Content-Type": "application/json",
    "X-Super-Properties": id?.superProperties || defaultSuperProps(),
    "X-Discord-Locale": id?.locale || "vi",
    "X-Discord-Timezone": id?.timezone || "Asia/Saigon",
  };
  if (id?.fingerprint) h["X-Fingerprint"] = id.fingerprint;
  if (id?.installationId) h["X-Installation-Id"] = id.installationId;
  if (id?.debugOptions) h["X-Debug-Options"] = id.debugOptions;
  if (id?.acceptLanguageHeader) h["Accept-Language"] = id.acceptLanguageHeader;
  return { ...h, ...(extra || {}) };
}

/** Nhận chuỗi JSON dán từ console (hoặc token trần) và tách ra token + identity. */
export function parseIdentityPayload(text: string): DeviceIdentity | null {
  const t = (text || "").trim();
  if (!t.startsWith("{")) return null;
  try {
    const o = JSON.parse(t) as Record<string, unknown>;
    const token = String(o.token || o.TOKEN || "").trim();
    if (!token) return null;
    return {
      token,
      userAgent: o.userAgent ? String(o.userAgent) : undefined,
      locale: o.locale ? String(o.locale) : undefined,
      timezone: o.timezone ? String(o.timezone) : undefined,
      superProperties: o.superProperties ? String(o.superProperties) : undefined,
      fingerprint: o.fingerprint ? String(o.fingerprint) : undefined,
      installationId: o.installationId ? String(o.installationId) : undefined,
      debugOptions: o.debugOptions ? String(o.debugOptions) : undefined,
      acceptLanguageHeader: o.acceptLanguageHeader ? String(o.acceptLanguageHeader) : undefined,
      platform: o.platform ? String(o.platform) : undefined,
    };
  } catch {
    return null;
  }
}

/** Đoạn lệnh dán vào Console của discord.com để lấy token + dữ liệu thiết bị. */
export const CONSOLE_SNIPPET = `(()=>{const cap={};const KEYS=['x-super-properties','x-fingerprint','x-installation-id','x-discord-locale','x-discord-timezone','x-debug-options','accept-language'];
const grab=h=>{try{if(!h)return;const o=h instanceof Headers?Object.fromEntries(h.entries()):(Array.isArray(h)?Object.fromEntries(h):h);for(const k of Object.keys(o)){const lk=String(k).toLowerCase();if(KEYS.includes(lk))cap[lk]=String(o[k]);}}catch(e){}};
const of=window.fetch;window.fetch=function(...a){try{const i=a[1]||{};grab(i.headers);if(a[0]&&a[0].headers)grab(a[0].headers);}catch(e){}return of.apply(this,a);};
const ox=XMLHttpRequest.prototype.setRequestHeader;XMLHttpRequest.prototype.setRequestHeader=function(k,v){try{grab({[k]:v});}catch(e){}return ox.apply(this,arguments);};
console.log('%cĐang thu thập header thật của Discord, chờ 5 giây...','color:#8B7CF6;font-weight:bold');
setTimeout(async()=>{window.fetch=of;XMLHttpRequest.prototype.setRequestHeader=ox;
const token=(()=>{try{return (localStorage.getItem('token')||'').replace(/"/g,'');}catch(e){return '';}})();
const out={token,userAgent:navigator.userAgent,locale:cap['x-discord-locale']||'vi',timezone:cap['x-discord-timezone']||Intl.DateTimeFormat().resolvedOptions().timeZone,superProperties:cap['x-super-properties']||'',fingerprint:cap['x-fingerprint']||'',installationId:cap['x-installation-id']||'',debugOptions:cap['x-debug-options']||'',acceptLanguageHeader:cap['accept-language']||navigator.language,platform:navigator.platform};
const s=JSON.stringify(out);try{await navigator.clipboard.writeText(s);console.log('%cĐÃ COPY. Dán vào ô đăng nhập của web.','color:#3DD68C;font-weight:bold');}catch(e){console.log('%cKhông copy tự động được, copy thủ công chuỗi dưới đây:','color:#F5B544');}
console.log(s);},5000);})();`;
