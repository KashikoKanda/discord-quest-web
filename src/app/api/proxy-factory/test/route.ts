import { NextRequest, NextResponse } from "next/server";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { getOrCreateProxy, getFactoryStats } from "@/lib/proxyFactory";

/**
 * GET /api/proxy-factory/test?uid=u1&country=VN
 * Kiểm tra cơ chế tạo proxy theo quốc gia:
 *  - gọi 2 lần liên tiếp cho cùng uid+country → phải trả CÙNG một proxy (dùng lại)
 *  - uid khác → proxy khác
 *  - đo luôn một request thật tới Discord qua proxy đó
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function probe(proxyUrl: string) {
  const started = Date.now();
  let exit: Record<string, unknown> | null = null;
  const agent = new ProxyAgent({ uri: proxyUrl, requestTls: { rejectUnauthorized: false } });
  try {
    // Đo luôn IP thoát thật + ASN để biết proxy có phải dân dụng không
    try {
      const ipRes = await undiciFetch("https://ipwho.is/", { dispatcher: agent, signal: AbortSignal.timeout(10_000) } as never);
      const ipInfo: any = await ipRes.json().catch(() => null);
      if (ipInfo?.success !== false) {
        exit = {
          ip: ipInfo?.ip ?? null,
          country: ipInfo?.country_code ?? null,
          city: ipInfo?.city ?? null,
          asn: ipInfo?.connection?.asn ?? null,
          org: ipInfo?.connection?.org ?? null,
          isp: ipInfo?.connection?.isp ?? null,
          type: ipInfo?.type ?? null,
        };
      }
    } catch { /* đo IP lỗi thì bỏ, không ảnh hưởng probe */ }

    const res = await undiciFetch("https://discord.com/api/v9/gateway", {
      dispatcher: agent,
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/138.0.0.0" },
      signal: AbortSignal.timeout(12_000),
    } as never);
    return { ok: res.ok, status: res.status, ms: Date.now() - started, exit };
  } catch (err) {
    return { ok: false, status: null, ms: Date.now() - started, exit, error: (err instanceof Error ? err.message : String(err)).slice(0, 120) };
  } finally {
    await agent.close().catch(() => {});
  }
}

export async function GET(request: NextRequest) {
  const uid = request.nextUrl.searchParams.get("uid") || "test-uid";
  const country = (request.nextUrl.searchParams.get("country") || "VN").toUpperCase();

  const first = await getOrCreateProxy(uid, country);
  const second = await getOrCreateProxy(uid, country);
  const other = uid.endsWith("-other") ? null : await getOrCreateProxy(`${uid}-other`, country);

  if (!first) {
    return NextResponse.json({ success: false, error: "Không tạo được proxy", stats: getFactoryStats() }, { status: 502 });
  }
  const sameProxy = !!second && second.entry.user === first.entry.user;
  const differentUid = !!other && other.entry.user !== first.entry.user;
  const probeResult = await probe(first.entry.proxyUrl);

  return NextResponse.json({
    success: true,
    country,
    uid,
    reuse: { sameProxy },
    perUid: { differentUid, otherUser: other?.entry.user.slice(-14) ?? null },
    proxy: { host: first.entry.host, port: first.entry.port, user: first.entry.user.slice(-14) },
    probe: probeResult,
    stats: getFactoryStats(),
  });
}
