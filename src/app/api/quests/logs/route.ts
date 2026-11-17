import { NextRequest, NextResponse } from "next/server";
import { QuestWorker } from "@/lib/questWorker";

/**
 * GET /api/quests/logs?tokenId=xxx
 * Get worker logs for a specific token
 */
export async function GET(request: NextRequest) {
  const tokenId = request.nextUrl.searchParams.get("tokenId") || "main";
  const logs = QuestWorker.getLogs(tokenId);

  return NextResponse.json({
    success: true,
    logs,
  });
}
