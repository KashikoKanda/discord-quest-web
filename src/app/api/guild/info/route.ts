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

let refreshInitialized = false;

/**
 * GET /api/guild/info
 *
 * Lấy thông tin guild (tên, logo) từ Discord API.
 * Không yêu cầu user token — hoạt động cho cả non-member.
 *
 * Query params:
 *   - guildId: (optional) Override guild ID, defaults to REQUIRED_GUILD_ID from guildConfig
 *   - token: (optional) User Discord token để thử fetch member-specific data
 *
 * Cách hoạt động:
 * 1. Kiểm tra server cache trước
 * 2. Nếu cache cũ hoặc trống → thử public endpoint (preview, widget)
 * 3. Nếu có user token → thử lấy từ guild list của user
 * 4. Cập nhật cache và trả về
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const guildId = searchParams.get("guildId") || REQUIRED_GUILD_ID;
  const userToken = searchParams.get("token");

  if (!guildId) {
    return NextResponse.json({
      success: false,
      error: "No guild ID configured",
      guildName: null,
      guildIcon: null,
    });
  }

  // Khởi tạo auto-refresh timer
  if (!refreshInitialized) {
    refreshInitialized = true;
    initGuildCacheRefresh(guildId);
  }

  let guildName: string | null = null;
  let guildIcon: string | null = null;

  // 1. Kiểm tra cache trước
  const cached = getCachedGuildInfo();
  if (cached && cached.id === guildId) {
    guildName = cached.name;
    guildIcon = cached.iconUrl;

    // Nếu cache còn mới (< 5 phút) và có icon → trả luôn
    if (!isCacheStale() && cached.iconUrl) {
      return NextResponse.json({
        success: true,
        guildName,
        guildIcon,
        cached: true,
      });
    }
  }

  // 2. Thử public endpoint (không cần token)
  try {
    const publicInfo = await fetchGuildInfoFromPublicEndpoint(guildId);
    if (publicInfo) {
      if (publicInfo.name) guildName = publicInfo.name;
      if (publicInfo.icon) {
        guildIcon = `https://cdn.discordapp.com/icons/${guildId}/${publicInfo.icon}.png?size=256`;
      }

      // Cập nhật cache
      setCachedGuildInfo({
        id: guildId,
        name: publicInfo.name || guildName || "Discord Server",
        icon: publicInfo.icon,
      });

      // Nếu đã có đủ info → trả về
      if (guildName && guildIcon) {
        return NextResponse.json({
          success: true,
          guildName,
          guildIcon,
          cached: false,
        });
      }
    }
  } catch {
    // Public endpoint failed
  }

  // 3. Thử với user token (nếu có)
  if (userToken) {
    try {
      const res = await discordFetch(userToken.trim(), "/users/@me/guilds");
      if (res.ok) {
        const guilds = await res.json() as Array<{
          id: string;
          name: string;
          icon: string | null;
        }>;
        const targetGuild = guilds.find((g) => g.id === guildId);
        if (targetGuild) {
          guildName = targetGuild.name;
          if (targetGuild.icon) {
            guildIcon = `https://cdn.discordapp.com/icons/${guildId}/${targetGuild.icon}.png?size=256`;
          }

          // Cập nhật cache (member data là chính xác nhất)
          setCachedGuildInfo({
            id: guildId,
            name: targetGuild.name,
            icon: targetGuild.icon,
          });
        }
      }
    } catch {
      // User token failed
    }
  }

  return NextResponse.json({
    success: !!(guildName || guildIcon),
    guildName,
    guildIcon,
    cached: false,
  });
}
