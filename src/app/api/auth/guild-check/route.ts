import { NextRequest, NextResponse } from "next/server";
import { discordFetch } from "@/lib/discord";
import { REQUIRED_GUILD_ID } from "@/lib/guildConfig";
import {
  getCachedGuildInfo,
  setCachedGuildInfo,
  isCacheStale,
  fetchGuildInfoFromPublicEndpoint,
  initGuildCacheRefresh,
} from "@/lib/guildCache";

// Track if we've initialized the auto-refresh timer
let refreshInitialized = false;

/**
 * POST /api/auth/guild-check
 *
 * Kiểm tra xem user (dựa trên token) có trong nhóm Discord yêu cầu hay không.
 * Trả thêm thông tin guild (tên, icon) để hiển thị UI cho cả member và non-member.
 *
 * Body: { token: string }
 * Guild ID được cấu hình trong src/lib/guildConfig.ts
 *
 * Cách hoạt động (ưu tiên từ nhanh → chậm):
 * 1. Thử GET /guilds/{guild_id} — trả 200 nếu là member, 403/404 nếu không
 *    → Chỉ 1 API call, chính xác 100%, không bị giới hạn 200 guild
 * 2. Nếu không member hoặc cần thêm info, thử GET /users/@me/guilds (có phân trang)
 * 3. Lấy guild info từ server cache hoặc public endpoint
 */
