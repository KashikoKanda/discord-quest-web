import { NextRequest, NextResponse } from "next/server";
import { initBuildVersion, adoptFingerprint, getOrCreateFingerprint } from "@/lib/discord";
import { registerSession, generateSessionId } from "@/lib/sessionManager";
import { pickLoginProxy, releaseProxy } from "@/lib/proxyPool";
import { ProxyAgent, fetch as undiciFetch } from "undici";
import { buildProxyUrl, getAllProxies, bindStickyProxy, describeFetchError, reportProxyAuthFailure, proxyAuthBlockedFor } from "@/lib/proxyHelper";
import { pickSessionUA, buildDiscordHeaders, sessionUAFromFingerprint } from "@/lib/uaPool";
import { isWebIdentity, webHeaders, userIdFromToken, setProfileForToken } from "@/lib/webIdentity";
import { tokenIdOf } from "@/lib/tokenCheck";
import { checkDiscordToken, normalizeToken, tokenErrorMessage } from "@/lib/tokenCheck";
import { getEphemeralProxy } from "@/lib/proxyFactory";
import { addTransientProxy } from "@/lib/proxyList";
import { getClientCountry } from "@/lib/geoCountry";

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
    // Bảo trì thì chặn login ngay từ cửa: không gọi proxy, không gọi Discord,
    // không tốn một byte dung lượng nào, người dùng nhận đúng một câu duy nhất.
    if (proxyAuthBlockedFor() > 0) {
      return NextResponse.json(
        { success: false, maintenance: true, error: "Hệ thống đang bảo trì, vui lòng quay lại sau ít phút." },
        { status: 503 },
      );
    }

    const { token, sessionId: clientSessionId, proxyCountry, platform } = await request.json();

    if (!token || typeof token !== "string") {
      return NextResponse.json({ error: "Token is required" }, { status: 400 });
    }

    // Bỏ nháy/tiền tố "Bot "/"Bearer " nếu người dùng dán kèm.
    const cleanToken = normalizeToken(token);
    if (!cleanToken) {
      return NextResponse.json({ error: "Token is required" }, { status: 400 });
    }
    const tokenId = tokenIdOf(cleanToken);

    // Owner chọn token này lấy từ đâu: Android hay PC. Ghim theo tokenId để
    // mọi request sau đó (REST, quest, gateway) khai đúng một loại client.
    if (platform === "android" || platform === "pc") {
      setProfileForToken(tokenId, platform === "android" ? "android-app" : "pc-web");
    }
    const userAgent = request.headers.get("user-agent") || undefined;

    initBuildVersion().catch(() => {});

    // Một bộ UA duy nhất cho cả phiên login: UA, sec-ch-ua, super-properties và
    // locale/timezone đều lấy từ cùng một bundle nên không mâu thuẫn nhau.
    // Dùng ĐÚNG fingerprint của token (deterministic theo tokenId) thay vì bốc
    // UA ngẫu nhiên: preview/check, login và worker phải nói cùng một identity.
    const tokenFingerprint = await getOrCreateFingerprint(tokenId).catch(() => null);
    const uaSession = tokenFingerprint
      ? sessionUAFromFingerprint(tokenFingerprint)
      : pickSessionUA();
    const loginHeaders: Record<string, string> = {
      ...buildDiscordHeaders(uaSession.ua, uaSession.superProps),
      ...(isWebIdentity() ? webHeaders(userIdFromToken(cleanToken), tokenId) : {}),
      Authorization: cleanToken,
    };
    const sessionUserAgent = uaSession.ua.userAgent;

    // Danh sách country để thử — CHỈ những country thật sự có proxy trong pool.
    // Trước đây code thử US/GB/SG... trong khi pool chỉ có CA → cả 3 lần đều
    // "proxy pool rỗng", login rơi về IP server, rồi worker lại chạy qua proxy
    // → token đổi IP liên tục và bị Discord thu hồi.
    const pool = await getAllProxies().catch(() => []);
    const availableCountries = Array.from(
      new Set(pool.map((p) => (p.countryCode || "").toUpperCase()).filter(Boolean)),
    );

    // Quốc gia người dùng đang login. Token mới tạo ở VN mà bị dùng từ IP CA/Mỹ
    // trong vài giây là kiểu session bị đánh cắp → Discord thu hồi. Vì vậy ưu
    // tiên proxy CÙNG nước với người dùng; chỉ khi pool không có mới dùng nước khác.
    const clientCountry = await getClientCountry(request.headers).catch(() => null);
    if (clientCountry) {
      console.log(`[Auth Login] Người dùng login từ ${clientCountry} · pool có: ${availableCountries.join(",") || "rỗng"}`);
      if (!availableCountries.includes(clientCountry)) {
        console.warn(
          `[Auth Login] ⚠ Pool KHÔNG có proxy ${clientCountry} → token mới sẽ đi từ IP nước khác, ` +
            `Discord rất dễ coi là phiên bị đánh cắp. Thêm proxy ${clientCountry} vào PROXY_LIST_B64.`,
        );
      }
    }

    // Pool tĩnh không có nước người dùng → tạo proxy đúng nước đó ngay tại chỗ.
    // Owner: login dùng proxy theo nước user nhưng KHÔNG duy trì, tạo thoải mái.
    if (clientCountry && !availableCountries.includes(clientCountry)) {
      const eph = await getEphemeralProxy(clientCountry).catch(() => null);
      if (eph) {
        addTransientProxy(eph.entry);
        availableCountries.push(clientCountry.toUpperCase());
        console.log(`[Auth Login] Đã tạo proxy ${clientCountry} cho phiên login (${eph.entry.host}:${eph.entry.port}).`);
      }
    }

    let countriesToTry: string[];
    if (proxyCountry && proxyCountry !== "auto") {
      const wanted = proxyCountry.toUpperCase();
      countriesToTry = [wanted, ...availableCountries.filter((c) => c !== wanted)];
    } else if (clientCountry && availableCountries.includes(clientCountry)) {
      // cùng nước trước, các nước khác sau
      countriesToTry = [clientCountry, ...availableCountries.filter((c) => c !== clientCountry)];
    } else {
      countriesToTry = [...availableCountries].sort(() => Math.random() - 0.5);
    }
    if (countriesToTry.length === 0) countriesToTry = ["CA"];

    // ─── Retry tối đa 3 proxy khác nhau ───
    const MAX_RETRIES = 3;
    let lastError = "";
    // Có proxy thật sự được dùng chưa? Nếu pool rỗng thì login bằng token vẫn
    // phải chạy (login thẳng), không chặn user bằng lỗi 503.
    let usedProxy = false;

    // Gateway trả 407 = nó từ chối user/pass, khác hẳn "proxy chết". Gặp 407 thì
    // đổi proxy cũng vô ích (mọi proxy cùng một tài khoản), nên báo đúng bệnh.
    let proxyAuthRejected = false;

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
            // Ghim luôn proxy vừa login cho token: REST/enroll/gateway sau đó đi
            // đúng IP này, không đổi IP giữa phiên nữa.
            bindStickyProxy(tokenId, proxy);
            registerSession(tokenId, sid, sessionUserAgent);
            await adoptFingerprint(tokenId, {
              userAgent: uaSession.ua.userAgent,
              chromeVersion: uaSession.ua.chromeVersion,
              osVersion: uaSession.ua.osVersion,
              locale: uaSession.ua.locale,
              timezone: uaSession.ua.timezone,
            });

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
          // 401 có thể do PROXY (sai auth / hết hạn mức) chứ không phải token.
          // Discord luôn trả JSON {"message": ..., "code": 0}; proxy trả text/HTML.
          // Nếu không phải JSON của Discord → đổi proxy khác, đừng doạ user.
          const bodyText = await res.text().catch(() => "");
          let isDiscord401 = false;
          try {
            const parsed = JSON.parse(bodyText);
            isDiscord401 = typeof parsed?.message === "string" || typeof parsed?.code === "number";
          } catch {
            isDiscord401 = false;
          }
          if (!isDiscord401) {
            releaseProxy(tokenId, cc);
            lastError = `Proxy ${cc} trả 401 (lỗi proxy, không phải token)`;
            console.warn(`[Auth Login] Proxy ${cc} trả 401 không phải JSON Discord → thử proxy khác`);
            continue;
          }

          // Discord thật sự từ chối token. Có thể đây là token BOT (hợp lệ nhưng
          // sai loại) → phân loại trước khi báo "sai token".
          releaseProxy(tokenId, cc);
          const verdict = await checkDiscordToken(cleanToken, { dispatcher: agent });
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
        const detail = describeFetchError(err);
        console.warn(`[Auth Login] Proxy ${cc} failed: ${detail}`);
        releaseProxy(tokenId, cc);
        if (detail.includes("407")) {
          proxyAuthRejected = true;
          reportProxyAuthFailure();
          lastError = "gateway proxy từ chối xác thực (HTTP 407)";
        } else {
          lastError = detail;
        }
        continue;
      }
    }

    // ─── Không có proxy nào dùng được → login thẳng từ IP server ───
    // (owner yêu cầu: token/login đi thẳng luôn, không phụ thuộc proxy list).
    const allowDirect = process.env.DISABLE_DIRECT_FALLBACK !== "1";
    if (!usedProxy && allowDirect) {
      console.log("[Auth Login] Proxy pool rỗng → xác thực token trực tiếp từ IP server");
      try {
        const sessionUA = tokenFingerprint
          ? sessionUAFromFingerprint(tokenFingerprint)
          : pickSessionUA(clientSessionId);
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
            await adoptFingerprint(tokenId, {
              userAgent: sessionUA.ua.userAgent,
              chromeVersion: sessionUA.ua.chromeVersion,
              osVersion: sessionUA.ua.osVersion,
              locale: sessionUA.ua.locale,
              timezone: sessionUA.ua.timezone,
            });
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
        // 407 = lỗi hạ tầng (hết traffic proxy), không phải lỗi của người dùng →
        // trả cờ maintenance để UI hiện chế độ bảo trì thay vì bắt họ "chọn server khác".
        maintenance: proxyAuthRejected,
        error: proxyAuthRejected
          ? "Hệ thống đang bảo trì, vui lòng quay lại sau ít phút."
          : `Không đăng nhập được sau ${MAX_RETRIES} lần thử. Vui lòng thử lại sau.`,
      },
      { status: 503 }
    );
  } catch (err: unknown) {
    // Log thật sự — trước đây catch trần nuốt lỗi nên chỉ thấy "Invalid request"
    console.error("[Auth Login] Lỗi không mong đợi:", err instanceof Error ? err.stack || err.message : String(err));
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
