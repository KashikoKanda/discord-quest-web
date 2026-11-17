import { NextRequest, NextResponse } from "next/server";
import { discordMfaVerify } from "@/lib/authPassword";
import { verifyDiscordToken, initBuildVersion } from "@/lib/discord";

/**
 * POST /api/auth/mfa
 * Body: { ticket, code, method? }     // method: "totp" | "sms"  (default totp)
 *
 * Returns:
 *   { success, state, token?, profile?, error? }
 */
export async function POST(request: NextRequest) {
  try {
    const { ticket, code, method, loginSessionId } = await request.json();

    if (!ticket || !code) {
      return NextResponse.json(
        { success: false, state: "error", error: "Ticket và mã MFA là bắt buộc" },
        { status: 400 },
      );
    }

    initBuildVersion().catch(() => {});

    const result = await discordMfaVerify({
      code: String(code).trim(),
      ticket: String(ticket),
      method: method === "sms" ? "sms" : "totp",
      // Reuse the same UA bundle from the login session (must match the one
      // used in /api/auth/password). Discord rejects MFA if UA changes.
      loginSessionId: loginSessionId || undefined,
    });

    if (!result.ok) {
      return NextResponse.json({
        success: false,
        state: result.state,
        error: result.errorMessage,
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
      console.error("[/api/auth/mfa] Token verify failed:", err.message);
      return NextResponse.json({
        success: false,
        state: "error",
        error: "Token verification failed: " + err.message,
      }, { status: 500 });
    }
  } catch (err: any) {
    console.error("[/api/auth/mfa] Error:", err);
    return NextResponse.json(
      { success: false, state: "error", error: err.message || "Internal error" },
      { status: 500 },
    );
  }
}
