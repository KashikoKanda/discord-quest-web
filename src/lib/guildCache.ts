/**
 * Guild Info Cache
 *
 * Caches guild info (name, icon) server-side so that non-members
 * can still see the guild's logo in the "not a member" notification.
 *
 * Flow:
 * 1. When any member's guild-check succeeds → cache the guild info
 * 2. When a non-member checks → return cached info
 * 3. Auto-refresh cache periodically (every 30 min)
 * 4. Also tries Discord public endpoints (invite, preview, widget) as fallback
 *
 * Key insight: GET /invites/{code} does NOT require authentication
 * and returns guild info including icon hash. This works for any guild
 * that has a public invite link!
 */

interface GuildInfo {
  id: string;
  name: string;
  icon: string | null;       // icon hash from Discord
  iconUrl: string | null;    // full CDN URL
  fetchedAt: number;         // timestamp
}

// In-memory cache (persists as long as server is running)
let cachedGuildInfo: GuildInfo | null = null;
let refreshTimer: NodeJS.Timeout | null = null;

const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

/**
 * Build the Discord CDN icon URL from guild ID and icon hash
 */
function buildIconUrl(guildId: string, iconHash: string | null): string | null {
  if (!iconHash) return null;
  // Use .png for static, .gif for animated (starts with a_)
  const ext = iconHash.startsWith("a_") ? ".gif" : ".png";
  return `https://cdn.discordapp.com/icons/${guildId}/${iconHash}${ext}?size=256`;
}

/**
 * Get the currently cached guild info
 */
export function getCachedGuildInfo(): GuildInfo | null {
  if (!cachedGuildInfo) return null;
  // Check if cache is stale (but still return it — refresh will happen in background)
  return cachedGuildInfo;
}

/**
 * Update the cache with fresh guild info
 */
export function setCachedGuildInfo(data: {
  id: string;
  name: string;
  icon: string | null;
}): void {
  cachedGuildInfo = {
    id: data.id,
    name: data.name,
    icon: data.icon,
    iconUrl: buildIconUrl(data.id, data.icon),
    fetchedAt: Date.now(),
  };
  console.log(`[GuildCache] Updated cache: "${data.name}" icon=${data.icon ? "✓" : "✗"}`);
}

/**
 * Check if the cache is stale and needs refreshing
 */
export function isCacheStale(): boolean {
  if (!cachedGuildInfo) return true;
  return Date.now() - cachedGuildInfo.fetchedAt > CACHE_TTL;
}

/**
 * Try to fetch guild info from public Discord endpoints
 * (no authentication required)
 *
 * Attempts (in order of reliability):
 * 1. Invite endpoint — works for any guild with a public invite code!
 *    GET /invites/{code} returns guild name + icon hash without auth
 * 2. Guild Preview — works for discoverable guilds without auth
 * 3. Guild Widget — if enabled, returns name (no icon)
 */
export async function fetchGuildInfoFromPublicEndpoint(guildId: string): Promise<{
  name: string | null;
  icon: string | null;
} | null> {
  // 1. Try Invite endpoint — BEST method, works without auth!
  // Read the invite code from guildConfig
  const { GUILD_INVITE_CODE } = await import("./guildConfig");
  const inviteCode = GUILD_INVITE_CODE;
  if (inviteCode) {
    try {
      const inviteRes = await fetch(`https://discord.com/api/v10/invites/${inviteCode}`, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          "Content-Type": "application/json",
        },
      });

      if (inviteRes.ok) {
        const data = await inviteRes.json() as {
          guild?: {
            id?: string;
            name?: string;
            icon?: string | null;
          };
          profile?: {
            name?: string;
            icon_hash?: string | null;
          };
        };
        const guild = data.guild;
        if (guild && (guild.name || guild.icon)) {
          return {
            name: guild.name || null,
            icon: guild.icon || data.profile?.icon_hash || null,
          };
        }
      }
    } catch {
      // Invite endpoint failed
    }
  }

  // 2. Try Guild Preview — works without auth for discoverable guilds
  try {
    const previewRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/preview`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Content-Type": "application/json",
      },
    });

    if (previewRes.ok) {
      const preview = await previewRes.json() as { name?: string; icon?: string | null; id?: string };
      if (preview.name || preview.icon) {
        return {
          name: preview.name || null,
          icon: preview.icon || null,
        };
      }
    }
  } catch {
    // Preview not available
  }

  // 3. Try Widget endpoint — no auth needed if widget is enabled
  try {
    const widgetRes = await fetch(`https://discord.com/api/v10/guilds/${guildId}/widget.json`, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (widgetRes.ok) {
      const widget = await widgetRes.json() as { name?: string; id?: string };
      // Widget doesn't include icon, but at least we get the name
      if (widget.name) {
        return {
          name: widget.name,
          icon: null,
        };
      }
    }
  } catch {
    // Widget not available
  }

  return null;
}

/**
 * Initialize auto-refresh of guild cache
 * Called once on server startup
 */
export function initGuildCacheRefresh(guildId: string): void {
  if (refreshTimer) return; // Already initialized

  // Do an initial fetch immediately
  fetchGuildInfoFromPublicEndpoint(guildId).then((info) => {
    if (info && (info.name || info.icon)) {
      setCachedGuildInfo({
        id: guildId,
        name: info.name || "Discord Server",
        icon: info.icon,
      });
    }
  }).catch(() => { /* silent */ });

  // Refresh every 30 minutes
  refreshTimer = setInterval(async () => {
    if (!cachedGuildInfo || isCacheStale()) {
      try {
        const info = await fetchGuildInfoFromPublicEndpoint(guildId);
        if (info && (info.name || info.icon)) {
          setCachedGuildInfo({
            id: guildId,
            name: info.name || cachedGuildInfo?.name || "Discord Server",
            icon: info.icon !== null ? info.icon : cachedGuildInfo?.icon || null,
          });
          console.log(`[GuildCache] Auto-refreshed guild info: ${info.name}`);
        }
      } catch {
        // Silent fail
      }
    }
  }, CACHE_TTL);
}

/**
 * Cleanup timer (for testing)
 */
export function cleanupGuildCache(): void {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  cachedGuildInfo = null;
}
