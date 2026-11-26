import { NextRequest, NextResponse } from "next/server";
import { QuestWorker } from "@/lib/questWorker";
import { tokenIdOf } from "@/lib/tokenCheck";

/**
 * POST /api/quests/enroll
 * Enroll in a quest
 * Body: { token, questId, tokenId?, isMobile? }
 */
export async function POST(request: NextRequest) {
  // Toàn bộ web chạy ở mạng nhà: route này không còn được dùng, trả lỗi rõ
  // ràng thay vì âm thầm gửi request mang token qua proxy/IP Render.
  return NextResponse.json({ success: false, movedToBrowser: true, error: "Nhận quest giờ chạy trong trình duyệt (IP mạng nhà)." }, { status: 410 });

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
