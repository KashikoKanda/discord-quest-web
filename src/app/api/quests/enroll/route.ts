import { NextRequest, NextResponse } from "next/server";
import { QuestWorker } from "@/lib/questWorker";
import { tokenIdOf } from "@/lib/tokenCheck";

/**
 * POST /api/quests/enroll
 * Enroll in a quest
 * Body: { token, questId, tokenId?, isMobile? }
 */
export async function POST(request: NextRequest) {
  try {
    const { token, questId, tokenId: clientTokenId, isMobile } = await request.json();

    if (!token || !questId) {
      return NextResponse.json({ error: "Token and questId required" }, { status: 400 });
    }

    const tokenId = tokenIdOf(token);
    QuestWorker.registerToken(tokenId, token);

    const result = await QuestWorker.enroll(tokenId, questId, isMobile || false);

    return NextResponse.json({
      success: result.enrolled,
      message: result.message,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
