/**
 * Proxy Helper — Get a random proxy for login requests
 *
 * Mục đích: Đừng dùng IP server chung để login Discord (bị rate-limit).
 * Mỗi login request → dùng 1 proxy ngẫu nhiên từ pool (498 proxies, 24 countries).
 *
 * Sử dụng:
 *   import { getRandomProxy, fetchWithProxy } from "@/lib/proxyHelper";
 *   const proxy = await getRandomProxy();
 *   const res = await fetchWithProxy(url, options, proxy);
 *
 * Hoặc:
 *   import { getRandomProxyAgent } from "@/lib/proxyHelper";
 *   const agent = await getRandomProxyAgent();
 *   const res = await fetch(url, { ...options, dispatcher: agent });
 */

import { ProxyAgent, fetch as undiciFetch } from "undici";
import { fetchProxyList, type ProxyEntry } from "./proxyList";

// Cache proxies in-memory to avoid refetching on every login
let cachedProxies: ProxyEntry[] = [];
let cacheLoadedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // Refresh every 5 minutes

/**
 * "fetch failed" của undici không nói gì cả — nguyên nhân thật (ENOTFOUND,
 * ECONNREFUSED, ETIMEDOUT, TLS...) nằm trong err.cause. Không bóc ra thì mọi
 * sự cố proxy đều hiện một câu vô nghĩa và không biết là do gateway chết hay do
 * proxy của tài khoản bị khoá.
 */
/**
 * Đếm traffic THẬT đã đi qua proxy cho từng token.
 *
 * Proxy owl tính tiền theo dung lượng, nên phải biết cái gì đốt tiền chứ không
 * đoán. Mọi request qua fetchWithTokenProxy đều cộng vào đây: body gửi đi +
 * content-length trả về + ~1.2KB overhead TLS/header của đường hầm proxy.
 */
export interface ProxyTraffic {
  requests: number;
  bytes: number;
}

declare global {
  var dqaProxyTraffic: Map<string, ProxyTraffic> | undefined;
}

function trafficMap(): Map<string, ProxyTraffic> {
  if (!globalThis.dqaProxyTraffic) globalThis.dqaProxyTraffic = new Map();
  return globalThis.dqaProxyTraffic;
}

function addTraffic(tokenId: string | undefined, requestBytes: number, responseBytes: number): void {
  if (!tokenId) return;
  const map = trafficMap();
  const cur = map.get(tokenId) || { requests: 0, bytes: 0 };
  cur.requests += 1;
  cur.bytes += requestBytes + responseBytes + 1200;
  map.set(tokenId, cur);
}

/**
 * Cầu dao cho lỗi 407.
 *
 * Gateway owl từ chối xác thực thì MỌI proxy trong pool đều trả 407 như nhau, và
 * mỗi lần thử vẫn phải mở một đường hầm CONNECT mới → vẫn tính tiền dung lượng.
 * Log thật cho thấy 12 lần 407 trong 6 giây cho một token; cộng dồn nhiều token
 * là hàng trăm MB mỗi ngày cho những lần thử chắc chắn thất bại.
 *
 * Gặp 3 lỗi 407 liên tiếp thì ngừng gọi proxy PROXY_AUTH_BLOCK_MS (mặc định 10
 * phút), trả lỗi ngay tại chỗ, không mở đường hầm nào nữa.
 */
const PROXY_AUTH_BLOCK_MS = Math.max(
  60_000,
  Number(process.env.PROXY_AUTH_BLOCK_MS || 10 * 60 * 1000),
);

declare global {
  var dqaProxyAuthGuard: { failures: number; blockedUntil: number } | undefined;
}

function authGuard(): { failures: number; blockedUntil: number } {
  if (!globalThis.dqaProxyAuthGuard) globalThis.dqaProxyAuthGuard = { failures: 0, blockedUntil: 0 };
  return globalThis.dqaProxyAuthGuard;
}

/** Số ms proxy còn bị tạm khoá vì 407 (0 = đang dùng bình thường). */
export function proxyAuthBlockedFor(): number {
  const g = authGuard();
  return Math.max(0, g.blockedUntil - Date.now());
}

function noteProxyAuthFailure(): void {
  const g = authGuard();
  g.failures += 1;
  if (g.failures >= 3) {
    g.blockedUntil = Date.now() + PROXY_AUTH_BLOCK_MS;
    g.failures = 0;
    console.warn(
      `[ProxySticky] Gateway từ chối xác thực (407) 3 lần liên tiếp — tạm ngừng gọi proxy ` +
        `${Math.round(PROXY_AUTH_BLOCK_MS / 60000)} phút để không đốt thêm traffic.`,
    );
  }
}

