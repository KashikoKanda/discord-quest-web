import { readFileSync } from "fs";

/**
 * Proxy List Manager
 * Fetches proxy list from GitHub raw URL, caches it, and provides
 * lookup by country code.
 *
 * Supports two formats from GitHub:
 *
 * 1. JSON format (recommended):
 *   {
 *     "proxies": [
 *       "https://change4.owlproxy.com:7778:63SVyYQi6eA0_custom_zone_IT_st__city_sid_71505226_time_5:2182838"
 *     ]
 *   }
 *
 * 2. Plain text format (one proxy per line):
 *   https://host:port:username:password
 *
 * The username contains zone info like "zone_IT" which indicates the country code.
 */

// ──────────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────────

/**
 * Nguồn danh sách proxy.
 *
 * URL mặc định cũ trỏ vào tài khoản GitHub Kandagawa — tài khoản đó đã bị ban nên
 * repo không còn truy cập được (404). Không hardcode host nào nữa; thứ tự lấy:
 *
 *   1. PROXY_LIST_URL   — URL bất kỳ (raw GitHub mới, gist, S3, chính app này...)
 *   2. PROXY_LIST_FILE  — file JSON/plain text trên máy (mặc định ./proxy.json)
 *   3. PROXY_LIST       — dán thẳng danh sách vào biến môi trường, mỗi dòng 1 proxy
 */
type ProxySource = { kind: "url"; value: string } | { kind: "file"; value: string } | { kind: "inline"; value: string };

const DEFAULT_PROXY_FILE = "proxy.json";

export function getProxySource(): ProxySource | null {
  const url = process.env.PROXY_LIST_URL?.trim();
  if (url) return { kind: "url", value: url };

  const inline = process.env.PROXY_LIST?.trim();
  if (inline) return { kind: "inline", value: inline };

  const file = process.env.PROXY_LIST_FILE?.trim() || DEFAULT_PROXY_FILE;
  try {
    // Chỉ dùng file khi nó thực sự tồn tại
    if (readFileSync(file, "utf8").length >= 0) return { kind: "file", value: file };
  } catch {
    // không có file → không có nguồn
  }

  return null;
}

// ──────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────

export interface ProxyEntry {
  /** Original raw line from the proxy list */
  raw: string;
  /** Protocol (https, http, socks5) */
  protocol: string;
  /** Proxy host */
  host: string;
  /** Proxy port */
  port: number;
  /** Username for authentication */
  user: string;
  /** Password for authentication */
  pass: string;
  /** Country code extracted from zone_XX in username, or null */
  countryCode: string | null;
  /** Standard proxy URL: protocol://user:pass@host:port */
  proxyUrl: string;
}

// ──────────────────────────────────────────────────
// Country code aliases — UK ↔ GB là cùng 1 quốc gia
// ──────────────────────────────────────────────────

const CC_ALIASES: Record<string, string[]> = {
  UK: ["GB"],
  GB: ["UK"],
};

// ──────────────────────────────────────────────────
// Parsing
// ──────────────────────────────────────────────────

/**
 * Parse a proxy line in format: protocol://host:port:user:pass
 * Also supports: host:port:user:pass (defaults to https)
 */
export function parseProxyLine(line: string): ProxyEntry | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null; // Skip empty lines and comments

  let protocol = "https";
  let remaining = trimmed;

  // Extract protocol if present
  const protoMatch = trimmed.match(/^([a-z0-9]+):\/\//);
  if (protoMatch) {
    protocol = protoMatch[1].toLowerCase();
    remaining = trimmed.slice(protoMatch[0].length);
  }

  // Split by colon: host:port:user:pass
  // But user/pass may contain special characters (underscores, hyphens, etc.)
  // Format: host:port:user:pass
  // We split from the right to handle user:pass that might contain colons
  // Actually, the format is: host:port:user:pass where each field is separated by :
  // But the "pass" is the last field and "user" might contain underscores

  const parts = remaining.split(":");
  if (parts.length < 4) return null;

  const host = parts[0];
  const port = parseInt(parts[1], 10);
  if (!host || isNaN(port) || port <= 0 || port > 65535) return null;

  // The "user" and "pass" are the remaining parts
  // If there are more than 4 parts, the user might contain colons (unlikely but handle it)
  // Standard: parts[2] = user, parts[3] = pass
  // If more parts, user = parts.slice(2, -1).join(":"), pass = last part
  // But typically it's exactly 4 parts after protocol removal
  const pass = parts[parts.length - 1];
  const user = parts.slice(2, -1).join(":");

  if (!user || !pass) return null;

  // Extract country code from username — supports 2 formats:
  //   Old: zone_XX          (e.g. zone_IT_st__city_sid_...)
  //   New: -XX-session-     (e.g. 8320967-b1cb285d85-BE-session-74193960-life-5m)
  const zoneMatch = user.match(/zone_([A-Z]{2})/i);
  const sessionMatch = user.match(/-([A-Z]{2})-session-/i);
  const rawCC = zoneMatch?.[1] || sessionMatch?.[1] || null;
  const countryCode = rawCC ? rawCC.toUpperCase() : null;

  // Gate owlproxy (gate-xx.owlproxy.com:1000) chỉ nhận HTTP thường, TLS trên
  // port đó không tồn tại → list có ghi https:// thì vẫn hạ về http://.
  const effectiveProtocol = /owlproxy\.com$/i.test(host) && protocol === "https" ? "http" : protocol;

  // Build standard proxy URL: protocol://user:pass@host:port
  const proxyUrl = `${effectiveProtocol}://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`;

  return {
    raw: trimmed,
    protocol: effectiveProtocol,
    host,
    port,
    user,
    pass,
    countryCode,
    proxyUrl,
  };
}

