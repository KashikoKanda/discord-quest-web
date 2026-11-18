/**
 * Xác định quốc gia của người dùng đang login (dựa trên IP thật của request).
 *
 * Vì sao cần: token MỚI tạo ra ở Việt Nam rồi vài giây sau bị dùng từ một IP
 * proxy ở Canada/Mỹ là kiểu "session bị đánh cắp" — Discord thu hồi ngay. Token
 * cũ sống được vì phiên của nó đã có lịch sử. Vì vậy khi login phải chọn proxy
 * CÙNG QUỐC GIA với người dùng nếu pool có.
 */

const CACHE_TTL_MS = 30 * 60 * 1000;
const cache = new Map<string, { cc: string | null; at: number }>();

/** Lấy IP client từ header của Render/proxy. */
export function getClientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip") || headers.get("cf-connecting-ip") || null;
}

function isPrivate(ip: string): boolean {
  return (
    !ip ||
    ip === "::1" ||
    ip.startsWith("10.") ||
    ip.startsWith("127.") ||
    ip.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  );
}

/** Quốc gia của IP client — null nếu không xác định được (không chặn login). */
export async function getClientCountry(headers: Headers): Promise<string | null> {
  const headerCc =
    headers.get("cf-ipcountry") ||
    headers.get("x-vercel-ip-country") ||
    headers.get("x-country-code");
  if (headerCc && headerCc.length === 2) return headerCc.toUpperCase();

  const ip = getClientIp(headers);
  if (!ip || isPrivate(ip)) return null;

  const hit = cache.get(ip);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.cc;

  let cc: string | null = null;
  try {
    const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country_code`, {
      signal: AbortSignal.timeout(2500),
    });
    if (res.ok) {
      const data = (await res.json()) as { success?: boolean; country_code?: string };
      if (data.success !== false && data.country_code) cc = data.country_code.toUpperCase();
    }
  } catch {
    cc = null;
  }

  cache.set(ip, { cc, at: Date.now() });
  return cc;
}
