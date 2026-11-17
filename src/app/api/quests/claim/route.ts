import { NextRequest, NextResponse } from "next/server";
import { QuestWorker } from "@/lib/questWorker";

/**
 * POST /api/quests/claim
 * Claim reward for a completed quest (aiko-style full body)
 * Body: { token, questId, tokenId?, questData? }
 *
 * questData should contain the full quest object so we can extract
 * rewards_config.platforms and traffic_metadata for the claim request.
 */
export async function POST(request: NextRequest) {
  try {
    const {
      token, questId, tokenId: clientTokenId,
      questData,
    } = await request.json();

    if (!token || !questId) {
      return NextResponse.json({ error: "Token and questId required" }, { status: 400 });
    }

    const tokenId = clientTokenId || `t_${token.slice(0, 16)}`;
    QuestWorker.registerToken(tokenId, token);

    const result = await QuestWorker.claimReward(tokenId, questId, questData);

    return NextResponse.json({
      success: result.success,
      message: result.message,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
