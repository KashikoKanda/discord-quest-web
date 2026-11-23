/**
 * Kiểm tra tư cách thành viên guild KDGW NGAY TRONG TRÌNH DUYỆT (IP thật).
 * Dùng chung cho Dashboard và trang Quest ẩn để không lệch logic.
 */
import { REQUIRED_GUILD_ID } from "@/lib/guildConfig";
import { buildDiscordHeaders } from "@/lib/deviceIdentity";

export type GuildResult = { member: boolean; name: string | null; icon: string | null };

function iconUrl(icon: string | null | undefined): string | null {
  return icon ? `https://cdn.discordapp.com/icons/${REQUIRED_GUILD_ID}/${icon}.png?size=128` : null;
}

/** null = không xác định được (bị chặn mạng), giữ nguyên trạng thái cũ. */
export async function checkGuildMembership(token: string): Promise<GuildResult | null> {
  // 1) Danh sách guild của chính tài khoản: 1 request, trả luôn tên + icon.
  try {
    const r = await fetch("https://discord.com/api/v9/users/@me/guilds", {
      headers: buildDiscordHeaders(token),
      cache: "no-store",
    });
    if (r.ok) {
      const list = await r.json().catch(() => null);
      if (Array.isArray(list)) {
        const hit = list.find((g: { id?: string }) => g?.id === REQUIRED_GUILD_ID) as
          | { id: string; name?: string; icon?: string | null }
          | undefined;
        if (hit) return { member: true, name: hit.name || null, icon: iconUrl(hit.icon) };
        return { member: false, name: null, icon: null };
      }
    }
  } catch {
    /* thử đường khác */
  }
  // 2) Hỏi thẳng guild.
  try {
    const g = await fetch(`https://discord.com/api/v9/guilds/${REQUIRED_GUILD_ID}?with_counts=true`, {
      headers: buildDiscordHeaders(token),
      cache: "no-store",
    });
    if (g.status === 200) {
      const info = await g.json().catch(() => null);
      return { member: true, name: info?.name || null, icon: iconUrl(info?.icon) };
    }
    if (g.status === 403 || g.status === 404) return { member: false, name: null, icon: null };
  } catch {
    /* im lặng */
  }
  return null;
}
