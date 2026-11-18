import { NextRequest, NextResponse } from "next/server";
import { submitQRCaptcha } from "@/lib/qrAuth";
import { verifyDiscordToken, initBuildVersion } from "@/lib/discord";

/**
 * POST /api/auth/qr/captcha
 * Body: { sessionId: string, captchaToken: string }
 *
 * Discord sometimes answers the ticket exchange with captcha-required. The user
 * solves hCaptcha in the browser and the solved token comes back here; we retry
 * the exchange with it and return the profile on success.
 */
export async function POST(request: NextRequest) {
  let body: { sessionId?: string; captchaToken?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const sessionId = String(body.sessionId || "").trim();
  const captchaToken = String(body.captchaToken || "").trim();
  if (!sessionId || !captchaToken) {
    return NextResponse.json(
      { success: false, error: "sessionId và captchaToken là bắt buộc" },
      { status: 400 },
    );
  }

  const result = await submitQRCaptcha(sessionId, captchaToken);

  if (!result.ok) {
    // Another challenge → hand the fresh sitekey/rqdata back to the browser.
    if (result.captcha) {
      return NextResponse.json({
        success: false,
        state: "captcha_required",
        captcha: result.captcha,
        error: "Discord chưa chấp nhận captcha — giải lại giúp mình",
      });
    }
    return NextResponse.json({
      success: false,
      state: "error",
      error: result.error || "Captcha thất bại",
    });
  }

  try {
    initBuildVersion().catch(() => {});
    const profile = await verifyDiscordToken(result.token);
    return NextResponse.json({
      success: true,
      state: "success",
      token: result.token,
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
    console.error("[/api/auth/qr/captcha] Token verify failed:", err.message);
    return NextResponse.json({
      success: false,
      state: "error",
      error: "Đã lấy được token nhưng xác minh thất bại: " + err.message,
    });
  }
}
