import { NextResponse } from "next/server";
import { startQRSession } from "@/lib/qrAuth";

/**
 * POST /api/auth/qr/start
 * Body: (none)
 *
 * Returns:
 *   { sessionId, state, qrImage }   // qrImage is data:image/png;base64,...
 */
export async function POST() {
  try {
    const result = await startQRSession();
    return NextResponse.json({
      success: true,
      sessionId: result.sessionId,
      state: result.state,
      qrImage: result.qrImage,
      publicKeyB64: result.publicKeyB64,
    });
  } catch (err: any) {
    console.error("[/api/auth/qr/start] Error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to start QR session" },
      { status: 500 },
    );
  }
}
