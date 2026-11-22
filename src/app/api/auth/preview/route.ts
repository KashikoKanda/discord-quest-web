import { NextRequest, NextResponse } from "next/server";
import { checkDiscordToken, normalizeToken } from "@/lib/tokenCheck";
import { getClientCountry } from "@/lib/geoCountry";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const clean = normalizeToken(String((body as { token?: string })?.token || ""));
    if (!clean) return NextResponse.json({ success: false, error: "Chưa có token" }, { status: 400 });

    const check = await checkDiscordToken(clean);
    if (check.kind !== "user" || !check.profile) {
      const msg = check.kind === "bot"
        ? "Đây là token BOT, cần token TÀI KHOẢN"
        : check.status === 429 ? "Discord đang giới hạn tốc độ, thử lại sau" : "Token không hợp lệ hoặc đã hết hạn";
      return NextResponse.json({ success: false, state: check.kind, error: msg }, { status: 400 });
    }

    const p = check.profile as Record<string, unknown>;
    const country = await getClientCountry(request.headers);
    return NextResponse.json({
      success: true,
      account: {
        id: p.id, username: p.username, global_name: p.global_name || null,
        discriminator: p.discriminator || "0", avatar: p.avatar || null,
        locale: p.locale || null, verified: !!p.verified, mfa: !!p.mfa_enabled,
      },
      country,
    });
  } catch {
    return NextResponse.json({ success: false, error: "Không xem trước được token" }, { status: 500 });
  }
}
