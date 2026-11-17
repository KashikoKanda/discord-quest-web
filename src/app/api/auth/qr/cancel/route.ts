import { NextRequest, NextResponse } from "next/server";
import { cancelQRSession } from "@/lib/qrAuth";

/**
 * POST /api/auth/qr/cancel
 * Body: { sessionId }
 */
export async function POST(request: NextRequest) {
  try {
    const { sessionId } = await request.json();
    if (!sessionId) {
      return NextResponse.json({ success: false, error: "sessionId is required" }, { status: 400 });
    }
    cancelQRSession(sessionId);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