export async function POST(request: NextRequest) {
  try {
    const { token } = await request.json();

    if (!token || typeof token !== "string") {
      return NextResponse.json(
        { error: "Token is required" },
        { status: 400 }
      );
    }

    const requiredGuildId = REQUIRED_GUILD_ID;

    // Khởi tạo auto-refresh timer (chạy 1 lần)
    if (!refreshInitialized && requiredGuildId) {
      refreshInitialized = true;
      initGuildCacheRefresh(requiredGuildId);
    }

    const cleanToken = token.trim();
    // Cùng một IP với phiên quest: kiểm tra guild gọi trực tiếp từ IP Render
    // trong khi REST/gateway đang chạy qua proxy sẽ bị Discord coi là lạc phiên.
    const tokenId = `t_${cleanToken.slice(0, 16)}`;

    let isMember = false;
    let guildName: string | null = null;
    let guildIcon: string | null = null;

    // ═══ Phương pháp 1: Kiểm tra trực tiếp membership ═══
    // GET /guilds/{guild_id} → 200 nếu member, 403 nếu không
    // Ưu điểm: chính xác 100%, chỉ 1 API call, không bị giới hạn 200 guild
    try {
      const directRes = await discordFetch(cleanToken, `/guilds/${requiredGuildId}`, {}, tokenId);

      if (directRes.ok) {
        // User LÀ member — response chứa guild info
        isMember = true;
        try {
          const guildData = await directRes.json() as {
            name?: string;
            icon?: string | null;
          };
          guildName = guildData.name || null;
          guildIcon = guildData.icon
            ? `https://cdn.discordapp.com/icons/${requiredGuildId}/${guildData.icon}.png?size=256`
            : null;

          // Cập nhật cache
          if (guildData.name) {
            setCachedGuildInfo({
              id: requiredGuildId,
              name: guildData.name,
              icon: guildData.icon || null,
            });
          }
        } catch {
          // Parse error — vẫn coi là member
        }
      } else if (directRes.status === 403) {
        // 403 = User KHÔNG phải member
        isMember = false;
      } else if (directRes.status === 401) {
        // Token hết hạn
        const cached = getCachedGuildInfo();
        return NextResponse.json(
          {
            error: "Token expired",
            isMember: false,
            guildName: cached?.name || null,
            guildIcon: cached?.iconUrl || null,
          },
          { status: 401 }
        );
      }
      // Các status khác (429 rate limit, 5xx) → fallback to method 2
    } catch {
      // Network error → fallback to method 2
    }

    // ═══ Phương pháp 2: Fallback — duyệt danh sách guilds (có phân trang) ═══
    // Chỉ dùng nếu method 1 chưa xác định được (API error, rate limit, etc.)
    if (!isMember && guildName === null) {
      try {
        let found = false;
        let afterId: string | undefined = undefined;

        // Duyệt tối đa 10 trang (10 * 200 = 2000 guilds, đủ cho mọi user)
        for (let page = 0; page < 10; page++) {
          const path = afterId
            ? `/users/@me/guilds?limit=200&after=${afterId}`
            : `/users/@me/guilds?limit=200`;

          const res = await discordFetch(cleanToken, path, {}, tokenId);

          if (!res.ok) {
            if (res.status === 401) {
              const cached = getCachedGuildInfo();
              return NextResponse.json(
                {
                  error: "Token expired",
                  isMember: false,
                  guildName: cached?.name || null,
                  guildIcon: cached?.iconUrl || null,
                },
                { status: 401 }
              );
            }
            break; // Lỗi khác → dừng duyệt
          }

          const guilds = await res.json() as Array<{
            id: string;
            name: string;
            icon: string | null;
          }>;

          if (!Array.isArray(guilds) || guilds.length === 0) {
            break; // Hết guilds
          }

          const targetGuild = guilds.find((g) => g.id === requiredGuildId);
          if (targetGuild) {
            isMember = true;
            guildName = targetGuild.name;
            guildIcon = targetGuild.icon
              ? `https://cdn.discordapp.com/icons/${requiredGuildId}/${targetGuild.icon}.png?size=256`
              : null;

            // Cập nhật cache
            setCachedGuildInfo({
              id: requiredGuildId,
              name: targetGuild.name,
              icon: targetGuild.icon,
            });

            found = true;
            break;
          }

          // Chuẩn bị cho trang tiếp theo
          afterId = guilds[guilds.length - 1].id;

          // Nếu trang này có ít hơn 200 guild → đây là trang cuối
          if (guilds.length < 200) break;
        }
      } catch {
        // Discord API call failed — tiếp tục lấy guild info từ cache
      }
    }

    // ═══ Lấy guild info từ cache / public endpoint nếu chưa có ═══
    if (!isMember || !guildIcon) {
      // 1. Thử server cache trước
      const cached = getCachedGuildInfo();
      if (cached) {
        if (!guildName) guildName = cached.name;
        if (!guildIcon) guildIcon = cached.iconUrl;

        // Nếu cache còn mới → trả luôn, không cần gọi thêm API
        if (!isCacheStale() && cached.iconUrl) {
          return NextResponse.json({
            isMember,
            guildName,
            guildIcon,
            configured: true,
          });
        }
      }

      // 2. Cache cũ hoặc chưa có → thử fetch từ public endpoint
      try {
        const publicInfo = await fetchGuildInfoFromPublicEndpoint(requiredGuildId);
        if (publicInfo) {
          if (!guildName && publicInfo.name) guildName = publicInfo.name;
          if (publicInfo.icon) {
            guildIcon = `https://cdn.discordapp.com/icons/${requiredGuildId}/${publicInfo.icon}.png?size=256`;
          }

          // Cập nhật cache
          setCachedGuildInfo({
            id: requiredGuildId,
            name: publicInfo.name || guildName || "Discord Server",
            icon: publicInfo.icon,
          });
        }
      } catch {
        // Public endpoint failed → ignore, use whatever we have
      }

      // 3. Thử guild preview với user token (cho guild discoverable)
      if (!guildIcon) {
        try {
          const previewRes = await discordFetch(
        cleanToken,
        `/guilds/${requiredGuildId}/preview`,
        {},
        tokenId,
      );
          if (previewRes.ok) {
            const preview = await previewRes.json() as {
              name?: string;
              icon?: string | null;
            };
            if (!guildName && preview.name) guildName = preview.name;
            if (preview.icon) {
              guildIcon = `https://cdn.discordapp.com/icons/${requiredGuildId}/${preview.icon}.png?size=256`;
              // Cập nhật cache
              setCachedGuildInfo({
                id: requiredGuildId,
                name: preview.name || guildName || "Discord Server",
                icon: preview.icon,
              });
            }
          }
        } catch {
          // Preview API fail → ignore
        }
      }
    }

    return NextResponse.json({
      isMember,
      guildName,
      guildIcon,
      configured: true,
    });
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
}
