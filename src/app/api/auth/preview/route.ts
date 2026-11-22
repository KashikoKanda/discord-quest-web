import { NextRequest, NextResponse } from "next/server";
import { checkDiscordToken, normalizeToken, tokenIdOf } from "@/lib/tokenCheck";
import { discordFetch, isTokenExpiredResponse } from "@/lib/discord";
import { getClientCountry } from "@/lib/geoCountry";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const clean = normalizeToken(String((body as { token?: string })?.token || ""));
    if (!clean) return NextResponse.json({ success: false, error: "Chưa có token" }, { status: 400 });

    // Xem trước PHẢI đi qua proxy đã ghim của token, không gọi trực tiếp từ IP
    // Render. Trước đây mỗi lần dán token là frontend tự preview sau 0.7s, tức
    // token bị gửi đi từ IP datacenter US, rồi vài giây sau login lại đi qua
    // proxy VN → cùng một token xuất hiện ở hai nước, đúng mẫu bị thu hồi.
    const tokenId = tokenIdOf(clean);
    let p: Record<string, unknown> | null = null;
    let state = "invalid";

    const res = await discordFetch(clean, "/users/@me", {}, tokenId).catch(() => null);
    if (res && res.ok) {
      p = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    } else if (res && isTokenExpiredResponse(res)) {
      // 401 qua proxy: phân biệt token bot với token chết, không gọi direct.
      const direct = await checkDiscordToken(clean).catch(() => null);
      state = direct?.kind === "bot" ? "bot" : "invalid";
    } else if (!res) {
      // Proxy không ra được mạng → chỉ khi được phép mới thử trực tiếp.
      if (process.env.DISABLE_DIRECT_FALLBACK !== "1") {
        const direct = await checkDiscordToken(clean).catch(() => null);
        if (direct?.kind === "user" && direct.profile) {
          p = direct.profile as Record<string, unknown>;
        } else {
          state = direct?.kind === "bot" ? "bot" : "invalid";
        }
      }
    }

    if (!p) {
      const msg = state === "bot"
        ? "Đây là token BOT, cần token TÀI KHOẢN"
        : "Token không hợp lệ hoặc đã hết hạn";
      return NextResponse.json({ success: false, state, error: msg }, { status: 400 });
    }
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
