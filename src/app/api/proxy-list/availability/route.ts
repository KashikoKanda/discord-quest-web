import { NextRequest, NextResponse } from "next/server";
import { checkAvailability } from "@/lib/proxyPool";

/**
 * GET /api/proxy-list/availability?countries=US,JP,DE&tokenId=xxx
 *
 * Check proxy availability for multiple countries at once.
 * Returns per-country status:
 *   - "available" → còn SID trống, nút hiện "Nhận Quest Ẩn"
 *   - "full" → hết SID, nút hiện "Hãy quay lại sau ít phút"
 *   - "no_proxy" → không có proxy, nút hiện "Chưa thể nhận"
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const countriesParam = searchParams.get("countries") || "";
    const tokenId = searchParams.get("tokenId") || undefined;

    if (!countriesParam) {
      return NextResponse.json({ error: "Thiếu tham số countries" }, { status: 400 });
    }

    const countries = countriesParam.split(",").map(c => c.trim()).filter(Boolean);
    const results: Record<string, { status: string; freeSlots: number; totalSlots: number }> = {};

    // Check availability for each country in parallel
    await Promise.all(
      countries.map(async (cc) => {
        const avail = await checkAvailability(cc, tokenId);
        results[cc.toUpperCase()] = {
          status: avail.status,
          freeSlots: avail.freeSlots,
          totalSlots: avail.totalSlots,
        };
      })
    );

    return NextResponse.json({ success: true, availability: results });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
