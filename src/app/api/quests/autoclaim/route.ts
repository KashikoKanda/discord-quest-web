import { NextRequest, NextResponse } from "next/server";
import { QuestWorker } from "@/lib/questWorker";

/**
 * POST /api/quests/autoclaim
 * Toggle auto-claim for a token
 * Body: { tokenId, enabled, isVerified? }
 */
export async function POST(request: NextRequest) {
  try {
    const { tokenId, enabled, isVerified } = await request.json();

    if (!tokenId) {
      return NextResponse.json({ error: "tokenId required" }, { status: 400 });
    }

    // Nếu chuyển sang verified, cập nhật trạng thái verified cho worker
    if (isVerified !== undefined) {
      const state = QuestWorker.getState(tokenId);
      if (state) {
        state.isVerified = isVerified;
      }
    }

    const result = QuestWorker.setAutoClaim(tokenId, enabled);

    return NextResponse.json({
      success: result.success,
      message: result.message,
      autoClaim: QuestWorker.getAutoClaim(tokenId),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * GET /api/quests/autoclaim?tokenId=xxx
 * Get auto-claim status for a token
 */
export async function GET(request: NextRequest) {
  try {
    const tokenId = request.nextUrl.searchParams.get("tokenId");
    if (!tokenId) {
      return NextResponse.json({ error: "tokenId required" }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      autoClaim: QuestWorker.getAutoClaim(tokenId),
      isVerified: QuestWorker.getVerified(tokenId),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