/** Cho các chỗ tự gọi proxy (vd /api/auth/login) báo lỗi 407 để bật chế độ bảo trì. */
export function reportProxyAuthFailure(): void {
  noteProxyAuthFailure();
}

function noteProxyAuthSuccess(): void {
  const g = authGuard();
  g.failures = 0;
  g.blockedUntil = 0;
}

export function getProxyTraffic(tokenId: string): ProxyTraffic {
  return trafficMap().get(tokenId) || { requests: 0, bytes: 0 };
}

export function resetProxyTraffic(tokenId: string): void {
  trafficMap().set(tokenId, { requests: 0, bytes: 0 });
}

export function describeFetchError(err: unknown): string {
  const e = err as { message?: string; code?: string; cause?: unknown };
  const parts: string[] = [e?.message || String(err)];
  let cause = e?.cause as { message?: string; code?: string; errno?: string; address?: string; port?: number } | undefined;
  for (let depth = 0; cause && depth < 3; depth++) {
    const bit = [cause.code, cause.message, cause.address && `${cause.address}:${cause.port}`]
      .filter(Boolean)
      .join(" / ");
    if (bit) parts.push(`cause: ${bit}`);
    cause = (cause as { cause?: typeof cause }).cause;
  }
  return parts.join(" | ");
}

/**
 * Get all proxies from the pool (cached for 5 minutes).
 */
export async function getAllProxies(): Promise<ProxyEntry[]> {
  const now = Date.now();
  if (cachedProxies.length > 0 && now - cacheLoadedAt < CACHE_TTL_MS) {
    return cachedProxies;
  }
  try {
    const proxies = await fetchProxyList();
    cachedProxies = proxies;
    cacheLoadedAt = now;
    console.log(`[ProxyHelper] Loaded ${proxies.length} proxies from pool`);
    return proxies;
  } catch (err: any) {
    console.error("[ProxyHelper] Failed to load proxies:", err.message);
    return cachedProxies.length > 0 ? cachedProxies : [];
  }
}

/**
 * Pick a random proxy from the pool.
 * Returns null if pool is empty.
 */
export async function getRandomProxy(): Promise<ProxyEntry | null> {
  const proxies = await getAllProxies();
  if (proxies.length === 0) return null;
  return proxies[Math.floor(Math.random() * proxies.length)];
}

/**
 * Pick a random proxy from the pool (preferred countries for Discord).
 * US/GB/CA/SG have lower Discord rate-limit.
 */
const PREFERRED_COUNTRIES = ["US", "GB", "CA", "SG", "JP", "AU", "DE", "FR"];
export async function getRandomPreferredProxy(): Promise<ProxyEntry | null> {
  const proxies = await getAllProxies();
  if (proxies.length === 0) return null;
  // Try preferred countries first
  const preferred = proxies.filter(p =>
    p.countryCode && PREFERRED_COUNTRIES.includes(p.countryCode.toUpperCase())
  );
  if (preferred.length > 0) {
    return preferred[Math.floor(Math.random() * preferred.length)];
  }
  // Fallback to any
  return proxies[Math.floor(Math.random() * proxies.length)];
}

/**
 * Build proxy URL string from ProxyEntry.
 * Format: http://user:pass@host:port
 *
 * Note: do NOT URL-encode the auth — undici/curl expect raw credentials.
 * Encoding breaks owlproxy usernames like "8320967-b1cb285d85-SA-session-28453478-life-5m".
 */
export function buildProxyUrl(proxy: ProxyEntry): string {
  const auth = proxy.user && proxy.pass
    ? `${proxy.user}:${proxy.pass}@`
    : "";
  return `http://${auth}${proxy.host}:${proxy.port}`;
}

/**
 * Create an undici ProxyAgent for fetch() requests.
 * Use as `dispatcher` option in fetch().
 */
export async function getRandomProxyAgent(): Promise<{
  agent: ProxyAgent | null;
  proxy: ProxyEntry | null;
}> {
  const proxy = await getRandomPreferredProxy();
  if (!proxy) return { agent: null, proxy: null };
  try {
    const proxyUrl = buildProxyUrl(proxy);
    const agent = new ProxyAgent(proxyUrl);
    return { agent, proxy };
  } catch (err: any) {
    console.error(`[ProxyHelper] Failed to create ProxyAgent for ${proxy.host}:${proxy.port}:`, err.message);
    return { agent: null, proxy: null };
  }
}

