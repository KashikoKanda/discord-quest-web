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
  const h: Record<string, string> = {
    Authorization: token,
    "Content-Type": "application/json",
    "X-Super-Properties": usable(id?.superProperties) ? (id!.superProperties as string) : defaultSuperProps(),
    "X-Discord-Locale": id?.locale || "vi",
    "X-Discord-Timezone": id?.timezone || "Asia/Saigon",
  };
  if (usable(id?.fingerprint)) h["X-Fingerprint"] = id!.fingerprint as string;
  if (usable(id?.installationId)) h["X-Installation-Id"] = id!.installationId as string;
  if (usable(id?.debugOptions)) h["X-Debug-Options"] = id!.debugOptions as string;
  if (usable(id?.acceptLanguageHeader)) h["Accept-Language"] = id!.acceptLanguageHeader as string;
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
    };
  } catch {
    return null;
  }
}

/** Đoạn lệnh dán vào Console của discord.com để lấy token + dữ liệu thiết bị. */
export const CONSOLE_SNIPPET = `(()=>{const c={};const K=['x-super-properties','x-fingerprint','x-installation-id','x-discord-locale','x-discord-timezone'];
const g=h=>{try{if(!h)return;const o=h instanceof Headers?Object.fromEntries(h):(Array.isArray(h)?Object.fromEntries(h):h);for(const k in o){const lk=String(k).toLowerCase();if(K.includes(lk))c[lk]=String(o[k]);}}catch(e){}};
const ok=s=>{const p=String(s||'').split('.');return p.length===3&&p[0].length>=15&&p[2].length>=15;};
const clean=v=>String(v||'').replace(/\s+/g,'').replace(/^["'\`]+|["'\`]+$/g,'').replace(/^(bot|bearer)/i,'');
const findTok=()=>{let t='';
 try{t=clean(localStorage.getItem('token'));if(ok(t))return t;}catch(e){}
 try{for(let i=0;i<localStorage.length;i++){const v=clean(localStorage.getItem(localStorage.key(i)));if(ok(v))return v;}}catch(e){}
 try{window.webpackChunkdiscord_app.push([[Math.random()],{},m=>{for(const x of Object.values(m.c||{})){try{const e=x&&x.exports;if(e&&typeof e.getToken==='function'){const v=clean(e.getToken());if(ok(v))t=v;}}catch(e){}}}]);}catch(e){}
 return ok(t)?t:'';};
const of=window.fetch;window.fetch=function(...a){try{g(a[1]&&a[1].headers);}catch(e){}return of.apply(this,a);};
const ox=XMLHttpRequest.prototype.setRequestHeader;XMLHttpRequest.prototype.setRequestHeader=function(k,v){try{g({[k]:v});}catch(e){}return ox.apply(this,arguments);};
console.log('%cĐang lấy dữ liệu thiết bị, chờ 4 giây...','color:#8B7CF6;font-weight:bold');
setTimeout(async()=>{window.fetch=of;XMLHttpRequest.prototype.setRequestHeader=ox;
const t=findTok();
if(!t){console.log('%c❌ Không tìm thấy token. Hãy chắc chắn bạn đang mở discord.com và ĐÃ ĐĂNG NHẬP, rồi chạy lại lệnh này.','color:#F6606F;font-weight:bold');return;}
const o={t,l:c['x-discord-locale']||'vi',tz:c['x-discord-timezone']||Intl.DateTimeFormat().resolvedOptions().timeZone,sp:c['x-super-properties']||'',fp:c['x-fingerprint']||'',ii:c['x-installation-id']||''};
const s=JSON.stringify(o);let ok2=false;
try{await navigator.clipboard.writeText(s);ok2=true;}catch(e){try{const a=document.createElement('textarea');a.value=s;a.style.cssText='position:fixed;top:-9999px';document.body.appendChild(a);a.select();ok2=document.execCommand('copy');document.body.removeChild(a);}catch(e2){}}
if(ok2){console.log('%c✅ Đã copy (token ...'+t.slice(-6)+'). Dán vào ô Token của web rồi đăng nhập.','color:#3DD68C;font-weight:bold');}
else{console.log('%c⚠ Không tự copy được — chuỗi đã hiện trong khung đen, Ctrl+C rồi dán vào ô Token.','color:#F5B544;font-weight:bold');const a=document.createElement('textarea');a.value=s;a.style.cssText='position:fixed;inset:15% 8%;z-index:2147483647;font:12px monospace;background:#0b0b12;color:#fff;border:1px solid #5865F2;border-radius:10px;padding:10px';document.body.appendChild(a);a.focus();a.select();}
},4000);})();`;
