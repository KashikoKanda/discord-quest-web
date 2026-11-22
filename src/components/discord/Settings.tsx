"use client";

import { useAppStore, type DiscordProfile } from "@/lib/store";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  User, Shield, Mail, Crown, CheckCircle2, LogOut, Key, Calendar,
  Hash, ShieldCheck, ShieldAlert, Eye, EyeOff, Copy, Check, RotateCcw,
  Loader2, XCircle, Clock, ChevronRight, AlertTriangle, Zap,
  Lock, Fingerprint, Globe,
} from "lucide-react";
import { useState, useEffect, useCallback, useRef, useSyncExternalStore } from "react";
import { stopLocalEngine } from "@/lib/localQuestEngine";

interface FullProfile {
  user: any;
  profile: any;
  guilds: any[];
  connections: any[];
  billing: any[];
  subscriptions: any[];
  settings: any;
}

function getAvatarUrl(p: DiscordProfile | null) {
  if (!p) return "";
  if (p.avatar) return `https://cdn.discordapp.com/avatars/${p.id}/${p.avatar}.png?size=256`;
  const disc = p.discriminator || "0";
  const index = disc === "0" ? (parseInt(p.id) % 5) : (parseInt(disc) % 5);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

function resolveBannerUser(fullProfile: FullProfile | null, profile: DiscordProfile | null): { id?: string; banner?: string | null; accent_color?: number | null } | null {
  if (fullProfile?.profile?.user) return fullProfile.profile.user;
  if (fullProfile?.user) return fullProfile.user;
  if (profile) return { id: profile.id, banner: profile.banner, accent_color: profile.accent_color };
  return null;
}

function getBannerUrl(fullProfile: FullProfile | null, profile: DiscordProfile | null = null): string {
  // Ưu tiên banner Discord (cần Nitro) — áp dụng cho user có Nitro
  const u = resolveBannerUser(fullProfile, profile);
  if (u?.id && u.banner) {
    return `https://cdn.discordapp.com/banners/${u.id}/${u.banner}.png?size=600`;
  }
  // Không có Nitro / chưa set banner → fallback ảnh upload mặc định
  // (áp dụng cho mọi user dù không có Nitro)
  return "/profile-banner-default.jpg";
}

function getBannerBackground(fullProfile: FullProfile | null, profile: DiscordProfile | null = null): string {
  const imgUrl = getBannerUrl(fullProfile, profile);
  return `url(${imgUrl}) center/cover no-repeat`;
}

function formatSnowflakeDate(id: string) {
  return new Date(Number(BigInt(id) >> BigInt(22)) + 1420070400000).toLocaleDateString("vi-VN", { year: "numeric", month: "long", day: "numeric" });
}

const DISCORD_FLAGS: Record<string, number> = {
  STAFF: 1 << 0, PARTNER: 1 << 1, HYPESQUAD: 1 << 2, BUG_HUNTER_LEVEL_1: 1 << 3,
  HYPESQUAD_ONLINE_HOUSE_1: 1 << 6, HYPESQUAD_ONLINE_HOUSE_2: 1 << 7, HYPESQUAD_ONLINE_HOUSE_3: 1 << 8,
  PREMIUM_EARLY_SUPPORTER: 1 << 9, TEAM_PSEUDO_USER: 1 << 10, BUG_HUNTER_LEVEL_2: 1 << 14,
  VERIFIED_BOT: 1 << 16, VERIFIED_DEVELOPER: 1 << 17, CERTIFIED_MODERATOR: 1 << 18,
  BOT_HTTP_INTERACTIONS: 1 << 19, SPAMMER: 1 << 20, DISABLED: 1 << 22, QUARANTINED: 1 << 44,
};

function decodeFlags(flags: number): string[] {
  const result: string[] = [];
  for (const [name, bit] of Object.entries(DISCORD_FLAGS)) {
    if (flags & bit) result.push(name);
  }
  return result;
}

type AccountStanding = "safe" | "warning" | "danger";

function getAccountStanding(flags: number) {
  const decoded = decodeFlags(flags);
  const isSpammer = decoded.includes("SPAMMER");
  const isQuarantined = decoded.includes("QUARANTINED");
  const isDisabled = decoded.includes("DISABLED");

  if (isDisabled || isQuarantined || isSpammer) {
    return {
      level: "danger" as AccountStanding,
      label: isQuarantined ? "Nguy hiểm" : isDisabled ? "Nguy hiểm" : "Báo động",
      description: isQuarantined ? "Tài khoản bị cách ly (Quarantined). Discord đã phát hiện hoạt động bất thường." : isDisabled ? "Tài khoản đã bị vô hiệu hóa." : "Tài khoản bị gắn cờ SPAMMER. Rủi ro rất cao bị khoá tài khoản.",
      color: "#F6606F", icon: ShieldAlert,
    };
  }

  const warningFlags = decoded.filter(f => !["STAFF", "PARTNER", "HYPESQUAD", "HYPESQUAD_ONLINE_HOUSE_1", "HYPESQUAD_ONLINE_HOUSE_2", "HYPESQUAD_ONLINE_HOUSE_3", "PREMIUM_EARLY_SUPPORTER", "VERIFIED_DEVELOPER", "CERTIFIED_MODERATOR", "BUG_HUNTER_LEVEL_1", "BUG_HUNTER_LEVEL_2", "VERIFIED_BOT", "BOT_HTTP_INTERACTIONS", "TEAM_PSEUDO_USER"].includes(f));
  if (warningFlags.length > 0) {
    return {
      level: "warning" as AccountStanding,
      label: "Cảnh báo",
      description: `Phát hiện flag bất thường: ${warningFlags.join(", ")}`,
      color: "#F5B544", icon: AlertTriangle,
    };
  }

  return {
    level: "safe" as AccountStanding,
    label: "An toàn",
    description: "Tài khoản chưa bị gắn cờ cảnh báo nào từ Discord.",
    color: "#3DD68C", icon: CheckCircle2,
  };
}

function formatFlagBadges(flags: number): { name: string; color: string; danger: boolean }[] {
  const decoded = decodeFlags(flags);
  const badges: { name: string; color: string; danger: boolean }[] = [];
  const nameMap: Record<string, string> = {
    STAFF: "Staff", PARTNER: "Partner", HYPESQUAD: "HypeSquad",
    BUG_HUNTER_LEVEL_1: "Bug Hunter", HYPESQUAD_ONLINE_HOUSE_1: "Bravery",
    HYPESQUAD_ONLINE_HOUSE_2: "Brilliance", HYPESQUAD_ONLINE_HOUSE_3: "Balance",
    PREMIUM_EARLY_SUPPORTER: "Early Supporter", TEAM_PSEUDO_USER: "Team",
    BUG_HUNTER_LEVEL_2: "Bug Hunter Lv2", VERIFIED_BOT: "Verified Bot",
    VERIFIED_DEVELOPER: "Verified Dev", CERTIFIED_MODERATOR: "Certified Mod",
    BOT_HTTP_INTERACTIONS: "HTTP Bot", SPAMMER: "SPAMMER", DISABLED: "DISABLED",
    QUARANTINED: "QUARANTINED",
  };
  const dangerFlags = ["SPAMMER", "DISABLED", "QUARANTINED"];
  for (const f of decoded) {
    badges.push({
      name: nameMap[f] || f,
      color: dangerFlags.includes(f) ? "#F6606F" : "#5865F2",
      danger: dangerFlags.includes(f),
    });
  }
  return badges;
}

/* ─── Animated Section Wrapper (no setState-in-effect) ─── */
function AnimatedSection({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const visible = useSyncExternalStore(() => () => {}, () => true, () => false);
  return (
    <div
      className={`transition-all duration-500 ease-out ${visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"}`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

/* ─── Nitro Type Icon ─── */
function NitroIcon({ type, className = "w-3.5 h-3.5" }: { type: number; className?: string }) {
  if (type <= 0) return <XCircle className={`${className} text-white/30`} />;
  // Dùng ảnh nitro-opal.png (gradient xanh-tím-hồng) thay cho SVG inline
  return (
    <img
      src="/nitro-opal.png"
      alt="Nitro"
      className={className}
      style={{
        objectFit: "contain",
        filter: "drop-shadow(0 0 3px rgba(88,101,242,0.35))",
      }}
      draggable={false}
    />
  );
}

export default function Settings() {
  const {
    token, profile, isVerified, setSidebarOpen, logout, resetState,
    setWorkerStatus, setPage,
    isGuildMember, guildCheckLoading, guildCheckedOnce,
    autoQuestEnabled, setAutoQuestEnabled,
    multiQuestEnabled, setMultiQuestEnabled,
    workerStatus,
    orbsBalance,
  } = useAppStore();
  useEffect(() => {
    let cancelled = false;
    fetch("https://api.ipify.org?format=json", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!cancelled && j?.ip) setClientIp(String(j.ip)); })
      .catch(() => { /* im lặng */ });
    return () => { cancelled = true; };
  }, []);

  const [fullProfile, setFullProfile] = useState<FullProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [copied, setCopied] = useState(false);
  const [resetting, setResetting] = useState(false);
  // IP hiện tại của máy đang dùng (IP gốc), hiện trong thẻ thông tin tài khoản
  const [clientIp, setClientIp] = useState<string | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [autoQuestToggling, setAutoQuestToggling] = useState(false);
  // ─── Nitro purchase button: click → buy → nếu thành công → khóa 2s (countdown) → được ấn tiếp
  const [nitroBuying, setNitroBuying] = useState(false);
  const [nitroCooldown, setNitroCooldown] = useState<number | null>(null);
  const nitroCooldownRef = useRef<NodeJS.Timeout | null>(null);
  // ─── Auto-purchase modal + loop ───
  const [autoModalOpen, setAutoModalOpen] = useState(false);
  const [autoPurchaseCount, setAutoPurchaseCount] = useState("3");
  const [autoLoopActive, setAutoLoopActive] = useState(false);
  const [autoLoopProgress, setAutoLoopProgress] = useState<{ current: number; total: number } | null>(null);
  const autoLoopCancelRef = useRef(false);
  const logoutTimerRef = useRef<NodeJS.Timeout | null>(null);

  const tokenId = token ? `t_${token.slice(0, 16)}` : "";

  const pushAutoQuestToggle = useCallback(async (enabled: boolean): Promise<boolean> => {
    if (!token || !tokenId) return false;
    try {
      const res = await fetch("/api/quests/auto-loop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenId, token, enabled, isVerified, multiQuest: multiQuestEnabled }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) return false;
      return true;
    } catch { return false; }
  }, [token, tokenId, isVerified, multiQuestEnabled]);

  const handleToggleAutoQuest = useCallback(async () => {
    if (!token || autoQuestToggling) return;
    if (!isVerified) return;
    const next = !autoQuestEnabled;
    setAutoQuestToggling(true);
    setAutoQuestEnabled(next);
    const ok = await pushAutoQuestToggle(next);
    if (!ok) setAutoQuestEnabled(!next);
    setAutoQuestToggling(false);
  }, [token, autoQuestToggling, isVerified, autoQuestEnabled, setAutoQuestEnabled, pushAutoQuestToggle]);

  // ─── Nitro purchase: click → buy ngay → nếu thành công → đếm ngược 2s → được ấn tiếp
  const handleNitroPurchase = useCallback(async () => {
    if (!token || nitroBuying || nitroCooldown !== null) return;
    if (workerStatus === "running") return;
    if ((orbsBalance ?? 0) < 1400) return;
    setNitroBuying(true);
    try {
      const tid = `t_${token.slice(0, 16)}`;
      const res = await fetch("/api/nitro/purchase", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, tokenId: tid }),
      });
      const data = await res.json();
      if (data.success) {
        // Re-sync orbs từ Discord API (tránh cache cũ)
        try {
          const syncRes = await fetch("/api/quests", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token }),
          });
          const syncData = await syncRes.json();
          if (typeof syncData.orbsBalance === "number") {
            useAppStore.setState({ orbsBalance: syncData.orbsBalance });
          }
        } catch {
          // Fallback: dùng balance từ response purchase
          if (typeof data.orbsBalance === "number") {
            useAppStore.setState({ orbsBalance: data.orbsBalance });
          }
        }
        // Thành công → đếm ngược 2s mới được ấn tiếp
        setNitroCooldown(2);
        let remaining = 2;
        const tick = () => {
          remaining -= 1;
          if (remaining <= 0) {
            setNitroCooldown(null);
            nitroCooldownRef.current = null;
          } else {
            setNitroCooldown(remaining);
            nitroCooldownRef.current = setTimeout(tick, 1000);
          }
        };
        nitroCooldownRef.current = setTimeout(tick, 1000);
      }
    } catch {
      // Network error — chỉ reset
    } finally {
      setNitroBuying(false);
    }
  }, [token, nitroBuying, nitroCooldown, workerStatus, orbsBalance]);

  // Cleanup cooldown khi unmount
  useEffect(() => {
    return () => {
      if (nitroCooldownRef.current) clearTimeout(nitroCooldownRef.current);
    };
  }, []);

  // ─── Auto-purchase loop: mua N lần liên tiếp, mỗi lần cách 2s
  const handleStartAutoPurchase = useCallback(async (count: number) => {
    if (!token || autoLoopActive || count < 1) return;
    setAutoModalOpen(false);
    setAutoLoopActive(true);
    autoLoopCancelRef.current = false;
    setAutoLoopProgress({ current: 0, total: count });

    for (let i = 0; i < count; i++) {
      if (autoLoopCancelRef.current) break;
      setAutoLoopProgress({ current: i, total: count });
      setNitroBuying(true);
      try {
        const tid = `t_${token.slice(0, 16)}`;
        const res = await fetch("/api/nitro/purchase", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, tokenId: tid }),
        });
        const data = await res.json();
        if (data.success) {
          // Re-sync orbs từ Discord API (tránh cache cũ)
          try {
            const syncRes = await fetch("/api/quests", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token }),
            });
            const syncData = await syncRes.json();
            if (typeof syncData.orbsBalance === "number") {
              useAppStore.setState({ orbsBalance: syncData.orbsBalance });
            }
          } catch {
            if (typeof data.orbsBalance === "number") {
              useAppStore.setState({ orbsBalance: data.orbsBalance });
            }
          }
        } else {
          // Lỗi (thiếu orbs, đã có Nitro, v.v.) → dừng loop ngay
          console.warn(`[AutoNitro] Lần ${i + 1}/${count} thất bại:`, data.message);
          break;
        }
      } catch (err) {
        console.warn(`[AutoNitro] Lần ${i + 1}/${count} network error:`, err);
        break;
      } finally {
        setNitroBuying(false);
      }
      // Đợi 2s trước lần tiếp theo (trừ lần cuối)
      if (i < count - 1 && !autoLoopCancelRef.current) {
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    setAutoLoopActive(false);
    setAutoLoopProgress(null);
    autoLoopCancelRef.current = false;
  }, [token, autoLoopActive]);

  const handleCancelAutoPurchase = useCallback(() => {
    autoLoopCancelRef.current = true;
  }, []);

  const handleResetState = useCallback(async () => {
    if (!token || resetting) return;
    setResetting(true);
    try {
      const tid = `t_${token.slice(0, 16)}`;
      // Quest giờ chạy trong trình duyệt nên phải dừng engine tại đây,
      // nếu không nó vẫn tiếp tục chạy dù server đã báo dừng.
      stopLocalEngine();
      await fetch("/api/quests/stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tokenId: tid }),
      }).catch(() => {});
    } catch { /* ignore */ }
    try {
      const checkRes = await fetch("/api/auth/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const checkData = await checkRes.json();
      if (!checkData.alive) { setResetting(false); logout(); return; }
    } catch { /* ignore */ }
    resetState();
    // Chờ 1s rồi về Dashboard
    setTimeout(() => { setResetting(false); setPage("dashboard"); setSidebarOpen(false); }, 1000);
  }, [token, resetting, logout, resetState, setPage, setSidebarOpen]);

  const loadProfile = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch("/api/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      if (!res.ok) { setLoading(false); return; }
      const data = await res.json();
      if (data.success) setFullProfile(data.data);
    } catch { /* ignore */ }
    setLoading(false);
  };

  useEffect(() => {
    if (token) {
      const id = requestAnimationFrame(() => loadProfile());
      return () => cancelAnimationFrame(id);
    }
  }, [token]);

  const copyToken = () => {
    if (!token) return;
    try {
      navigator.clipboard.writeText(token).catch(() => {
        const textarea = document.createElement("textarea");
        textarea.value = token;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      });
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = token;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleLogout = () => {
    if (confirmLogout) {
      if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
      setConfirmLogout(false);
      logout();
    } else {
      setConfirmLogout(true);
      logoutTimerRef.current = setTimeout(() => setConfirmLogout(false), 3000);
    }
  };

  const user = fullProfile?.user || profile;
  const standing = profile ? getAccountStanding(profile.flags || 0) : null;
  const flagBadges = profile ? formatFlagBadges(profile.flags || 0) : [];
  const premiumType = user?.premium_type || profile?.premium_type || 0;

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 w-full bg-[#0A0B0E]">
      {/* Header */}
      <header className="h-12 lg:h-14 shrink-0 flex items-center justify-between px-3 sm:px-4 lg:px-6 border-b border-white/[0.06] bg-[#0A0B0E]/80 backdrop-blur-xl relative z-30">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-2">
            <h1 className="text-display text-base lg:text-lg text-white tracking-[-0.01em]">Cài đặt</h1>
            <span className="hidden sm:inline text-[11px] font-mono text-white/30">/settings</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {loading ? (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-white/[0.04] border border-white/[0.06]">
              <Loader2 className="w-3 h-3 text-white/50 animate-spin" />
              <span className="text-[11px] text-white/50 hidden sm:inline">Đang tải...</span>
            </div>
          ) : null}
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
        <div className="p-3 sm:p-5 lg:p-6 space-y-3 lg:space-y-4 max-w-3xl mx-auto" style={{ padding: "16px 12px" }}>

          {/* ═════════ Profile Banner ═════════ */}
          <AnimatedSection delay={0}>
            {profile && (
              <div
                className={
                  premiumType > 0
                    ? "rounded-3xl nitro-neon-border w-full"
                    : "surface rounded-3xl w-full"
                }
                style={premiumType > 0 ? { padding: "2px" } : undefined}
              >
                <div className="rounded-[22px] overflow-hidden bg-[#0a0a0f] group relative w-full h-full">
                <div className="relative overflow-hidden aspect-[16/9] lg:aspect-[16/5] min-h-[160px]">
                  <div
                    className="absolute inset-0 bg-center bg-cover transition-transform duration-700 group-hover:scale-105"
                    style={{ background: getBannerBackground(fullProfile, profile) }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#11131A]" />
                  {isVerified && (
                    <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#3DD68C]/15 backdrop-blur-md border border-[#3DD68C]/30">
                      <CheckCircle2 className="w-3 h-3 text-[#3DD68C]" />
                      <span className="text-[10px] font-mono text-[#3DD68C] uppercase tracking-wider">Đã xác minh</span>
                    </div>
                  )}
                </div>

                <div className="relative px-4 sm:px-6 pb-4 sm:pb-5 -mt-12 sm:-mt-14">
                  <div className="flex items-end gap-4">
                    <div className="relative shrink-0">
                      <div className="rounded-[14px] p-1 bg-[#11131A] border border-white/[0.1]">
                        <Avatar className="w-20 h-20 sm:w-24 sm:h-24 rounded-lg">
                          <AvatarImage src={getAvatarUrl(profile)} className="rounded-lg" />
                          <AvatarFallback className="bg-[#5865F2]/15 text-[#5865F2] text-base font-semibold rounded-lg">
                            {profile?.username?.slice(0, 2)?.toUpperCase() || "??"}
                          </AvatarFallback>
                        </Avatar>
                      </div>
                    </div>
                    <div className="flex-1 min-w-0 pb-1">
                      <div className="flex items-center gap-3 flex-wrap">
                        <h2 className="text-display text-xl sm:text-2xl text-white truncate">
                          {profile?.global_name || profile?.username || "Unknown"}
                        </h2>
                        {premiumType > 0 && (
                          <NitroIcon type={premiumType} className="w-5 h-5" />
                        )}
                      </div>
                      <p className="text-[12px] text-white/40 font-mono mt-0.5">@{profile?.username || "unknown"}</p>
                    </div>
                  </div>
                </div>
                </div>
              </div>
            )}
          </AnimatedSection>

          {/* ═════════ Account Info ═════════ */}
          <AnimatedSection delay={80}>
            <div className="surface rounded-2xl overflow-hidden">
              <div className="px-4 sm:px-6 py-3 border-b border-white/[0.04] flex items-center gap-2">
                <div className="w-7 h-7 rounded-md flex items-center justify-center bg-[#5865F2]/12 border border-[#5865F2]/20">
                  <User className="w-3.5 h-3.5 text-[#5865F2]" />
                </div>
                <h3 className="text-[13px] font-semibold text-white">Thông tin tài khoản</h3>
              </div>
              <div className="p-3 sm:p-4 space-y-0.5">
                <InfoRow icon={<Hash className="w-3.5 h-3.5" />} label="UID" value={profile?.id} mono />
                <InfoRow icon={<User className="w-3.5 h-3.5" />} label="Tên" value={profile?.username} mono />
                <InfoRow icon={<User className="w-3.5 h-3.5" />} label="Hiển thị" value={profile?.global_name || profile?.username} />
                <InfoRow icon={<Calendar className="w-3.5 h-3.5" />} label="Ngày tạo" value={profile?.id ? formatSnowflakeDate(profile.id) : undefined} />
                <InfoRow icon={<Globe className="w-3.5 h-3.5" />} label="IP hiện tại" value={clientIp || "..."} mono />
                <InfoRow icon={<Mail className="w-3.5 h-3.5" />} label="Email" value={profile?.email || (isVerified ? "—" : "Chưa xác minh")} valueClass={isVerified ? "text-white" : "text-[#F6606F]"} />

                {!isVerified && (
                  <div className="mt-3 flex items-start gap-2.5 p-3 rounded-lg bg-[#F6606F]/[0.06] border border-[#F6606F]/20">
                    <div className="w-7 h-7 rounded-md flex items-center justify-center bg-[#F6606F]/15 border border-[#F6606F]/25 shrink-0">
                      <AlertTriangle className="w-3.5 h-3.5 text-[#F6606F]" />
                    </div>
                    <div>
                      <p className="text-[12px] font-semibold text-[#F6606F]">Tài khoản chưa xác minh</p>
                      <p className="text-[11px] text-white/50 mt-0.5 leading-relaxed">
                        Tài khoản chưa xác minh email không thể sử dụng dịch vụ. Vui lòng xác minh email Discord để tiếp tục.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </AnimatedSection>

          {/* ═════════ Auto-Quest Toggle ═════════ */}
          <AnimatedSection delay={120}>
            <div className="surface rounded-2xl overflow-hidden relative">
              <div className="px-4 sm:px-6 py-3 border-b border-white/[0.04] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-md flex items-center justify-center bg-[#3DD68C]/12 border border-[#3DD68C]/20">
                    <Zap className="w-3.5 h-3.5 text-[#3DD68C]" />
                  </div>
                  <h3 className="text-[13px] font-semibold text-white">Tự động làm Quest</h3>
                </div>
                {autoQuestEnabled && isVerified && (
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#3DD68C]/10 border border-[#3DD68C]/20">
                    <span className="dot dot-success dot-pulse" style={{ width: 6, height: 6 }} />
                    <span className="text-[10px] font-mono text-[#3DD68C] uppercase">Active</span>
                  </div>
                )}
              </div>

              <div className="p-4 sm:p-5 space-y-3">
                <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                  <p className="text-[11px] text-white/60 leading-relaxed">
                    Tự động làm Quest khi có Quest mới không cần vào web
                  </p>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-white/[0.05]">
                  <div>
                    <p className="text-[13px] font-medium text-white">
                      {autoQuestEnabled && isVerified ? "Đang bật" : "Đang tắt"}
                    </p>
                  </div>
                  <button
                    onClick={handleToggleAutoQuest}
                    disabled={!isVerified || autoQuestToggling}
                    className="relative w-11 h-6 rounded-full transition-colors duration-200 disabled:cursor-not-allowed"
                    style={{
                      backgroundColor: autoQuestEnabled && isVerified ? "#3DD68C" : "rgba(255,255,255,0.1)",
                    }}
                  >
                    <div
                      className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform duration-200"
                      style={{ transform: autoQuestEnabled && isVerified ? "translateX(22px)" : "translateX(2px)" }}
                    />
                  </button>
                </div>

              </div>

              {(!isVerified) && !guildCheckLoading && (
                <div className="absolute inset-0 bg-black/55 backdrop-blur-[1px] rounded-2xl pointer-events-none flex items-center justify-center">
                  <div className="flex flex-col items-center gap-2 px-4 py-3 rounded-lg bg-black/60 border border-white/[0.08]">
                    <Lock className="w-5 h-5 text-white/80" />
                    <span className="text-[11px] font-semibold text-white/85 text-center max-w-[220px]">
                      Vui lòng xác minh email để mở khoá
                    </span>
                  </div>
                </div>
              )}
            </div>
          </AnimatedSection>

          {/* ═════════ Multi-Quest Mode Toggle ═════════ */}
          <AnimatedSection delay={140}>
            <div className="surface rounded-2xl overflow-hidden relative" style={workerStatus === "running" ? { opacity: 0.4, filter: "grayscale(0.6)" } : undefined}>
              <div className="px-4 sm:px-6 py-3 border-b border-white/[0.04] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-md flex items-center justify-center bg-[#5E6AD2]/12 border border-[#5E6AD2]/20">
                    <Zap className="w-3.5 h-3.5 text-[#5E6AD2]" />
                  </div>
                  <h3 className="text-[13px] font-semibold text-white">Chế độ Multi-Quest</h3>
                </div>
                {multiQuestEnabled && (
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#5E6AD2]/10 border border-[#5E6AD2]/20">
                    <span className="dot dot-success dot-pulse" style={{ width: 6, height: 6 }} />
                    <span className="text-[10px] font-mono text-[#5E6AD2] uppercase">Active</span>
                  </div>
                )}
              </div>

              <div className="p-4 sm:p-5 space-y-3">
                <div className="p-2.5 rounded-lg bg-white/[0.02] border border-white/[0.04]">
                  <div className="space-y-1">
                    <p className="text-[11px] text-white/60 leading-relaxed">
                      <span className="font-semibold text-[#5E6AD2]">Bật:</span> Làm tất cả cùng lúc
                    </p>
                    <p className="text-[11px] text-white/60 leading-relaxed">
                      <span className="font-semibold text-[#5E6AD2]">Tắt:</span> Làm theo tuần tự
                    </p>
                  </div>
                </div>

                <div className="flex items-center justify-between p-3 rounded-lg bg-white/[0.02] border border-white/[0.05]">
                  <div>
                    <p className="text-[13px] font-medium text-white">
                      {multiQuestEnabled ? "Multi" : "Single"}
                    </p>
                  </div>
                  {workerStatus !== "running" && (
                    <button
                      onClick={() => setMultiQuestEnabled(!multiQuestEnabled)}
                      className="relative w-11 h-6 rounded-full transition-colors duration-200"
                      style={{
                        backgroundColor: multiQuestEnabled ? "#5E6AD2" : "rgba(255,255,255,0.1)",
                      }}
                    >
                      <div
                        className="absolute top-0.5 w-5 h-5 rounded-full bg-white shadow-md transition-transform duration-200"
                        style={{ transform: multiQuestEnabled ? "translateX(22px)" : "translateX(2px)" }}
                      />
                    </button>
                  )}
                </div>
              </div>

              {workerStatus === "running" && (
                <div className="absolute inset-0 pointer-events-none" />
              )}
            </div>
          </AnimatedSection>

          {/* ═════════ Mua Nitro ═════════ */}
          <AnimatedSection delay={150}>
            <div
              className="surface rounded-2xl overflow-hidden relative flex flex-col"
              style={{
                ...(workerStatus === "running" ? { opacity: 0.4, filter: "grayscale(0.6)" } : {}),
                backgroundImage: "url(/nitro-bg.gif)",
                backgroundSize: "cover",
                backgroundPosition: "center",
                backgroundRepeat: "no-repeat",
                aspectRatio: "1400 / 773",
              }}
            >
              {/* Lớp overlay nhẹ — sáng hơn để gif knight hiện rõ, text vẫn đọc được nhờ drop-shadow */}
              <div className="absolute inset-0 pointer-events-none" style={{
                background: "linear-gradient(180deg, rgba(10,10,15,0.35) 0%, rgba(10,10,15,0.55) 60%, rgba(10,10,15,0.7) 100%)",
              }} />

              <div className="relative z-10 flex flex-col h-full">
                <div className="px-4 sm:px-6 py-3 border-b border-white/[0.06] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <img src="/nitro-opal.png" alt="Nitro" className="w-7 h-7" style={{ objectFit: "contain", filter: "drop-shadow(0 0 4px rgba(88,101,242,0.4))" }} draggable={false} />
                    <h3 className="text-[13px] font-semibold text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.95)]">
                      Nitro 3 Day
                      <span className="text-white/40 mx-1.5">·</span>
                      <span className="font-mono text-[#F5B544]/90">1400 Orbs</span>
                    </h3>
                  </div>
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-[#E879F9]/25 border border-[#E879F9]/45 backdrop-blur-md">
                    <img src="/orbs-animated.gif" alt="Orbs" className="w-3.5 h-3.5" style={{ objectFit: "contain", filter: "drop-shadow(0 0 3px rgba(232, 121, 249, 0.6))" }} draggable={false} />
                    <span className="text-[13px] font-mono font-semibold orbs-rainbow-text tabular-nums drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]">{orbsBalance ?? 0}</span>
                  </div>
                </div>

                {/* Progress bar khi đang auto-purchase */}
                {autoLoopActive && autoLoopProgress && (
                  <div className="mx-4 sm:mx-5 mt-2 p-2.5 rounded-lg bg-black/55 border border-[#F5B544]/30 backdrop-blur-md">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] text-white font-medium drop-shadow-[0_1px_2px_rgba(0,0,0,0.95)]">
                        Auto mua {autoLoopProgress.current + 1}/{autoLoopProgress.total}
                      </span>
                      <button
                        onClick={handleCancelAutoPurchase}
                        className="text-[10px] px-2 py-0.5 rounded bg-[#F6606F]/20 border border-[#F6606F]/40 text-[#F6606F] hover:bg-[#F6606F]/30 transition-colors"
                      >
                        Dừng
                      </button>
                    </div>
                    <div className="h-1 rounded-full bg-white/10 overflow-hidden">
                      <div
                        className="h-full bg-[#F5B544] transition-all duration-300"
                        style={{ width: `${((autoLoopProgress.current) / autoLoopProgress.total) * 100}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* 2 nút — mt-auto đẩy xuống cuối.
                    Disabled khi: đang mua / cooldown / auto-loop / worker chạy / không đủ orbs */}
                <div className="grid grid-cols-2 gap-2 mt-auto p-4 sm:p-5 pt-0">
                  {(() => {
                    const insufficientOrbs = (orbsBalance ?? 0) < 1400;
                    const workerBusy = workerStatus === "running";
                    const buyDisabled = nitroBuying || nitroCooldown !== null || autoLoopActive || workerBusy || insufficientOrbs;
                    const autoDisabled = nitroBuying || autoLoopActive || workerBusy || insufficientOrbs;

                    return (
                      <>
                        <button
                          onClick={handleNitroPurchase}
                          disabled={buyDisabled}
                          className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-[12px] font-semibold transition-all disabled:cursor-not-allowed backdrop-blur-sm"
                          style={{
                            color: nitroCooldown !== null
                              ? "rgba(245,181,68,0.45)"
                              : buyDisabled
                                ? "rgba(255,255,255,0.25)"
                                : "#F5B544",
                            backgroundColor: nitroCooldown !== null
                              ? "rgba(20,15,25,0.7)"
                              : buyDisabled
                                ? "rgba(255,255,255,0.03)"
                                : "rgba(245,181,68,0.12)",
                            border: nitroCooldown !== null
                              ? "1px solid rgba(245,181,68,0.15)"
                              : buyDisabled
                                ? "1px solid rgba(255,255,255,0.06)"
                                : "1px solid rgba(245,181,68,0.35)",
                          }}
                        >
                          {nitroBuying && !autoLoopActive ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              Đang mua…
                            </>
                          ) : nitroCooldown !== null ? (
                            <>
                              <Clock className="w-3.5 h-3.5" />
                              Chờ {nitroCooldown}s
                            </>
                          ) : (
                            <>
                              <Zap className="w-3.5 h-3.5" />
                              Mua ngay
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => setAutoModalOpen(true)}
                          disabled={autoDisabled}
                          className="flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-[12px] font-semibold transition-all disabled:cursor-not-allowed backdrop-blur-sm"
                          style={{
                            color: autoDisabled ? "rgba(255,255,255,0.25)" : "#5865F2",
                            backgroundColor: autoDisabled ? "rgba(255,255,255,0.03)" : "rgba(88,101,242,0.12)",
                            border: autoDisabled ? "1px solid rgba(255,255,255,0.06)" : "1px solid rgba(88,101,242,0.35)",
                          }}
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          Auto mua
                        </button>
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>
          </AnimatedSection>

          {/* ═════════ Auto-purchase Modal ═════════ */}
          {autoModalOpen && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
              onClick={() => setAutoModalOpen(false)}
            >
              <div
                className="relative bg-[#11131A] border border-white/10 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header gradient */}
                <div
                  className="px-5 py-4 relative"
                  style={{
                    background: "linear-gradient(135deg, rgba(88,101,242,0.18) 0%, rgba(232,121,249,0.12) 50%, rgba(245,181,68,0.08) 100%)",
                    borderBottom: "1px solid rgba(255,255,255,0.06)",
                  }}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-md flex items-center justify-center bg-[#5865F2]/20 border border-[#5865F2]/40">
                        <RotateCcw className="w-4 h-4 text-[#5865F2]" />
                      </div>
                      <h3 className="text-[14px] font-semibold text-white leading-tight">Auto mua Nitro</h3>
                    </div>
                    <button
                      onClick={() => setAutoModalOpen(false)}
                      className="text-white/40 hover:text-white hover:bg-white/5 rounded-md p-1 transition-all"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                <div className="p-5 space-y-4">
                  {/* Input số lần */}
                  <div>
                    <label className="text-[11px] text-white/60 mb-2 block flex items-center gap-1.5">
                      <Hash className="w-3 h-3" />
                      Số lần mua
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="50"
                      value={autoPurchaseCount}
                      onChange={(e) => setAutoPurchaseCount(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-lg bg-black/40 border border-white/10 text-white text-[16px] font-mono font-semibold focus:outline-none focus:border-[#5865F2]/60 transition-colors"
                      placeholder="3"
                    />
                    <div className="flex gap-1.5 mt-2">
                      {[1, 3, 5, 10].map(n => {
                        const current = Math.max(1, parseInt(autoPurchaseCount) || 1);
                        const active = current === n;
                        return (
                          <button
                            key={n}
                            onClick={() => setAutoPurchaseCount(String(n))}
                            className={`flex-1 py-1.5 rounded text-[11px] font-mono font-semibold transition-all ${
                              active
                                ? "bg-[#5865F2]/25 border border-[#5865F2]/60 text-white"
                                : "bg-white/5 border border-white/10 text-white/60 hover:bg-white/10 hover:text-white"
                            }`}
                          >
                            {n}×
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Tóm tắt mua hàng — card đẹp */}
                  <div
                    className="rounded-lg overflow-hidden border border-white/[0.08]"
                    style={{
                      background: "linear-gradient(180deg, rgba(255,255,255,0.02) 0%, rgba(0,0,0,0.3) 100%)",
                    }}
                  >
                    {/* 2 row trên: Đơn giá + Số lần */}
                    <div className="grid grid-cols-2 divide-x divide-white/[0.06]">
                      <div className="px-3 py-2.5">
                        <p className="text-[10px] text-white/50 mb-0.5 uppercase tracking-wider">Đơn giá</p>
                        <p className="text-[13px] font-mono font-semibold text-white/90">1400 Orbs</p>
                      </div>
                      <div className="px-3 py-2.5">
                        <p className="text-[10px] text-white/50 mb-0.5 uppercase tracking-wider">Số lần</p>
                        <p className="text-[13px] font-mono font-semibold text-white/90">× {Math.max(1, parseInt(autoPurchaseCount) || 1)}</p>
                      </div>
                    </div>

                    <div className="h-px bg-white/[0.08]" />

                    {/* Row Tổng Orbs cần */}
                    <div className="px-3 py-2.5 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <img src="/orbs-animated.gif" alt="Orbs" className="w-4 h-4" style={{ objectFit: "contain" }} draggable={false} />
                        <span className="text-[12px] text-white/80 font-medium">Tổng Orbs cần</span>
                      </div>
                      <span className="text-[14px] font-mono font-bold orbs-rainbow-text tabular-nums">
                        {Math.max(1, parseInt(autoPurchaseCount) || 1) * 1400}
                      </span>
                    </div>

                    {/* Row Tổng số ngày nhận được — MỚI */}
                    <div className="px-3 py-2.5 flex items-center justify-between bg-[#5865F2]/8 border-t border-[#5865F2]/15">
                      <div className="flex items-center gap-2">
                        <Clock className="w-3.5 h-3.5 text-[#5865F2]" />
                        <span className="text-[12px] text-white/80 font-medium">Tổng ngày nhận được</span>
                      </div>
                      <div className="flex items-baseline gap-1">
                        <span className="text-[16px] font-mono font-bold text-[#5865F2] tabular-nums">
                          {Math.max(1, parseInt(autoPurchaseCount) || 1) * 3}
                        </span>
                        <span className="text-[10px] text-[#5865F2]/70">ngày</span>
                      </div>
                    </div>

                    {/* Số dư hiện có + cảnh báo — card nổi bật */}
                    <div className="h-px bg-white/[0.08]" />
                    <div
                      className={`mx-3 my-2.5 px-3 py-2.5 rounded-md border ${
                        orbsBalance >= Math.max(1, parseInt(autoPurchaseCount) || 1) * 1400
                          ? "bg-[#3DD68C]/8 border-[#3DD68C]/25"
                          : "bg-[#F6606F]/8 border-[#F6606F]/25"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-white/70 font-medium">Số dư hiện có</span>
                        <div className="flex items-center gap-1.5">
                          <span className={`text-[13px] font-mono font-bold tabular-nums ${
                            orbsBalance >= Math.max(1, parseInt(autoPurchaseCount) || 1) * 1400
                              ? "text-[#3DD68C]"
                              : "text-[#F6606F]"
                          }`}>
                            {orbsBalance ?? 0}
                          </span>
                          <span className="text-[10px] text-white/40 font-mono">Orbs</span>
                          <span className={`text-[12px] ${
                            orbsBalance >= Math.max(1, parseInt(autoPurchaseCount) || 1) * 1400
                              ? "text-[#3DD68C]"
                              : "text-[#F6606F]"
                          }`}>
                            {orbsBalance >= Math.max(1, parseInt(autoPurchaseCount) || 1) * 1400 ? "✓" : "✗"}
                          </span>
                        </div>
                      </div>
                      {orbsBalance < Math.max(1, parseInt(autoPurchaseCount) || 1) * 1400 && (
                        <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-[#F6606F]/15">
                          <AlertTriangle className="w-3 h-3 text-[#F6606F] shrink-0" />
                          <span className="text-[10px] text-[#F6606F]/90">Thiếu</span>
                          <span className="text-[11px] font-mono font-bold text-[#F6606F] tabular-nums">
                            {(Math.max(1, parseInt(autoPurchaseCount) || 1) * 1400) - (orbsBalance ?? 0)}
                          </span>
                          <span className="text-[10px] text-[#F6606F]/90">Orbs để hoàn tất</span>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 2 nút */}
                  <div className="flex gap-2">
                    <button
                      onClick={() => setAutoModalOpen(false)}
                      className="flex-1 py-2.5 rounded-lg text-[12px] font-semibold text-white/70 bg-white/5 border border-white/10 hover:bg-white/10 transition-all"
                    >
                      Hủy
                    </button>
                    <button
                      onClick={() => handleStartAutoPurchase(Math.max(1, parseInt(autoPurchaseCount) || 1))}
                      disabled={orbsBalance < Math.max(1, parseInt(autoPurchaseCount) || 1) * 1400}
                      className="flex-1 py-2.5 rounded-lg text-[12px] font-semibold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{
                        background: orbsBalance >= Math.max(1, parseInt(autoPurchaseCount) || 1) * 1400
                          ? "linear-gradient(135deg, #5865F2 0%, #4752C4 100%)"
                          : "rgba(88,101,242,0.3)",
                        boxShadow: orbsBalance >= Math.max(1, parseInt(autoPurchaseCount) || 1) * 1400
                          ? "0 4px 12px rgba(88,101,242,0.25)"
                          : "none",
                      }}
                    >
                      Bắt đầu auto
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═════════ Account Standing ═════════ */}
          {standing && (
            <AnimatedSection delay={160}>
              <div className="surface rounded-2xl overflow-hidden">
                <div className="px-4 sm:px-6 py-3 border-b border-white/[0.04] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-md flex items-center justify-center bg-[#5865F2]/12 border border-[#5865F2]/20">
                      <ShieldCheck className="w-3.5 h-3.5 text-[#5865F2]" />
                    </div>
                    <h3 className="text-[13px] font-semibold text-white">Trạng thái tài khoản</h3>
                  </div>
                  <div
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded-md border"
                    style={{
                      backgroundColor: `${standing.color}1A`,
                      borderColor: `${standing.color}30`,
                    }}
                  >
                    <span className="dot" style={{ width: 6, height: 6, background: standing.color }} />
                    <span className="text-[11px] font-mono font-semibold" style={{ color: standing.color }}>{standing.label}</span>
                  </div>
                </div>

                <div className="p-4 sm:p-5 space-y-4">
                  <div className="flex items-center gap-3.5">
                    <div
                      className="w-12 h-12 rounded-xl flex items-center justify-center border"
                      style={{
                        backgroundColor: `${standing.color}15`,
                        borderColor: `${standing.color}30`,
                        color: standing.color,
                      }}
                    >
                      {(() => {
                        const Icon = standing.icon;
                        return <Icon className="w-5 h-5" />;
                      })()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-semibold" style={{ color: standing.color }}>{standing.label}</p>
                      <p className="text-[11px] text-white/50 mt-0.5 leading-relaxed">{standing.description}</p>
                    </div>
                  </div>

                  {flagBadges.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {flagBadges.map((b, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold transition-transform duration-200 hover:scale-105"
                          style={{
                            backgroundColor: `${b.color}15`,
                            color: b.color,
                            border: `1px solid ${b.color}25`,
                          }}
                        >
                          <span className="text-[8px]">{b.danger ? "⚠" : "✦"}</span>
                          {b.name}
                        </span>
                      ))}
                    </div>
                  )}

                  {standing.level === "safe" && (
                    <div className="flex items-start gap-2.5 p-3 rounded-lg bg-[#3DD68C]/[0.06] border border-[#3DD68C]/20">
                      <CheckCircle2 className="w-4 h-4 text-[#3DD68C] mt-0.5 shrink-0" />
                      <div>
                        <p className="text-[12px] font-semibold text-[#3DD68C]">Tài khoản hoạt động bình thường</p>
                        <p className="text-[11px] text-white/50 mt-0.5 leading-relaxed">Không phát hiện cảnh báo nào từ Discord. Tài khoản của bạn đang trong trạng thái an toàn và có thể sử dụng dịch vụ bình thường.</p>
                      </div>
                    </div>
                  )}
                  {standing.level === "warning" && (
                    <div className="flex items-start gap-2.5 p-3 rounded-lg bg-[#F5B544]/[0.06] border border-[#F5B544]/20">
                      <AlertTriangle className="w-4 h-4 text-[#F5B544] mt-0.5 shrink-0" />
                      <div>
                        <p className="text-[12px] font-semibold text-[#F5B544]">Cần chú ý</p>
                        <p className="text-[11px] text-white/50 mt-0.5 leading-relaxed">Tài khoản của bạn có một số flag bất thường. Hãy theo dõi và hạn chế sử dụng các công cụ tự động hóa để tránh bị gắn cờ SPAMMER.</p>
                      </div>
                    </div>
                  )}
                  {standing.level === "danger" && (
                    <div className="flex items-start gap-2.5 p-3 rounded-lg bg-[#F6606F]/[0.06] border border-[#F6606F]/20">
                      <ShieldAlert className="w-4 h-4 text-[#F6606F] mt-0.5 shrink-0" />
                      <div>
                        <p className="text-[12px] font-semibold text-[#F6606F]">Ngừng sử dụng ngay!</p>
                        <p className="text-[11px] text-white/50 mt-0.5 leading-relaxed">Tài khoản đã bị Discord gắn cờ nguy hiểm. Tiếp tục sử dụng công cụ tự động có thể dẫn đến khoá tài khoản vĩnh viễn. Hãy dừng ngay và chờ flag được gỡ bỏ.</p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </AnimatedSection>
          )}

          {/* ═════════ Token Section ═════════ */}
          <AnimatedSection delay={240}>
            <div className="surface rounded-2xl overflow-hidden">
              <div className="px-4 sm:px-6 py-3 border-b border-white/[0.04] flex items-center gap-2">
                <div className="w-7 h-7 rounded-md flex items-center justify-center bg-[#F6606F]/12 border border-[#F6606F]/20">
                  <Key className="w-3.5 h-3.5 text-[#F6606F]" />
                </div>
                <h3 className="text-[13px] font-semibold text-white">Token</h3>
                <div className="ml-auto flex items-center gap-1 px-2 py-1 rounded-md bg-white/[0.03] border border-white/[0.06]">
                  <Fingerprint className="w-3 h-3 text-white/40" />
                  <span className="text-[9px] font-mono text-white/40 uppercase tracking-wider">Secret</span>
                </div>
              </div>
              <div className="p-4 sm:p-5 space-y-3">
                <div className="flex items-start gap-2">
                  <div className="flex-1 bg-black/30 rounded-lg px-3 py-2.5 font-mono text-[11px] text-white/60 break-all select-all min-h-[44px] border border-white/[0.06] transition-colors duration-200 focus-within:border-[#5865F2]/30">
                    {showToken ? (token || "—") : (token ? "•".repeat(Math.min(token.length, 80)) : "—")}
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setShowToken(!showToken)}
                      className="h-9 w-9 text-white/50 hover:text-white hover:bg-white/[0.06] rounded-md transition-all duration-200 active:scale-95"
                    >
                      {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={copyToken}
                      className="h-9 w-9 text-white/50 hover:text-white hover:bg-white/[0.06] rounded-md transition-all duration-200 active:scale-95"
                    >
                      {copied ? <Check className="w-4 h-4 text-[#3DD68C]" /> : <Copy className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>

                <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-[#F6606F]/[0.06] border border-[#F6606F]/15">
                  <ShieldAlert className="w-3.5 h-3.5 text-[#F6606F]/70 shrink-0" />
                  <p className="text-[11px] text-[#F6606F]/80 font-medium">Không chia sẻ token với bất kỳ ai.</p>
                </div>
              </div>
            </div>
          </AnimatedSection>

          {/* ═════════ Danger Zone ═════════ */}
          <AnimatedSection delay={320}>
            <div className="surface rounded-2xl overflow-hidden">
              <div className="px-4 sm:px-6 py-3 border-b border-white/[0.04] flex items-center gap-2">
                <div className="w-7 h-7 rounded-md flex items-center justify-center bg-white/[0.04] border border-white/[0.08]">
                  <RotateCcw className="w-3.5 h-3.5 text-white/60" />
                </div>
                <h3 className="text-[13px] font-semibold text-white">Hành động</h3>
              </div>
              <div className="p-4 sm:p-5 space-y-2.5">
                <button
                  onClick={handleResetState}
                  disabled={resetting}
                  className="w-full group relative rounded-lg overflow-hidden transition-all duration-200 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed btn-sweep"
                >
                  <div className="absolute inset-0 bg-[#F5B544]/[0.08] border border-[#F5B544]/20 group-hover:bg-[#F5B544]/[0.12] group-hover:border-[#F5B544]/30 transition-all duration-200" />
                  <div className="relative flex items-center justify-center gap-2.5 py-3">
                    {resetting ? (
                      <Loader2 className="w-4 h-4 text-[#F5B544] animate-spin" />
                    ) : (
                      <RotateCcw className="w-4 h-4 text-[#F5B544] group-hover:rotate-[-45deg] transition-transform duration-300" />
                    )}
                    <span className="text-[13px] font-semibold text-[#F5B544]">
                      {resetting ? "Đang đặt lại..." : "Đặt lại trạng thái"}
                    </span>
                  </div>
                </button>

                <button
                  onClick={handleLogout}
                  className={`w-full group relative rounded-lg overflow-hidden transition-all duration-200 active:scale-[0.99] btn-sweep`}
                >
                  <div
                    className="absolute inset-0 border transition-all duration-200"
                    style={{
                      background: confirmLogout
                        ? "linear-gradient(90deg, rgba(246,96,111,0.18), rgba(246,96,111,0.10), rgba(246,96,111,0.18))"
                        : "rgba(246,96,111,0.08)",
                      borderColor: confirmLogout ? "rgba(246,96,111,0.5)" : "rgba(246,96,111,0.2)",
                      borderWidth: confirmLogout ? "2px" : "1px",
                    }}
                  />
                  {confirmLogout && (
                    <div className="absolute -inset-px rounded-lg pointer-events-none" style={{ boxShadow: "0 0 20px rgba(246,96,111,0.25), 0 0 40px rgba(246,96,111,0.1)" }} />
                  )}
                  <div className="relative flex items-center justify-center gap-2.5 py-3">
                    <LogOut className="w-4 h-4 text-[#F6606F] group-hover:translate-x-[-2px] group-hover:-translate-y-[1px] transition-transform duration-300" />
                    <span className="text-[13px] font-semibold text-[#F6606F]">
                      {confirmLogout ? "Nhấn lần nữa để đăng xuất" : "Đăng xuất"}
                    </span>
                  </div>
                </button>
              </div>
            </div>
          </AnimatedSection>
        </div>
      </div>
    </div>
  );
}

/* ─── InfoRow Component (no setState-in-effect) ─── */
function InfoRow({ icon, label, value, mono, valueClass, nitroType }: {
  icon: React.ReactNode;
  label: string;
  value?: string;
  mono?: boolean;
  valueClass?: string;
  nitroType?: number;
}) {
  const visible = useSyncExternalStore(() => () => {}, () => true, () => false);
  const nitroSubLabel = nitroType !== undefined && nitroType > 0
    ? nitroType === 1 ? "Classic" : nitroType === 3 ? "Basic" : ""
    : undefined;

  return (
    <div
      className={`flex items-center gap-2.5 py-2 px-2 -mx-2 rounded-md transition-all duration-300 hover:bg-white/[0.03] ${visible ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-2"}`}
    >
      <span className="text-white/40 shrink-0 w-4 flex items-center justify-center">{icon}</span>
      <span className="text-[10px] lg:text-[11px] text-white/40 w-16 lg:w-20 shrink-0 font-mono uppercase tracking-wider">{label}</span>
      <span className={`text-[12px] lg:text-[13px] flex-1 min-w-0 truncate flex items-center gap-1.5 ${mono ? "font-mono text-[11px] lg:text-[12px]" : ""} ${valueClass || "text-white"}`}>
        {nitroType !== undefined && nitroType > 0 && <NitroIcon type={nitroType} className="w-3.5 h-3.5" />}
        <span>{value || "—"}</span>
        {nitroSubLabel && <span className="text-[9px] lg:text-[10px] text-white/40 font-normal">({nitroSubLabel})</span>}
      </span>
      <ChevronRight className="w-3 h-3 text-white/[0.1] shrink-0" />
    </div>
  );
}
