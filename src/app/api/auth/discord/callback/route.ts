import { NextRequest, NextResponse } from "next/server";

/**
 * GET /api/auth/discord/callback
 * Đổi code → access token, đăng ký phiên qua /api/auth/login rồi trả token cho SPA
 * bằng cookie ngắn hạn (không đặt token lên URL).
 */
export async function GET(request: NextRequest) {
  const base = process.env.BASE_URL || new URL(request.url).origin;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const clientSecret = process.env.DISCORD_CLIENT_SECRET;
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expected = request.cookies.get("dqa_oauth_state")?.value;

  const fail = (msg: string) =>
    NextResponse.redirect(`${base}/?discord_error=${encodeURIComponent(msg)}`);

  if (!clientId || !clientSecret) return fail("Đăng nhập Discord chưa được cấu hình.");
  if (!code) return fail("Discord không trả mã uỷ quyền.");
  if (!state || !expected || state !== expected) return fail("Phiên uỷ quyền không hợp lệ.");

  let accessToken = "";
  try {
    const body = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: `${base}/api/auth/discord/callback`,
    });
    const tokenRes = await fetch("https://discord.com/api/v10/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    const tokenJson: any = await tokenRes.json();
    accessToken = tokenJson?.access_token || "";
    if (!tokenRes.ok || !accessToken) {
      return fail(tokenJson?.error_description || "Không đổi được mã uỷ quyền.");
    }
  } catch {
    return fail("Không gọi được Discord.");
  }

  // Ghi log để biết token OAuth có quyền gọi API quest hay không.
  try {
    const probe = await fetch("https://discord.com/api/v10/quests/@me", {
      headers: { Authorization: accessToken },
    });
    console.log(`[DiscordOAuth] quests probe: ${probe.status}`);
  } catch {
    /* bỏ qua */
  }

  try {
    const loginRes = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: accessToken }),
    });
    const data: any = await loginRes.json();
    if (!data?.success) {
      return fail(data?.error || "Không tạo được phiên đăng nhập.");
    }
  } catch {
    return fail("Không tạo được phiên đăng nhập.");
  }

  const res = NextResponse.redirect(`${base}/?discord_login=1`);
  res.cookies.set("dqa_oauth_state", "", { maxAge: 0, path: "/" });
  res.cookies.set("dqa_oauth_token", accessToken, {
    httpOnly: true,
    maxAge: 120,
    path: "/",
    sameSite: "lax",
    secure: true,
  });
  return res;
}
