import { NextRequest, NextResponse } from "next/server";
import { initBuildVersion } from "@/lib/discord";
import { registerSession, generateSessionId } from "@/lib/sessionManager";
import { pickLoginProxy, releaseProxy } from "@/lib/proxyPool";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { buildProxyUrl } from "@/lib/proxyHelper";
import { pickSessionUA, buildDiscordHeaders } from "@/lib/uaPool";
import { checkDiscordToken, normalizeToken, tokenErrorMessage } from "@/lib/tokenCheck";

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

    // Bỏ nháy/tiền tố "Bot "/"Bearer " nếu người dùng dán kèm.
    const cleanToken = normalizeToken(token);
    if (!cleanToken) {
      return NextResponse.json({ error: "Token is required" }, { status: 400 });
    }
    const tokenId = `t_${cleanToken.slice(0, 16)}`;
    const userAgent = request.headers.get("user-agent") || undefined;

    initBuildVersion().catch(() => {});

    // Một bộ UA duy nhất cho cả phiên login: UA, sec-ch-ua, super-properties và
    // locale/timezone đều lấy từ cùng một bundle nên không mâu thuẫn nhau.
    const uaSession = pickSessionUA();
    const loginHeaders: Record<string, string> = {
      ...buildDiscordHeaders(uaSession.ua, uaSession.superProps),
      Authorization: cleanToken,
    };
    const sessionUserAgent = uaSession.ua.userAgent;

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
    // Có proxy thật sự được dùng chưa? Nếu pool rỗng thì login bằng token vẫn
    // phải chạy (login thẳng), không chặn user bằng lỗi 503.
    let usedProxy = false;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      // Pick next country
      const cc = countriesToTry[attempt % countriesToTry.length];

      // Login lấy proxy NGẪU NHIÊN trong pool — trùng proxy với người khác là
      // bình thường và không chiếm slot của quest ẩn.
      let proxy: any = null;
      try {
        proxy = await pickLoginProxy(cc);
      } catch {
        proxy = null;
      }

      if (!proxy) continue;
      usedProxy = true;

      console.log(`[Auth Login] Attempt ${attempt + 1}/${MAX_RETRIES}: proxy ${cc} ${proxy.host}:${proxy.port}`);

      // Test proxy + verify token trong 1 request
      try {
        const proxyUrl = buildProxyUrl(proxy);
        const agent = new ProxyAgent(proxyUrl);

        const res = await undiciFetch("https://discord.com/api/v10/users/@me", {
          headers: loginHeaders,
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
            registerSession(tokenId, sid, sessionUserAgent);

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
          // Proxy OK nhưng Discord từ chối token. Có thể đây là token BOT
          // (hợp lệ nhưng sai loại) → phân loại trước khi báo "sai token".
          releaseProxy(tokenId, cc);
          const verdict = await checkDiscordToken(cleanToken);
          return NextResponse.json(
            {
              success: false,
              state: verdict.kind,
              error: tokenErrorMessage(verdict),
              discord: verdict.detail || null,
            },
            { status: verdict.kind === "unknown" ? 503 : 401 },
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

    // ─── Không có proxy nào dùng được → login thẳng từ IP server ───
    // (owner yêu cầu: token/login đi thẳng luôn, không phụ thuộc proxy list).
    const allowDirect = process.env.DISABLE_DIRECT_FALLBACK !== "1";
    if (!usedProxy && allowDirect) {
      console.log("[Auth Login] Proxy pool rỗng → xác thực token trực tiếp từ IP server");
      try {
        const sessionUA = pickSessionUA(clientSessionId);
        const verdict = await checkDiscordToken(cleanToken, {
          headers: {
            "User-Agent": sessionUA.ua.userAgent,
            "Accept-Language": sessionUA.ua.acceptLanguage,
          },
        });

        if (verdict.kind === "user" && verdict.profile) {
          const profile: any = verdict.profile;
          if (profile && profile.id) {
            const sid = clientSessionId || generateSessionId();
            registerSession(tokenId, sid, sessionUA.ua.userAgent);
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
              proxyAssigned: false,
              proxyCountry: null,
            });
          }
        } else if (verdict.kind === "bot") {
          // Token bot hợp lệ nhưng web cần token tài khoản → báo rõ, đừng nói sai token.
          return NextResponse.json(
            { success: false, state: "bot", error: tokenErrorMessage(verdict) },
            { status: 400 },
          );
        } else if (verdict.kind === "invalid") {
          return NextResponse.json(
            { success: false, state: "invalid", error: tokenErrorMessage(verdict), discord: verdict.detail || null },
            { status: 401 },
          );
        } else if (verdict.status === 429) {
          return NextResponse.json(
            { success: false, state: "rate_limited", error: tokenErrorMessage(verdict) },
            { status: 429 },
          );
        }
        lastError = `direct HTTP ${verdict.status}`;
      } catch (err: any) {
        lastError = err?.message || "direct request failed";
        console.warn("[Auth Login] Direct verify failed:", lastError);
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
