import { NextRequest, NextResponse } from "next/server";
import { QuestWorker } from "@/lib/questWorker";

/**
 * POST /api/quests/start
 * Start quest auto-completion for a specific quest or all quests
 * Body: { token, questId?, tokenId?, isVerified?, autoClaim?, multiQuest? }
 *
 * multiQuest: true = làm tất cả quest song song (parallel - như ban đầu)
 *              false = làm từng quest tuần tự cho đến khi hết (single - an toàn hơn)
 */
export async function POST(request: NextRequest) {
  try {
    const { token, questId, tokenId: clientTokenId, isVerified, autoClaim, multiQuest } = await request.json();

    if (!token) {
      return NextResponse.json({ error: "Token required" }, { status: 400 });
    }

    // Block unverified accounts from starting quests
    if (!isVerified) {
      return NextResponse.json({ success: false, message: "Tài khoản chưa xác minh email. Vui lòng xác minh để sử dụng dịch vụ." }, { status: 403 });
    }

    // Use tokenId from client (isolated per token) or generate from token hash
    const tokenId = clientTokenId || `t_${token.slice(0, 16)}`;
    QuestWorker.registerToken(tokenId, token, true, autoClaim ?? true);

    // Truyền multiQuest vào QuestWorker để quyết định chế độ
    // - multiQuest = true → parallel (tất cả cùng lúc)
    // - multiQuest = false → sequential (từng quest cho đến khi hết)
    const result = QuestWorker.startQuests(tokenId, questId, multiQuest !== false);

    return NextResponse.json({
      success: result.started,
      message: result.message,
      tokenId,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
