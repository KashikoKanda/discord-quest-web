import { NextRequest, NextResponse } from "next/server";
import { getQRSessionState } from "@/lib/qrAuth";
import { verifyDiscordToken, initBuildVersion } from "@/lib/discord";

/**
 * GET /api/auth/qr/poll?sessionId=<id>
 *
 * Returns:
 *   { state: "pending_scan"|"pending_confirm"|"success"|"expired"|"error",
 *     qrImage?, token?, profile?, errorMessage? }
 *
 * When state === "success", the route also verifies the token with Discord
 * and returns the profile (so the frontend can log in immediately).
 */
export async function GET(request: NextRequest) {
  const sessionId = request.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ success: false, error: "sessionId is required" }, { status: 400 });
  }
  const s = getQRSessionState(sessionId);
  if (!s) {
    return NextResponse.json({ success: false, error: "Session not found (expired)" }, { status: 404 });
  }

  // Once we have a token, verify it with Discord and return the profile.
  if (s.state === "success" && s.token) {
    try {
      // Ensure build version is up to date (best-effort)
      initBuildVersion().catch(() => {});
      const profile = await verifyDiscordToken(s.token);
      return NextResponse.json({
        success: true,
        state: "success",
        token: s.token,
        profile: {
          id: profile.id,
          username: profile.username,
          global_name: profile.global_name || null,
          discriminator: profile.discriminator || "0",
          avatar: profile.avatar,
          email: profile.email,
          phone: profile.phone,
          mfa_enabled: profile.mfa_enabled || false,
          flags: profile.public_flags || profile.flags || 0,
          premium_type: profile.premium_type || 0,
          locale: profile.locale || "en-US",
          verified: profile.verified || false,
          banner: profile.banner,
          accent_color: profile.accent_color,
          avatar_decoration: profile.avatar_decoration,
        },
      });
    } catch (err: any) {
      console.error("[/api/auth/qr/poll] Token verify failed:", err.message);
      return NextResponse.json({
        success: false,
        state: "error",
        error: "Token verification failed: " + err.message,
      });
    }
  }

  return NextResponse.json({
    success: true,
    state: s.state,
    qrImage: s.qrImage,
    errorMessage: s.errorMessage,
    logs: s.logs,
  });
}
