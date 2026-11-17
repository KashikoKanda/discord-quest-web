import { NextRequest, NextResponse } from "next/server";
import { discordPasswordLogin } from "@/lib/authPassword";
import { verifyDiscordToken, initBuildVersion } from "@/lib/discord";

/**
 * POST /api/auth/password
 * Body: {
 *   login, password,
 *   captchaKey?,        // h-captcha-response token
 *   captchaSessionId?,  // Discord session_id from previous captcha_required response
 *   captchaRqtoken?,    // Discord rqtoken from previous captcha_required response
 * }
 *
 * Returns:
 *   { success, state, ... }    // state: "success"|"captcha_required"|"mfa_required"|"sms_required"|"invalid_credentials"|"rate_limited"|"error"
 *
 * On success, returns the verified Discord profile + token so the frontend
 * can log in directly. On captcha_required, returns the hCaptcha sitekey +
 * session_id + rqtoken so the frontend can render the captcha widget AND
 * send those back on the retry attempt (Discord binds the challenge).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { login, password, captchaKey, captchaSessionId, captchaRqtoken, loginSessionId } = body;

    if (!login || !password) {
      return NextResponse.json(
        { success: false, state: "error", error: "Email/số điện thoại và mật khẩu là bắt buộc" },
        { status: 400 },
      );
    }

    // Best-effort: refresh build version
    initBuildVersion().catch(() => {});

    const result = await discordPasswordLogin({
      login: String(login).trim(),
      password: String(password),
      captchaKey: captchaKey || undefined,
      // CRITICAL: pass back the session_id + rqtoken from the previous
      // captcha_required response. Discord binds the captcha challenge to
      // these tokens — without them, the captcha_key is rejected and
      // Discord asks for a new captcha → infinite loop.
      captchaSessionId: captchaSessionId || undefined,
      captchaRqtoken: captchaRqtoken || undefined,
      // Persistent UA per login session — Discord sẽ flag bot nếu 1 login
      // flow đổi UA giữa captcha_required và submit.
      loginSessionId: loginSessionId || undefined,
    });

    if (!result.ok) {
      // Forward state so frontend knows what to do
      return NextResponse.json({
        success: false,
        state: result.state,
        error: result.errorMessage,
        // Captcha info — frontend must keep these and send back on retry
        captchaSitekey: result.captchaSitekey,
        captchaService: result.captchaService,
        captchaRqdata: result.captchaRqdata,
        captchaSessionId: result.captchaSessionId,
        captchaRqtoken: result.captchaRqtoken,
        // MFA info
        mfaTicket: result.mfaTicket,
        // WebAuthn info (security key / passkey)
        webauthnChallenge: result.webauthnChallenge,
        webauthnRpId: result.webauthnRpId,
      }, { status: 400 });
    }

    // Success — verify the token and return profile
    try {
      const profile = await verifyDiscordToken(result.token!);
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
      console.error("[/api/auth/password] Token verify failed:", err.message);
      return NextResponse.json({
        success: false,
        state: "error",
        error: "Token verification failed: " + err.message,
      }, { status: 500 });
    }
  } catch (err: any) {
    console.error("[/api/auth/password] Error:", err);
    return NextResponse.json(
      { success: false, state: "error", error: err.message || "Internal error" },
      { status: 500 },
    );
  }
}
