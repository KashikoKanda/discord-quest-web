import { NextRequest, NextResponse } from "next/server";
import { discordFetch, isTokenExpiredResponse } from "@/lib/discord";
import { db } from "@/lib/db";
import { normalizeToken } from "@/lib/tokenCheck";

/**
 * POST /api/auth/check
 * Verify if a Discord token is still alive.
 * If expired → delete from DB + return 401 so frontend can clear localStorage.
 */
export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json();

    if (!token || typeof token !== "string") {
      return NextResponse.json({ error: "Token required" }, { status: 400 });
    }

    // Đi qua proxy đã ghim của token: gọi trực tiếp từ IP Render trong khi phiên
    // đang chạy qua proxy khiến Discord trả 401 và web xoá token oan ("bị thu hồi").
    const cleanToken = normalizeToken(token);
    const tokenId = `t_${cleanToken.slice(0, 16)}`;
    const res = await discordFetch(cleanToken, "/users/@me", {}, tokenId);

    if (isTokenExpiredResponse(res)) {
      // Token dead — clean up DB
      try {
        const deleted = await db.discordToken.deleteMany({
          where: { token: token.trim() },
        });
        if (deleted.count > 0) {
          console.log(`[Auth Check] Deleted expired token from DB (${deleted.count} row)`);
        }
      } catch {
        // DB cleanup failure is non-critical
      }

      return NextResponse.json(
        { alive: false, error: "Token hết hạn", tokenExpired: true },
        { status: 401 }
      );
    }

    // Token alive — update lastOnline in DB
    try {
      const profile = await res.json();
      await db.discordToken.updateMany({
        where: { token: token.trim() },
        data: { lastOnline: new Date(), status: "idle" },
      });
      return NextResponse.json({ alive: true, userId: profile.id });
    } catch {
      // Profile parse error but token is alive
      return NextResponse.json({ alive: true });
    }
  } catch {
    return NextResponse.json({ error: "Check failed" }, { status: 500 });
  }
}