// ──────────────────────────────────────────────────
// Caching & Fetching
// ──────────────────────────────────────────────────

let cachedProxies: ProxyEntry[] = [];
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetch proxy list from GitHub and parse it
 * Results are cached for 5 minutes
 */
export async function fetchProxyList(forceRefresh = false): Promise<ProxyEntry[]> {
  const now = Date.now();
  if (!forceRefresh && cachedProxies.length > 0 && now - cacheTimestamp < CACHE_TTL) {
    return cachedProxies;
  }

  const source = getProxySource();
  if (!source) {
    console.warn("[ProxyList] Chưa cấu hình nguồn proxy (PROXY_LIST_URL / PROXY_LIST_FILE / PROXY_LIST) — bỏ qua danh sách chung");
    return cachedProxies;
  }

  console.log(`[ProxyList] Loading proxy list from ${source.kind}: ${source.kind === "url" ? source.value : "(local)"}`);

  try {
    let text: string;

    if (source.kind === "url") {
      const res = await fetch(source.value, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Accept": "text/plain",
        },
        signal: AbortSignal.timeout(15000), // 15s timeout
      });

      if (!res.ok) {
        console.error(`[ProxyList] Failed to fetch: ${res.status} ${res.statusText}`);
        return cachedProxies;
      }

      text = await res.text();
    } else if (source.kind === "file") {
      text = readFileSync(source.value, "utf8");
    } else {
      text = source.value;
    }

  // Try JSON format first: { "proxies": ["protocol://host:port:user:pass", ...] }
  let proxyLines: string[] = [];
  try {
    const json = JSON.parse(text);
    if (json && Array.isArray(json.proxies)) {
      proxyLines = json.proxies.map((p: unknown) => typeof p === "string" ? p : "");
      console.log(`[ProxyList] Detected JSON format with ${proxyLines.length} entries`);
    }
  } catch {
    // Not JSON — treat as plain text (one proxy per line)
    proxyLines = text.split(/\r?\n/);
    console.log(`[ProxyList] Detected plain text format with ${proxyLines.length} lines`);
  }

  const proxies: ProxyEntry[] = [];
  for (const line of proxyLines) {
    const entry = parseProxyLine(line);
    if (entry) {
      proxies.push(entry);
    }
  }

  if (proxies.length === 0) {
    console.warn("[ProxyList] No valid proxies found in the list");
    return cachedProxies;
  }

  cachedProxies = proxies;
  cacheTimestamp = now;
  console.log(`[ProxyList] Loaded ${proxies.length} proxies, countries: ${[...new Set(proxies.map(p => p.countryCode).filter(Boolean))].join(", ")}`);

  return proxies;
  } catch (err) {
    console.error("[ProxyList] Error loading proxy list:", err instanceof Error ? err.message : String(err));
    return cachedProxies;
  }
}

/**
 * Find all proxies matching a country code
 * Returns array of matching proxies (exact match first, then case-insensitive, then all)
 */
export async function findProxies(countryCode: string): Promise<ProxyEntry[]> {
  const proxies = await fetchProxyList();

  if (proxies.length === 0) return [];

  const cc = countryCode.toUpperCase();
  // Tìm proxy cho quốc gia + các alias (UK↔GB)
  const codes = [cc, ...(CC_ALIASES[cc] || [])];
  const matched = proxies.filter(p => p.countryCode && codes.includes(p.countryCode.toUpperCase()));
  if (matched.length > 0) return matched;

  // Không có proxy cho quốc gia này → trả về rỗng (không fallback)
  // Nếu fallback trả tất cả proxy, checkAvailability sẽ tưởng có proxy cho quốc gia đó
  return [];
}

/**
 * Find a random proxy by country code
 * Randomly selects one proxy from all matching proxies of that country
 * If no match found, randomly selects from all available proxies
 */
export async function findProxy(countryCode: string): Promise<ProxyEntry | null> {
  const matching = await findProxies(countryCode);

  if (matching.length === 0) {
    console.warn("[ProxyList] No proxies available");
    return null;
  }

  // Random pick from matching proxies
  const idx = Math.floor(Math.random() * matching.length);
  const picked = matching[idx];
  console.log(`[ProxyList] Random proxy for ${countryCode}: ${picked.host}:${picked.port} (${picked.countryCode || "unknown"}) [${idx + 1}/${matching.length}]`);
  return picked;
}

/**
 * Get current proxy list stats (for API)
 * NOTE: URL is intentionally hidden to prevent link leakage.
 */
export async function getProxyStats(): Promise<{
  total: number;
  countries: string[];
  lastFetch: string;
  nextFetch: string;
}> {
  const proxies = await fetchProxyList();
  const countries = [...new Set(proxies.map(p => p.countryCode).filter(Boolean) as string[])].sort();

  return {
    total: proxies.length,
    countries,
    lastFetch: cacheTimestamp ? new Date(cacheTimestamp).toISOString() : "never",
    nextFetch: cacheTimestamp ? new Date(cacheTimestamp + CACHE_TTL).toISOString() : "now",
  };
}

/**
 * Get all proxies with optional country filter (for API)
 */
export async function getProxies(countryCode?: string): Promise<ProxyEntry[]> {
  const proxies = await fetchProxyList();
  if (!countryCode) return proxies;
  const cc = countryCode.toUpperCase();
  const codes = [cc, ...(CC_ALIASES[cc] || [])];
  return proxies.filter(p => p.countryCode && codes.includes(p.countryCode.toUpperCase()));
}
