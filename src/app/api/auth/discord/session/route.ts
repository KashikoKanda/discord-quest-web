import { NextRequest, NextResponse } from "next/server";

/** GET /api/auth/discord/session — trả token + profile một lần cho SPA sau OAuth. */
export async function GET(request: NextRequest) {
  const token = request.cookies.get("dqa_oauth_token")?.value;
  if (!token) {
    return NextResponse.json(
      { success: false, error: "Phiên Discord đã hết hạn, thử lại." },
      { status: 400 },
    );
  }
  try {
    const r = await fetch("https://discord.com/api/v10/users/@me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!r.ok) {
      return NextResponse.json(
        { success: false, error: "Không lấy được thông tin tài khoản." },
        { status: 400 },
      );
    }
    const u: any = await r.json();
    const profile = {
      id: u.id,
      username: u.username,
      discriminator: u.discriminator,
      global_name: u.global_name ?? null,
      avatar: u.avatar ?? null,
      email: u.email ?? null,
      verified: u.verified ?? false,
    };
    const res = NextResponse.json({ success: true, token, profile });
    res.cookies.set("dqa_oauth_token", "", { maxAge: 0, path: "/" });
    return res;
  } catch {
    return NextResponse.json(
      { success: false, error: "Không gọi được Discord." },
      { status: 400 },
    );
  }
}