/**
 * fetch() with proxy — wraps the standard fetch() to use ONE random proxy.
 *
 * Simplified flow (theo yêu cầu user):
 *   1. Pick 1 random proxy từ pool (preferred US/GB/CA/SG/JP/AU/DE/FR)
 *   2. Send request qua proxy đó
 *   3. Nếu proxy fail (connection error) → retry 1 lần với proxy khác
 *   4. Nếu vẫn fail → throw error (KHÔNG fallback direct fetch — tránh IP server rate-limit)
 *
 * Lý do không fallback direct: Discord đã rate-limit IP server, nếu dùng direct
 * thì sẽ bị block ngay. Thà throw error để user thử lại còn hơn.
 *
 * Usage:
 *   const res = await fetchWithProxy("https://discord.com/api/v9/auth/login", {
 *     method: "POST",
 *     headers: { ... },
 *     body: JSON.stringify({ ... }),
 *   });
 */
export async function fetchWithProxy(
  url: string,
  options: RequestInit = {},
  maxRetries: number = 2,
): Promise<Response> {
  let lastError: Error | null = null;
  // Login thẳng: không có proxy list vẫn phải đăng nhập được. Trước đây pool rỗng
  // là chặn hẳn (throw), nên khi URL proxy mặc định chết thì /login không dùng được.
  // Giờ: có proxy thì đi qua proxy (ưu tiên), không có thì gửi trực tiếp từ IP
  // server. Đặt DISABLE_DIRECT_FALLBACK=1 nếu muốn giữ hành vi cũ (chỉ dùng proxy).
  const allowDirect = process.env.DISABLE_DIRECT_FALLBACK !== "1";

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const { agent, proxy } = await getRandomProxyAgent();
    if (!agent || !proxy) {
      if (!allowDirect) {
        // No proxy available — throw error (don't fallback to direct fetch
        // because Discord has rate-limited the server IP)
        throw new Error("Proxy pool rỗng — không thể gửi request. Vui lòng tải lại proxy list.");
      }
      console.warn("[ProxyHelper] Proxy pool rỗng → gửi trực tiếp từ IP server (login thẳng)");
      const directOptions: any = { ...options };
      directOptions.headersTimeout = 15_000;
      directOptions.bodyTimeout = 15_000;
      return (await undiciFetch(url, directOptions)) as unknown as Response;
    }
    try {
      // Use undici's fetch (NOT global fetch — global fetch doesn't support dispatcher)
      const fetchOptions: any = { ...options };
      fetchOptions.dispatcher = agent;
      // Set timeout 15s để tránh request treo
      fetchOptions.headersTimeout = 15_000;
      fetchOptions.bodyTimeout = 15_000;
      const res = await undiciFetch(url, fetchOptions);
      console.log(`[ProxyHelper] ✓ ${proxy.countryCode || "?"} ${proxy.host}:${proxy.port} → ${res.status}`);
      return res as unknown as Response;
    } catch (err: any) {
      lastError = err;
      console.warn(`[ProxyHelper] ✗ Attempt ${attempt + 1}/${maxRetries} failed (${proxy.countryCode || "?"} ${proxy.host}:${proxy.port}): ${err.message}`);
      // Try next proxy (only 1 more retry)
    }
  }
  // All retries failed — throw error (NOT fallback to direct fetch)
  throw new Error(`Tất cả ${maxRetries} proxy đều fail: ${lastError?.message || "unknown error"}. Vui lòng thử lại sau.`);
}

/**
 * Get a WebSocket URL with proxy — returns the proxy URL for ws library.
 * Returns null if no proxy available.
 *
 * Usage:
 *   const proxyUrl = await getWsProxyUrl();
 *   const ws = new WebSocket(url, {
 *     agent: proxyUrl ? new HttpsProxyAgent(proxyUrl) : undefined,
 *     ...
 *   });
 */
import { HttpsProxyAgent } from "https-proxy-agent";

export async function getWsProxyAgent(): Promise<{
  agent: HttpsProxyAgent<string> | null;
  proxy: ProxyEntry | null;
}> {
  const proxy = await getRandomPreferredProxy();
  if (!proxy) return { agent: null, proxy: null };
  try {
    const proxyUrl = buildProxyUrl(proxy);
    const agent = new HttpsProxyAgent(proxyUrl);
    return { agent, proxy };
  } catch (err: any) {
    console.error(`[ProxyHelper] Failed to create HttpsProxyAgent:`, err.message);
    return { agent: null, proxy: null };
  }
}

