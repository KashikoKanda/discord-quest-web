import { NextRequest, NextResponse } from "next/server";
import { QuestWorker } from "@/lib/questWorker";

/**
 * GET /api/quests/status?tokenId=xxx
 * Get worker status and quest progress for a specific token
 */
export async function GET(request: NextRequest) {
  const tokenId = request.nextUrl.searchParams.get("tokenId") || "main";
  const status = QuestWorker.getStatus(tokenId);
  const progress = Object.fromEntries(QuestWorker.getAllQuestProgress(tokenId));

  return NextResponse.json({
    success: true,
    status,
    questProgress: progress,
  });
}
