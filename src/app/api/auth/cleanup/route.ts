import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { discordFetch, isTokenExpiredResponse } from "@/lib/discord";
import { releaseAllForToken } from "@/lib/proxyPool";
import { QuestWorker } from "@/lib/questWorker";
import { checkDiscordToken } from "@/lib/tokenCheck";
import { rotateStickyProxy } from "@/lib/proxyHelper";

/**
 * POST /api/auth/cleanup
 *
 * Two modes:
 * 1. { tokenId, immediate: true } — Called on frontend logout.
 *    Releases proxy SIDs + removes QuestWorker for this token immediately.
 *
 * 2. No body — Cron job mode: check all tokens in DB, delete expired ones.
 */
export async function POST(request: NextRequest) {
  try {
    let body: any = {};
    try {
      body = await request.json();
    } catch {
      // No body — cron job mode
    }

    // ── Immediate mode: frontend logout ──
    if (body.tokenId && body.immediate) {
      const { tokenId } = body;
      console.log(`[Cleanup] Immediate cleanup for token ${tokenId.slice(0, 12)}...`);

      // Release all proxy SIDs assigned to this token
      releaseAllForToken(tokenId);

      // Remove token from QuestWorker (stops quests, clears intervals)
      await QuestWorker.removeToken(tokenId);

      console.log(`[Cleanup] Released proxy SIDs + QuestWorker for ${tokenId.slice(0, 12)}`);
      return NextResponse.json({ success: true, message: "Resources released" });
    }

    // ── Cron job mode: check all DB tokens ──
    const tokens = await db.discordToken.findMany({
      select: { id: true, token: true, userId: true, username: true },
    });

    if (tokens.length === 0) {
      return NextResponse.json({ message: "No tokens to check", checked: 0, deleted: 0 });
    }

    let deleted = 0;
    let alive = 0;

    for (const row of tokens) {
      try {
        const res = await discordFetch(
          row.token,
          "/users/@me",
          {},
          `t_${String(row.token).slice(0, 16)}`,
        );

        if (isTokenExpiredResponse(res)) {
          // Xác nhận trực tiếp trước khi xoá: 401 qua proxy có thể do IP proxy,
          // không phải token chết.
          const verdict = await checkDiscordToken(row.token);
          if (verdict.kind === "user") {
            await rotateStickyProxy(`t_${String(row.token).slice(0, 16)}`);
            alive++;
            console.warn(`[Cleanup] Token ${row.id} vẫn sống, chỉ đổi proxy`);
            continue;
          }
          await db.discordToken.delete({ where: { id: row.id } });
          deleted++;
          console.log(`[Cleanup] Deleted expired token: ${row.username || row.userId || row.id}`);
        } else {
          await db.discordToken.update({
            where: { id: row.id },
            data: { lastOnline: new Date(), status: "idle" },
          });
          alive++;
        }
      } catch {
        console.warn(`[Cleanup] Could not check token ${row.id}, skipping`);
      }

      await new Promise((r) => setTimeout(r, 500));
    }

    console.log(`[Cleanup] Checked ${tokens.length} tokens: ${alive} alive, ${deleted} deleted`);
    return NextResponse.json({ checked: tokens.length, alive, deleted });
  } catch (err) {
    console.error("[Cleanup] Error:", err);
    return NextResponse.json({ error: "Cleanup failed" }, { status: 500 });
  }
}
