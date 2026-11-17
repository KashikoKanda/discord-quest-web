import { NextRequest, NextResponse } from "next/server";
import { registerSession, heartbeat, generateSessionId, removeSession } from "@/lib/sessionManager";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, tokenId, sessionId } = body;

    if (!tokenId || typeof tokenId !== "string") {
      return NextResponse.json({ error: "tokenId required" }, { status: 400 });
    }

    const userAgent = request.headers.get("user-agent") || undefined;

    if (action === "register") {
      // Multi-session: luôn cho phép register, không reject.
      const sid = sessionId || generateSessionId();
      registerSession(tokenId, sid, userAgent);
      return NextResponse.json({
        success: true,
        sessionId: sid,
        message: "Session registered (multi-session enabled)",
      });
    }

    if (action === "heartbeat") {
      if (!sessionId) {
        return NextResponse.json({ error: "sessionId required for heartbeat" }, { status: 400 });
      }
      const result = heartbeat(tokenId, sessionId);
      if (!result.ok) {
        // Multi-session: KHÔNG trả về session_evicted nữa.
        // Nếu session_not_found (do server restart), frontend sẽ tự re-register
        // qua API /api/auth/login chứ không bị logout.
        return NextResponse.json({
          success: false,
          reason: result.reason, // "session_not_found"
          message: "Session không tìm thấy — server có thể vừa restart. Frontend sẽ tự re-register.",
        }, { status: 401 });
      }
      return NextResponse.json({ success: true });
    }

    if (action === "logout") {
      if (!sessionId) {
        return NextResponse.json({ error: "sessionId required for logout" }, { status: 400 });
      }
      removeSession(tokenId, sessionId);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
