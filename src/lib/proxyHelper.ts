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
