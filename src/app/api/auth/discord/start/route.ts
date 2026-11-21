import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

/**
 * GET /api/auth/discord/start
 * Bắt đầu luồng "Đăng nhập với Discord" (OAuth2 authorization code).
 * Cần DISCORD_CLIENT_ID + DISCORD_CLIENT_SECRET trong env của Render.
 */
export async function GET(request: NextRequest) {
  const clientId = process.env.DISCORD_CLIENT_ID;
  const base = process.env.BASE_URL || new URL(request.url).origin;
  if (!clientId) {
    return NextResponse.json(
      { success: false, error: "Đăng nhập Discord chưa được cấu hình." },
      { status: 503 },
    );
  }
  const state = crypto.randomUUID();
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", `${base}/api/auth/discord/callback`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "identify");
  url.searchParams.set("state", state);
  url.searchParams.set("prompt", "consent");

  const res = NextResponse.redirect(url.toString());
  res.cookies.set("dqa_oauth_state", state, {
    httpOnly: true,
    maxAge: 600,
    path: "/",
    sameSite: "lax",
    secure: true,
  });
  return res;
}
