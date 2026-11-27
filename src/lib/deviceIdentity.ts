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
  hardwareConcurrency?: number;
  deviceMemory?: number;
  screen?: string;
  devicePixelRatio?: number;
  timezoneOffset?: number;
  clientVersion?: string;
  raw?: Record<string, string>;
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

/** Giá trị bị che (secret scanner) hoặc rỗng thì coi như không có. */
function usable(v?: string): boolean {
  if (!v) return false;
  if (v.includes("Secret detected") || v.includes("🔒")) return false;
  return v.trim().length > 0;
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
  const h: Record<string, string> = { Authorization: token, "Content-Type": "application/json" };

  // 1:1 — chép nguyên bộ header thật của Discord, chỉ bỏ header trình duyệt
  // cấm set (user-agent, sec-*) vì browser tự gửi bản đúng của máy.
  // CHỈ những header nằm trong access-control-allow-headers mà discord.com trả về
  // (owner dán capture DevTools 27/11/2026). Header ngoài danh sách này làm
  // preflight OPTIONS thất bại nên trình duyệt KHÔNG gửi request đi:
  //   x-discord-client-version, x-discord-referrer-current,
  //   x-discord-referrer-location, AndroidRequest  → đã bỏ hết.
  const RAW_OK = ["x-super-properties", "x-fingerprint", "x-installation-id", "x-discord-locale",
    "x-discord-timezone", "x-debug-options", "x-client-trace-id", "x-context-properties",
    "x-track", "x-failed-requests", "x-discord-original-md5"];
  if (id?.raw) {
    for (const [k, v] of Object.entries(id.raw)) {
      if (RAW_OK.includes(k.toLowerCase()) && usable(v)) h[k] = v;
    }
  }
  if (usable(id?.superProperties)) h["X-Super-Properties"] = id!.superProperties as string;
  if (!h["X-Super-Properties"] && !h["x-super-properties"]) h["X-Super-Properties"] = defaultSuperProps();
  if (usable(id?.fingerprint)) h["X-Fingerprint"] = id!.fingerprint as string;
  if (usable(id?.installationId)) h["X-Installation-Id"] = id!.installationId as string;
  if (usable(id?.debugOptions)) h["X-Debug-Options"] = id!.debugOptions as string;
  if (usable(id?.clientVersion)) h["X-Discord-Client-Version"] = id!.clientVersion as string;
  if (usable(id?.acceptLanguageHeader)) h["Accept-Language"] = id!.acceptLanguageHeader as string;
  if (!h["X-Discord-Locale"] && !h["x-discord-locale"]) h["X-Discord-Locale"] = id?.locale || "vi";
  if (!h["X-Discord-Timezone"] && !h["x-discord-timezone"]) h["X-Discord-Timezone"] = id?.timezone || "Asia/Saigon";
  return { ...h, ...(extra || {}) };
}