// ──────────────────────────────────────────────────
// Sticky proxy per token — MỘT IP cho cả phiên
// ──────────────────────────────────────────────────
/**
 * Vì sao cần: trước đây MỖI request lại bốc 1 proxy ngẫu nhiên, gateway thì
 * nối trực tiếp từ IP Render. Cùng một token vì thế xuất hiện từ hàng chục IP
 * khác nhau trong vài giây → Discord coi là session bị chiếm và thu hồi token
 * (401 / gateway 4004). Giờ mỗi token ghim đúng 1 proxy: login, REST, enroll và
 * gateway đều đi qua cùng một IP cho đến khi proxy đó chết.
 */
export interface StickyProxy {
  proxy: ProxyEntry;
  proxyUrl: string;
  agent: ProxyAgent;
  wsAgent: HttpsProxyAgent<string>;
  since: number;
}

declare global {
  var dqaStickyProxies: Map<string, StickyProxy> | undefined;
}

function stickyMap(): Map<string, StickyProxy> {
  if (!globalThis.dqaStickyProxies) globalThis.dqaStickyProxies = new Map();
  return globalThis.dqaStickyProxies;
}

function makeSticky(proxy: ProxyEntry): StickyProxy {
  const proxyUrl = buildProxyUrl(proxy);
  return {
    proxy,
    proxyUrl,
    agent: new ProxyAgent(proxyUrl),
    wsAgent: new HttpsProxyAgent(proxyUrl),
    since: Date.now(),
  };
}

/** Ghim một proxy cụ thể cho token (dùng sau khi login thành công qua proxy đó). */
export function bindStickyProxy(tokenId: string, proxy: ProxyEntry): StickyProxy {
  const previous = stickyMap().get(tokenId);
  if (previous) {
    try { previous.agent.close(); } catch { /* ignore */ }
  }
  const binding = makeSticky(proxy);
  stickyMap().set(tokenId, binding);
  console.log(
    `[ProxySticky] ${tokenId.slice(0, 12)} ghim ${proxy.countryCode || "?"} ${proxy.host}:${proxy.port}`,
  );
  return binding;
}

/** Lấy proxy đã ghim của token, chưa có thì ghim proxy ngẫu nhiên. */
export async function getStickyProxy(tokenId?: string): Promise<StickyProxy | null> {
  if (!tokenId) return null;
  const existing = stickyMap().get(tokenId);
  if (existing) return existing;
  const proxy = await getRandomPreferredProxy();
  if (!proxy) return null;
  return bindStickyProxy(tokenId, proxy);
}

/** Proxy của token chết → đổi sang proxy KHÁC và ghim lại. */
export async function rotateStickyProxy(tokenId: string): Promise<StickyProxy | null> {
  const old = stickyMap().get(tokenId);
  let previousUrl: string | null = null;
  if (old) {
    previousUrl = old.proxyUrl;
    try { old.agent.close(); } catch { /* ignore */ }
    stickyMap().delete(tokenId);
    console.warn(
      `[ProxySticky] ${tokenId.slice(0, 12)} đổi proxy (${old.proxy.host}:${old.proxy.port} lỗi)`,
    );
  }

  // Đổi sang proxy KHÁC proxy vừa lỗi, nếu pool còn lựa chọn. Bốc lại đúng proxy
  // vừa chết thì coi như không đổi gì.
  const all = await getAllProxies();
  const candidates = all.filter((p) => buildProxyUrl(p) !== previousUrl);

  // Ưu tiên proxy CÙNG NƯỚC với proxy vừa lỗi: token đang ở VN mà bị đẩy sang TH
  // cũng là "đổi nước giữa phiên", đúng thứ Discord coi là phiên bị đánh cắp.
  const prevCountry = (old?.proxy.countryCode || "").toUpperCase();
  const sameCountry = prevCountry
    ? candidates.filter((p) => (p.countryCode || "").toUpperCase() === prevCountry)
    : [];
  const pool = sameCountry.length > 0
    ? sameCountry
    : candidates.length > 0
      ? candidates
      : all;
  const preferred = pool.filter(
    (p) => p.countryCode && PREFERRED_COUNTRIES.includes(p.countryCode.toUpperCase()),
  );
  const pick = (preferred.length > 0 ? preferred : pool)[
    Math.floor(Math.random() * (preferred.length > 0 ? preferred.length : pool.length))
  ];
  if (!pick) return null;
  return bindStickyProxy(tokenId, pick);
}

