import { NextRequest, NextResponse } from "next/server";
import { fetchProxyList, getProxyStats, getProxies } from "@/lib/proxyList";
import { getPoolStats } from "@/lib/proxyPool";

/**
 * GET /api/proxy-list
 * Get current proxy list with optional country filter
 * Query params:
 *   - country: Filter by country code (e.g. "VN", "US")
 *   - refresh: If "true", force refresh from GitHub
 *   - stats: If "true", return stats only (no proxy details)
 *   - pool: If "true", include ProxyPool assignment stats
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const country = searchParams.get("country") || undefined;
    const refresh = searchParams.get("refresh") === "true";
    const statsOnly = searchParams.get("stats") === "true";
    const includePool = searchParams.get("pool") === "true";

    if (refresh) {
      await fetchProxyList(true);
    }

    if (statsOnly) {
      const stats = await getProxyStats();
      const poolData = includePool ? getPoolStats() : undefined;
      return NextResponse.json({ success: true, ...stats, ...(poolData ? { pool: poolData } : {}) });
    }

    const proxies = await getProxies(country);
    const stats = await getProxyStats();
    const poolData = includePool ? getPoolStats() : undefined;

    return NextResponse.json({
      success: true,
      proxies: proxies.map(p => ({
        host: p.host,
        port: p.port,
        protocol: p.protocol,
        countryCode: p.countryCode,
        // Don't expose raw credentials in the list view
        hasAuth: !!(p.user && p.pass),
      })),
      ...stats,
      ...(poolData ? { pool: poolData } : {}),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
