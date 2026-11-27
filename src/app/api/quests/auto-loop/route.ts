import { NextRequest, NextResponse } from "next/server";
import { QuestWorker } from "@/lib/questWorker";

/**
 * POST /api/quests/auto-loop
 * Toggle the background auto-quest loop for a token.
 * Body: { tokenId, token, enabled, isVerified }
 *
 * Notes:
 * - Caller MUST verify guild membership on the client before calling this
 *   endpoint with enabled=true. The server only checks isVerified (Discord
 *   email verification) to be a defensive backstop.
 * - If the token hasn't been registered with QuestWorker yet (e.g. user has
 *   never clicked "Bắt đầu"), this endpoint will auto-register it.
 */
export async function POST(request: NextRequest) {
  // CHẶN SERVER CHẠY QUEST/GATEWAY: mọi request mang token phải đi từ trình duyệt
  // (IP nhà). Server mà mở gateway hoặc enroll song song = split-brain IP, Discord
  // revoke ngay. Chỉ bật lại khi thật sự muốn bằng ALLOW_SERVER_QUEST=1.
  if (process.env.ALLOW_SERVER_QUEST !== "1") {
    return NextResponse.json(
      {
        success: false,
        serverDisabled: true,
        error: "Quest chỉ chạy trong trình duyệt từ IP nhà. Server không nhận token nữa.",
      },
      { status: 410 },
    );
  }
  try {
    const { tokenId, token, enabled, isVerified, multiQuest } = await request.json();

    if (!tokenId || !token) {
      return NextResponse.json({ error: "tokenId và token là bắt buộc" }, { status: 400 });
    }
    if (typeof enabled !== "boolean") {
      return NextResponse.json({ error: "enabled phải là boolean" }, { status: 400 });
    }

    if (typeof multiQuest === "boolean") {
      QuestWorker.registerToken(tokenId, token, !!isVerified, true, multiQuest);
      QuestWorker.setMultiQuest(tokenId, multiQuest);
    }

    const result = QuestWorker.setAutoQuest(tokenId, token, enabled, !!isVerified);

    if (!result.success) {
      return NextResponse.json({ success: false, message: result.message }, { status: 403 });
    }

    return NextResponse.json({
      success: true,
      message: result.message,
      autoQuest: QuestWorker.getAutoQuest(tokenId),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

/**
 * GET /api/quests/auto-loop?tokenId=xxx
 * Returns the current auto-quest loop state for a token.
 */
export async function GET(request: NextRequest) {
  try {
    const tokenId = request.nextUrl.searchParams.get("tokenId");
    if (!tokenId) {
      return NextResponse.json({ error: "tokenId required" }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      autoQuest: QuestWorker.getAutoQuest(tokenId),
      workerStatus: QuestWorker.getStatus(tokenId),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
