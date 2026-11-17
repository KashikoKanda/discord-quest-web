import { NextRequest, NextResponse } from "next/server";
import { initBuildVersion } from "@/lib/discord";
import { registerSession, generateSessionId } from "@/lib/sessionManager";
import { assignProxy, releaseProxy } from "@/lib/proxyPool";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { buildProxyUrl } from "@/lib/proxyHelper";

/**
 * POST /api/auth/login
 * Body: { token, proxyCountry }
 *
 * Flow (giống quest ẩn — KHÔNG fallback direct):
 *   1. Assign proxy theo country user chọn (hoặc auto)
 *   2. Test proxy: fetch Discord /users/@me qua proxy + token
 *      - HTTP 200 → proxy OK + token OK → login success
 *      - HTTP 401 → proxy OK + token SAI → return 401
 *      - HTTP 429 → Discord rate-limit → return 429
 *      - Connection error → proxy fail → release proxy → thử proxy khác
 *   3. Retry tối đa 3 proxy khác nhau
 *   4. Nếu hết proxy → return 503 "không có proxy khả dụng"
 *
 * KHÔNG fallback direct (IP server bị Discord rate-limit).
 */
export async function POST(request: NextRequest) {
  try {
    const { token, sessionId: clientSessionId, proxyCountry } = await request.json();

    if (!token || typeof token !== "string") {
      return NextResponse.json({ error: "Token is required" }, { status: 400 });
    }

    const cleanToken = token.trim();
    const tokenId = `t_${cleanToken.slice(0, 16)}`;
    const userAgent = request.headers.get("user-agent") || undefined;

    initBuildVersion().catch(() => {});

    // Danh sách country để thử
    let countriesToTry: string[];
    if (proxyCountry && proxyCountry !== "auto") {
      // User chọn 1 country → thử country đó + fallback preferred
      countriesToTry = [proxyCountry.toUpperCase(), "US", "GB", "JP", "SG", "DE", "CA", "AU", "FR"];
    } else {
      // Auto → thử preferred countries theo thứ tự random
      countriesToTry = ["US", "GB", "CA", "SG", "JP", "AU", "DE", "FR"].sort(() => Math.random() - 0.5);
    }

    // ─── Retry tối đa 3 proxy khác nhau ───
    const MAX_RETRIES = 3;
    let lastError = "";

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      // Pick next country
      const cc = countriesToTry[attempt % countriesToTry.length];

      // Assign proxy
      let proxy: any = null;
      try {
        const result = await assignProxy(tokenId, cc);
        if (result.ok) {
          proxy = result.assignment.proxy;
        } else {
          // No proxy for this country → try next
          continue;
        }
      } catch {
        continue;
      }

      if (!proxy) continue;

      console.log(`[Auth Login] Attempt ${attempt + 1}/${MAX_RETRIES}: proxy ${cc} ${proxy.host}:${proxy.port}`);

      // Test proxy + verify token trong 1 request
      try {
        const proxyUrl = buildProxyUrl(proxy);
        const agent = new ProxyAgent(proxyUrl);

        const res = await undiciFetch("https://discord.com/api/v10/users/@me", {
          headers: {
            "Authorization": cleanToken,
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/158.0.8127.18 Safari/537.36",
            "Content-Type": "application/json",
          },
          dispatcher: agent,
          headersTimeout: 10_000,
          bodyTimeout: 10_000,
        });

        console.log(`[Auth Login] Proxy ${cc} → HTTP ${res.status}`);

        if (res.ok) {
          // Proxy OK + token OK → login success!
          let profile: any;
          try {
            profile = await res.json();
          } catch {
            // Body not JSON → try next proxy
            releaseProxy(tokenId, cc);
            lastError = "Proxy returned invalid response";
            continue;
          }

          if (profile && profile.id) {
            const sid = clientSessionId || generateSessionId();
            registerSession(tokenId, sid, userAgent);

            return NextResponse.json({
              success: true,
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
              sessionId: sid,
              proxyAssigned: true,
              proxyCountry: cc,
            });
          }
        } else if (res.status === 401) {
          // Proxy OK nhưng token SAI → không cần thử proxy khác
          releaseProxy(tokenId, cc);
          return NextResponse.json(
            { error: "Token không hợp lệ hoặc đã hết hạn" },
            { status: 401 }
          );
        } else if (res.status === 429) {
          // Discord rate-limit qua proxy này → thử proxy khác
          releaseProxy(tokenId, cc);
          lastError = "Discord rate-limit";
          continue;
        } else {
          // Other error → thử proxy khác
          releaseProxy(tokenId, cc);
          lastError = `Discord HTTP ${res.status}`;
          continue;
        }
      } catch (err: any) {
        // Proxy connection failed → release + thử proxy khác
        console.warn(`[Auth Login] Proxy ${cc} failed: ${err.message}`);
        releaseProxy(tokenId, cc);
        lastError = err.message;
        continue;
      }
    }

    // ─── Hết retry → return 503 ───
    return NextResponse.json(
      {
        success: false,
        error: `Không kết nối được proxy sau ${MAX_RETRIES} lần thử (${lastError}). Vui lòng chọn server khác hoặc thử lại sau.`,
      },
      { status: 503 }
    );
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
