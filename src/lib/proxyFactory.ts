/**
 * ProxyFactory — tạo proxy theo quốc gia NGAY KHI CẦN (ResiFactory API).
 *
 * Quy tắc của owner:
 *  - Nhận quest ẩn ở quốc gia nào → tạo proxy đúng quốc gia đó.
 *  - Cùng uid + cùng quốc gia → DÙNG LẠI proxy đã tạo (không tạo mới).
 *  - Mỗi uid một proxy riêng để không dính cờ spam.
 *  - Login: proxy theo nước người dùng nhưng KHÔNG duy trì, tạo xong dùng một lần.
 *
 * Quy tắc cứng chống treo/đốt dung lượng:
 *  - Gọi API tạo proxy có timeout 12s, tối đa 1 lần thử lại.
 *  - Không vòng lặp vô hạn, không retry khi API trả 4xx.
 *  - Cache có hạn theo session; hết hạn thì tạo lại đúng 1 lần.
 *  - Mọi request qua proxy đều phải có timeout (xem proxyFactoryFetch).
 */

import { ProxyEntry } from "./proxyList";

const RF_API = "https://resifactory.net/api/v1";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36";

/** Premium cho sticky dài (tối đa 1440 phút); Essential chỉ 120 phút. */
const POOL = process.env.RF_POOL || "walmart_premium";
const SESSION_MINUTES = Math.min(Number(process.env.RF_SESSION_MINUTES || 1440), 1440);
const CREATE_TIMEOUT_MS = Number(process.env.RF_CREATE_TIMEOUT_MS || 12_000);

export interface FactoryProxy {
  entry: ProxyEntry;
  country: string;
  uid: string;
  createdAt: number;
  expiresAt: number;
}

/** key = `${uid}|${COUNTRY}` → proxy đang giữ cho uid đó ở nước đó */
const cache = new Map<string, FactoryProxy>();
/** key → promise đang tạo, để 2 request đồng thời không tạo 2 proxy */
const inflight = new Map<string, Promise<FactoryProxy | null>>();

const stats = { created: 0, reused: 0, failed: 0 };

function apiToken(): string | null {
  return process.env.RF_API_TOKEN || process.env.TOOLIP_API_TOKEN || null;
}

/** Tạo 1 proxy mới từ ResiFactory. Trả null nếu không cấu hình hoặc lỗi. */
async function createProxy(uid: string, country: string): Promise<FactoryProxy | null> {
  const token = apiToken();
  if (!token) {
    console.warn("[ProxyFactory] Thiếu RF_API_TOKEN — bỏ qua tạo proxy.");
    return null;
  }
  const cc = country.toUpperCase();
  const body = JSON.stringify({
    pool: POOL,
    country: cc.toLowerCase(),
    proxyType: "sticky",
    sessionDuration: SESSION_MINUTES,
    quantity: 1,
    protocol: "http",
    format: "list",
  });

  for (let attempt = 0; attempt < 2; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CREATE_TIMEOUT_MS);
    try {
      const res = await fetch(`${RF_API}/proxies`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": UA,
        },
        body,
        signal: ctrl.signal,
      });
      if (!res.ok) {
        // 4xx là lỗi cấu hình/quốc gia/ví → thử lại cũng vô ích
        console.warn(`[ProxyFactory] ${cc}: API trả ${res.status}, không thử lại.`);
        stats.failed++;
        return null;
      }
      const data: any = await res.json();
      if (data?.is_demo) {
        console.warn("[ProxyFactory] Ví ResiFactory hết dung lượng (bản demo) — không dùng.");
        stats.failed++;
        return null;
      }
      const line = String(data?.proxies || "").trim().split("\n").filter(Boolean)[0];
      if (!line) {
        stats.failed++;
        return null;
      }
      const [host, port, user, pass] = line.replace(/^https?:\/\//, "").split(":");
      if (!host || !port || !user || !pass) {
        stats.failed++;
        return null;
      }
      const entry: ProxyEntry = {
        raw: line,
        protocol: "http",
        host,
        port: Number(port),
        user,
        pass,
        countryCode: cc,
        proxyUrl: `http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`,
      };
      const now = Date.now();
      const record: FactoryProxy = {
        entry,
        country: cc,
        uid,
        createdAt: now,
        expiresAt: now + SESSION_MINUTES * 60_000,
      };
      stats.created++;
      console.log(`[ProxyFactory] Tạo proxy ${cc} cho ${uid.slice(0, 10)} → ${host}:${port} (giữ ${SESSION_MINUTES}m)`);
      return record;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (attempt === 0) {
        console.warn(`[ProxyFactory] ${cc}: lỗi tạo proxy (${msg.slice(0, 60)}), thử lại 1 lần.`);
        continue;
      }
      console.warn(`[ProxyFactory] ${cc}: bỏ sau 2 lần lỗi (${msg.slice(0, 60)}).`);
      stats.failed++;
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
  return null;
}

/** Proxy dùng lại cho uid + quốc gia, tạo mới nếu chưa có hoặc đã hết hạn. */
export async function getOrCreateProxy(uid: string, country: string): Promise<FactoryProxy | null> {
  const cc = (country || "").toUpperCase();
  if (!cc || cc.length !== 2) return null;
  const key = `${uid}|${cc}`;

  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    stats.reused++;
    return hit;
  }
  if (hit) cache.delete(key);

  const running = inflight.get(key);
  if (running) return running;

  const p = createProxy(uid, cc)
    .then((rec) => {
      if (rec) cache.set(key, rec);
      return rec;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Proxy dùng một lần cho login — không ghi cache, không duy trì. */
export async function getEphemeralProxy(country: string): Promise<FactoryProxy | null> {
  return createProxy(`login-${Date.now()}`, (country || "").toUpperCase());
}

/** Thống kê nhẹ để nhìn được có đốt proxy vô ích không. */
/** ProxyFactory có bật không (đã cấu hình API key). */
export function isFactoryEnabled(): boolean {
  return !!process.env.RF_API_TOKEN;
}

/** uid đã có proxy cho nước này chưa (đang còn hạn cache). */
export function hasFactoryProxy(uid: string, country: string): boolean {
  const hit = cache.get(`${uid}|${country.toUpperCase()}`);
  return !!hit && hit.expiresAt > Date.now();
}

export function getFactoryStats() {
  return {
    ...stats,
    cached: cache.size,
    inflight: inflight.size,
    pool: POOL,
    sessionMinutes: SESSION_MINUTES,
  };
}

/** Giải phóng cache (dùng khi logout hoặc test). */
export function releaseFactoryProxy(uid: string, country?: string) {
  const cc = (country || "").toUpperCase();
  for (const key of [...cache.keys()]) {
    if (cc ? key === `${uid}|${cc}` : key.startsWith(`${uid}|`)) cache.delete(key);
  }
}