/** Agent WebSocket (https-proxy-agent) đã ghim cho token — gateway dùng chung IP với REST. */
export async function getStickyWsAgent(tokenId: string): Promise<HttpsProxyAgent<string> | null> {
  const binding = await getStickyProxy(tokenId);
  return binding?.wsAgent ?? null;
}

/**
 * fetch() đi qua proxy đã ghim của token. Proxy lỗi → đổi proxy và thử lại 1 lần,
 * cuối cùng mới gửi trực tiếp để worker không chết giữa chừng.
 */
export async function fetchWithTokenProxy(
  tokenId: string | undefined,
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const allowDirect = process.env.DISABLE_DIRECT_FALLBACK !== "1";

  // Proxy đang bị gateway từ chối (407) → trả lỗi ngay, không mở đường hầm nào.
  const blockedMs = proxyAuthBlockedFor();
  if (blockedMs > 0) {
    throw new Error(
      `Proxy gateway đang từ chối xác thực (407) — tạm dừng gọi proxy ${Math.ceil(blockedMs / 60000)} phút ` +
        `để không đốt traffic. Nạp thêm dung lượng/gói proxy rồi thử lại.`,
    );
  }

  const direct = async () => {
    const directOptions: any = { ...options };
    directOptions.headersTimeout = 15_000;
    directOptions.bodyTimeout = 15_000;
    return (await undiciFetch(url, directOptions)) as unknown as Response;
  };

  if (!tokenId) return direct();

  // Token đã từng login qua proxy thì IP của nó là IP proxy. Gửi trực tiếp từ IP
  // server trong trường hợp này chính là "cùng token, hai IP" → Discord vô hiệu
  // hoá phiên. Thà báo lỗi để worker thử lại sau còn hơn đổi IP.
  const hadBinding = !!(await getStickyProxy(tokenId).catch(() => null));

  for (let attempt = 0; attempt < 3; attempt++) {
    // 2 lần đầu giữ nguyên proxy (lỗi mạng thường là tạm thời), lần 3 mới đổi IP.
    const binding = attempt < 2
      ? await getStickyProxy(tokenId)
      : await rotateStickyProxy(tokenId);
    if (!binding) {
      if (!allowDirect) throw new Error("Proxy pool rỗng — không thể gửi request.");
      return direct();
    }
    try {
      const fetchOptions: any = { ...options };
      fetchOptions.dispatcher = binding.agent;
      fetchOptions.headersTimeout = 15_000;
      fetchOptions.bodyTimeout = 15_000;
      const res = (await undiciFetch(url, fetchOptions)) as unknown as Response;
      addTraffic(
        tokenId,
        typeof fetchOptions.body === "string" ? fetchOptions.body.length : 0,
        Number(res.headers.get("content-length") || 0),
      );
      // 401 có thể do IP proxy hoặc do token. Phân biệt bằng body: Discord luôn
      // trả JSON có "message"/"code"; proxy trả text/HTML (401 auth, hết hạn mức).
      if (res.status === 401) {
        const raw = await res.clone().text().catch(() => "");
        let fromDiscord = false;
        try {
          const parsed = JSON.parse(raw);
          fromDiscord = typeof parsed?.message === "string" || typeof parsed?.code === "number";
        } catch {
          fromDiscord = false;
        }
        console.warn(
          `[ProxySticky] ${tokenId.slice(0, 12)} 401 qua ${binding.proxy.host}:${binding.proxy.port} ` +
            `(${fromDiscord ? "Discord từ chối token" : "lỗi proxy"}) ${raw.slice(0, 120)}`,
        );
        if (attempt === 0) continue; // đổi IP rồi thử lại trước khi kết luận
      }
      noteProxyAuthSuccess();
      return res;
    } catch (err: any) {
      const detail = describeFetchError(err);
      if (detail.includes("407")) noteProxyAuthFailure();
      console.warn(
        `[ProxySticky] ${tokenId.slice(0, 12)} ✗ ${binding.proxy.host}:${binding.proxy.port} — ${detail}`,
      );
    }
  }

  if (!allowDirect || hadBinding) {
    throw new Error("Proxy của token tạm thời không dùng được — giữ nguyên IP, thử lại sau.");
  }
  console.warn(`[ProxySticky] ${tokenId.slice(0, 12)} chưa từng có proxy → gửi trực tiếp từ IP server`);
  return direct();
}
