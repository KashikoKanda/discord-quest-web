import { NextRequest, NextResponse } from "next/server";
import { QuestWorker } from "@/lib/questWorker";

/**
 * POST /api/quests/stop
 * Stop quest processing
 * Body: { questId?, tokenId? }
 */
export async function POST(request: NextRequest) {
  try {
    const { questId, tokenId } = await request.json();

    const tid = tokenId || "main";
    const result = QuestWorker.stopQuests(tid, questId);

    return NextResponse.json({
      success: result.stopped,
      message: result.message,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
