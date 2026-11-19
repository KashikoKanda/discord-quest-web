import { NextRequest, NextResponse } from "next/server";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { getAllProxies, buildProxyUrl, describeFetchError } from "@/lib/proxyHelper";

/**
 * GET /api/proxy-list/test?country=VN&limit=5
 *
 * Thử thật từng proxy trong pool: mở CONNECT qua proxy rồi gọi
 * https://discord.com/api/v9/gateway (endpoint công khai, không cần token).
 *
 * Dùng để trả lời câu "proxy chết hay Discord chặn?" mà không phải đoán:
 *   - ok: true, status 200        → proxy sống, đi được tới Discord
 *   - ok: false, error: ...cause  → proxy/gateway chết, kèm mã lỗi thật
 *   - ok: false, status 401/403   → gateway từ chối auth (sai user/pass, hết hạn mức)
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const country = (searchParams.get("country") || "").toUpperCase();
  const limit = Math.min(Number(searchParams.get("limit") || 5), 20);

  const all = await getAllProxies();
  const picked = (country
    ? all.filter((p) => (p.countryCode || "").toUpperCase() === country)
    : all
  ).slice(0, limit);

  if (picked.length === 0) {
    return NextResponse.json({
      success: false,
      error: country ? `Pool không có proxy ${country}` : "Pool rỗng",
      totalInPool: all.length,
    });
  }

  const results = await Promise.all(
    picked.map(async (proxy) => {
      const started = Date.now();
      const agent = new ProxyAgent({ uri: buildProxyUrl(proxy), requestTls: { rejectUnauthorized: false } });
      try {
        const res = await undiciFetch("https://discord.com/api/v9/gateway", {
          dispatcher: agent,
          headers: { "User-Agent": "DiscordBot (https://discord.com, 1.0)" },
          headersTimeout: 10_000,
          bodyTimeout: 10_000,
          signal: AbortSignal.timeout(12_000),
        } as never);
        const body = await res.text().catch(() => "");
        return {
          proxy: `${proxy.host}:${proxy.port}`,
          country: proxy.countryCode || null,
          ok: res.ok,
          status: res.status,
          ms: Date.now() - started,
          error: res.ok ? null : body.slice(0, 120),
        };
      } catch (err: unknown) {
        return {
          proxy: `${proxy.host}:${proxy.port}`,
          country: proxy.countryCode || null,
          ok: false,
          status: null,
          ms: Date.now() - started,
          error: describeFetchError(err),
        };
      } finally {
        await agent.close().catch(() => {});
      }
    }),
  );

  const alive = results.filter((r) => r.ok).length;
  return NextResponse.json({
    success: true,
    summary: {
      tested: results.length,
      alive,
      dead: results.length - alive,
      totalInPool: all.length,
      country: country || "ALL",
    },
    results,
  });
}