/** Nhận chuỗi JSON dán từ console (hoặc token trần) và tách ra token + identity. */
export function parseIdentityPayload(text: string): DeviceIdentity | null {
  const raw = (text || "").trim();
  if (!raw.startsWith("{")) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    const pick = (...keys: string[]): string | undefined => {
      for (const k of keys) {
        const v = o[k];
        if (v !== undefined && v !== null && String(v) !== "") return String(v);
      }
      return undefined;
    };
    const token = (pick("t", "tok", "token", "TOKEN") || "")
      .replace(/\s+/g, "")
      .replace(/^["'`]+|["'`]+$/g, "")
      .replace(/^(bot|bearer)/i, "");
    if (!token) return null;
    const safe = (v?: string) => (v && !v.includes("Secret detected") && !v.includes("🔒") ? v : undefined);
    return {
      token,
      userAgent: pick("ua", "userAgent"),
      locale: pick("l", "locale"),
      timezone: pick("tz", "timezone"),
      superProperties: safe(pick("sp", "superProperties")),
      fingerprint: safe(pick("fp", "fingerprint")),
      installationId: safe(pick("ii", "installationId")),
      debugOptions: safe(pick("dbg", "debugOptions")),
      acceptLanguageHeader: safe(pick("al", "acceptLanguageHeader")),
      platform: pick("p", "platform"),
      hardwareConcurrency: Number(pick("hc")) || undefined,
      deviceMemory: Number(pick("dm")) || undefined,
      screen: pick("scr", "screen"),
      devicePixelRatio: Number(pick("dpr")) || undefined,
      timezoneOffset: Number(pick("tzo")) || undefined,
      clientVersion: pick("cv", "clientVersion"),
      raw: (o.raw && typeof o.raw === "object" ? (o.raw as Record<string, string>) : undefined),
    };
  } catch {
    return null;
  }
}

/** Đoạn lệnh dán vào Console của discord.com để lấy token + dữ liệu thiết bị. */
export const CONSOLE_SNIPPET = `(()=>{const c={};const KEYS=['x-super-properties','x-fingerprint','x-installation-id','x-discord-locale','x-discord-timezone','x-debug-options','accept-language','x-discord-client-version','x-client-trace-id','x-discord-referrer-current','x-discord-referrer-location','user-agent','sec-ch-ua','sec-ch-ua-mobile','sec-ch-ua-platform','x-super-properties'];
const g=h=>{try{if(!h)return;const o=h instanceof Headers?Object.fromEntries(h):(Array.isArray(h)?Object.fromEntries(h):h);for(const k in o){const lk=String(k).toLowerCase();if(KEYS.includes(lk))c[lk]=String(o[k]);}}catch(e){}};
const ok=s=>{const p=String(s||'').split('.');return p.length===3&&p[0].length>=15&&p[2].length>=15;};
const clean=v=>String(v||'').replace(/\\s+/g,'').replace(/^["'\`]+|["'\`]+$/g,'').replace(/^(bot|bearer)/i,'');
const findTok=()=>{let t='';
 try{t=clean(localStorage.getItem('token'));if(ok(t))return t;}catch(e){}
 try{for(let i=0;i<localStorage.length;i++){const v=clean(localStorage.getItem(localStorage.key(i)));if(ok(v))return v;}}catch(e){}
 try{window.webpackChunkdiscord_app.push([[Math.random()],{},m=>{for(const x of Object.values(m.c||{})){try{const e=x&&x.exports;if(e&&typeof e.getToken==='function'){const v=clean(e.getToken());if(ok(v))t=v;}}catch(e){}}}]);}catch(e){}
 return ok(t)?t:'';};
const of=window.fetch;window.fetch=function(...a){try{g(a[1]&&a[1].headers);}catch(e){}return of.apply(this,a);};
const ox=XMLHttpRequest.prototype.setRequestHeader;XMLHttpRequest.prototype.setRequestHeader=function(k,v){try{g({[k]:v});}catch(e){}return ox.apply(this,arguments);};
console.log('%cĐang lấy TOÀN BỘ dữ liệu thiết bị, chờ 4 giây...','color:#8B7CF6;font-weight:bold');
setTimeout(async()=>{window.fetch=of;XMLHttpRequest.prototype.setRequestHeader=ox;
const t=findTok();
if(!t){console.log('%c❌ Không tìm thấy token. Mở discord.com, ĐĂNG NHẬP rồi chạy lại lệnh.','color:#F6606F;font-weight:bold');return;}
const o={t,ua:navigator.userAgent,al:navigator.language,als:(navigator.languages||[]).join(','),p:navigator.platform,hc:navigator.hardwareConcurrency||0,dm:navigator.deviceMemory||0,scr:(screen.width+'x'+screen.height+'x'+screen.colorDepth),dpr:window.devicePixelRatio||1,tzo:new Date().getTimezoneOffset(),l:c['x-discord-locale']||'vi',tz:c['x-discord-timezone']||Intl.DateTimeFormat().resolvedOptions().timeZone,sp:c['x-super-properties']||'',fp:c['x-fingerprint']||'',ii:c['x-installation-id']||'',dbg:c['x-debug-options']||'',cv:c['x-discord-client-version']||'',raw:c};
const s=JSON.stringify(o);let ok2=false;
try{await navigator.clipboard.writeText(s);ok2=true;}catch(e){try{const a=document.createElement('textarea');a.value=s;a.style.cssText='position:fixed;top:-9999px';document.body.appendChild(a);a.select();ok2=document.execCommand('copy');document.body.removeChild(a);}catch(e2){}}
if(ok2){console.log('%c✅ Đã copy TOÀN BỘ ('+Math.round(s.length/1024)+'KB, token …'+t.slice(-6)+'). Dán vào ô Token của web.','color:#3DD68C;font-weight:bold');}
else{console.log('%c⚠ Không tự copy được — chuỗi hiện trong khung đen, Ctrl+C rồi dán.','color:#F5B544;font-weight:bold');const a=document.createElement('textarea');a.value=s;a.style.cssText='position:fixed;inset:15% 8%;z-index:2147483647;font:12px monospace;background:#0b0b12;color:#fff;border:1px solid #5865F2;border-radius:10px;padding:10px';document.body.appendChild(a);a.focus();a.select();}
},4000);})();`;
