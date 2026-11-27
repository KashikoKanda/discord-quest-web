"use client";
// Tạm đóng xử lý quest theo yêu cầu owner (đang chỉnh identity/proxy).
// Đổi thành false để bật lại.
const QUESTS_PAUSED = false;

import { useAppStore, type QuestData } from "@/lib/store";
import { GUILD_INVITE_URL } from "@/lib/guildConfig";
import { checkGuildMembership } from "@/lib/guildCheck";
import { startLocalEngine, isLocalEngineRunning, stopLocalEngine } from "@/lib/localQuestEngine";
import { buildDiscordHeaders } from "@/lib/deviceIdentity";
import { enrollQuestBrowser } from "@/lib/questActions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MotionSection } from "@/components/discord/MotionSection";
import {
  Play, Trophy, Loader2, Video, Gamepad2, ExternalLink,
  ListFilter, ShieldAlert, AlertTriangle, RefreshCw, ArrowRight,
  TrendingUp, Clock,
} from "lucide-react";
import { useEffect, useState, useRef, useCallback, memo, useSyncExternalStore } from "react";

/* ─── Status palette ─── */
const STATUS_COLORS = {
  available: "#8A8F98",
  enrolled: "#8A8F98",
  running: "#F5B544",
  completed: "#3DD68C",
  unclaimed: "#5BC0EB",
  claimed: "#3DD68C",
  expired: "#F6606F",
  failed: "#F6606F",
} as const;

const FILTER_COLORS = {
  all: "#E6E8EC",
  video: "#F5B544",
  game: "#5BC0EB",
} as const;

const TYPE_COLORS = {
  video: "#F5B544",
  game: "#5BC0EB",
  activity: "#3DD68C",
  stream: "#E879F9",
  achievement: "#5865F2",
} as const;

function getStatusColor(status: string, isClaimed?: boolean): string {
  if (status === "completed" && !isClaimed) return STATUS_COLORS.unclaimed;
  if (status === "completed" && isClaimed) return STATUS_COLORS.claimed;
  return (STATUS_COLORS as Record<string, string>)[status] ?? "#8A8F98";
}

function getQuestTypeLabel(type: string) {
  switch (type) {
    case "WATCH_VIDEO": case "WATCH_VIDEO_ON_MOBILE": return "Video";
    case "PLAY_ON_DESKTOP": case "PLAY_ON_XBOX": case "PLAY_ON_PLAYSTATION": return "Game";
    case "PLAY_ACTIVITY": return "Activity";
    case "STREAM_ON_DESKTOP": return "Stream";
    case "ACHIEVEMENT_IN_ACTIVITY": return "Achievement";
    default: return type;
  }
}

function getQuestTypeColor(type: string): string {
  if (type.startsWith("WATCH_VIDEO")) return TYPE_COLORS.video;
  if (type === "STREAM_ON_DESKTOP") return TYPE_COLORS.stream;
  if (type === "PLAY_ACTIVITY") return TYPE_COLORS.activity;
  if (type === "ACHIEVEMENT_IN_ACTIVITY") return TYPE_COLORS.achievement;
  return TYPE_COLORS.game;
}

function isVideoType(type: string) {
  return type === "WATCH_VIDEO" || type === "WATCH_VIDEO_ON_MOBILE" || type === "STREAM_ON_DESKTOP";
}

function formatExpires(dateStr?: string) {
  if (!dateStr) return { text: "", color: "#8A8F98", expired: false };
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff <= 0) return { text: "Hết hạn", color: "#F6606F", expired: true };
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  if (days > 0) return { text: `Còn ${days} ngày`, color: "#3DD68C", expired: false };
  if (hours > 0) return { text: `Còn ${hours} giờ`, color: "#F5B544", expired: false };
  return { text: `Còn ${mins} phút`, color: "#F5B544", expired: false };
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  if (!hex || !hex.startsWith("#")) return null;
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) } : null;
}

/* ─── Orb Icon — animated GIF ─── */
function OrbIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/orbs-animated.gif" alt="Orbs" className={className} style={{ objectFit: "contain", filter: "drop-shadow(0 0 4px rgba(232, 121, 249, 0.45))" }} draggable={false} />
  );
}
function TotalIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/total-icon.gif" alt="Tổng" className={className} style={{ objectFit: "contain", filter: "drop-shadow(0 0 4px rgba(138, 143, 152, 0.45))" }} draggable={false} />
  );
}
function CompletedIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/completed-icon.gif" alt="Xong" className={className} style={{ objectFit: "contain", filter: "drop-shadow(0 0 4px rgba(61, 214, 140, 0.45))" }} draggable={false} />
  );
}
function WaitingIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/waiting-icon.gif" alt="Chờ nhận" className={className} style={{ objectFit: "contain", filter: "drop-shadow(0 0 4px rgba(91, 192, 235, 0.45))" }} draggable={false} />
  );
}

type QuestFilter = "all" | "video" | "game";

export default function Dashboard() {
  const {
    token, profile, workerStatus, quests, logs, orbsBalance,
    isVerified, isGuildMember, guildCheckLoading,
    setQuests, setWorkerStatus, updateQuestProgress,
    addLog, setSidebarOpen, logout, setGuildMember, setGuildCheckLoading,
    multiQuestEnabled,
  } = useAppStore();

  // Kiểm tra guild NGAY KHI VÀO DASHBOARD (owner: "nên check guild khi vào dashboard").
  // Nhờ vậy trạng thái thành viên có sẵn trước khi mở trang Quest ẩn, không bị nháy.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const st = useAppStore.getState();
    st.setGuildCheckLoading(true);
    checkGuildMembership(token)
      .then((res) => {
        if (cancelled) return;
        if (res) useAppStore.getState().setGuildMember(res.member, res.name, res.icon);
        useAppStore.getState().setGuildCheckLoading(false);
      })
      .catch(() => {
        if (!cancelled) useAppStore.getState().setGuildCheckLoading(false);
      });
    return () => { cancelled = true; };
  }, [token]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);
  const [tokenId, setTokenId] = useState<string>(() => token ? `t_${token.slice(0, 16)}` : "main");
  const [questFilter, setQuestFilter] = useState<QuestFilter>("all");
  // Chế độ tối giản giờ nằm trong Settings (store.compactQuests) — một nguồn
  // duy nhất, không còn nút riêng trên header dashboard.
  const compactMode = useAppStore((st) => st.compactQuests);
  const setCompactMode = useAppStore((st) => st.setCompactQuests);
  const pollingRef = useRef<NodeJS.Timeout | null>(null);

  const checkTokenExpired = useCallback((res: Response, data?: Record<string, unknown>) => {
    // CHỈ logout khi server xác nhận token chết. 401 trần có thể chỉ là proxy
    // bị Discord từ chối tạm thời → trước đây web đá user ra và báo "bị thu hồi".
    if (data?.tokenExpired === true) {
      try { sessionStorage.setItem("dq_token_expired", "1"); } catch { /* ignore */ }
      logout();
      return true;
    }
    return false;
  }, [logout]);

  const refreshQuests = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      // Quest ở dashboard tải qua IP GỐC của máy (owner chốt 22/11/2026):
      // trình duyệt gọi thẳng Discord, server chỉ định dạng lại dữ liệu.
      let clientQuests: unknown = null;
      try {
        const raw = await fetch("https://discord.com/api/v9/quests/@me", {
          headers: buildDiscordHeaders(token),
          cache: "no-store",
        });
        if (raw.ok) clientQuests = await raw.json();
      } catch { /* bị chặn thì để server tải hộ */ }

      const res = await fetch("/api/quests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, isVerified, clientQuests }),
      });
      const data = await res.json();
      if (checkTokenExpired(res, data)) { setLoading(false); return; }
      if (!res.ok) {
        addLog({ level: "error", message: `Lỗi server: ${res.status}`, timestamp: Date.now() });
        setLoading(false);
        return;
      }
      if (data.success) {
        setQuests(data.quests || [], data.orbsBalance, data.excludedQuestIds);
        if (data.tokenId) setTokenId(data.tokenId);
        addLog({ level: "info", message: `Đã tải ${(data.quests || []).length} quest`, timestamp: Date.now() });
      } else {
        addLog({ level: "error", message: data.error || "Lỗi tải quest", timestamp: Date.now() });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Lỗi tải quest";
      addLog({ level: "error", message: msg, timestamp: Date.now() });
    }
    setLoading(false);
  }, [token, isVerified, setQuests, addLog, checkTokenExpired]);

  const logsRef = useRef(logs);
  logsRef.current = logs;

  const pollWorkerStatus = useCallback(async () => {
    try {
      const [statusRes, logsRes] = await Promise.all([
        fetch(`/api/quests/status?tokenId=${tokenId}`).catch(() => null),
        fetch(`/api/quests/logs?tokenId=${tokenId}`).catch(() => null),
      ]);
      if (statusRes && statusRes.status === 401) {
        const statusBody = await statusRes.clone().json().catch(() => null);
        if (!(statusBody as { tokenExpired?: boolean } | null)?.tokenExpired) return;
        try {
          const errData = await statusRes.json();
          if (errData?.tokenExpired) { checkTokenExpired(statusRes, errData); return; }
        } catch { /* ignore */ }
      }
      if (statusRes?.ok) {
        try {
          const statusData = await statusRes.json();
          if (statusData.success) {
            setWorkerStatus(statusData.status as "idle" | "running" | "error");
            if (statusData.questProgress) {
              const progressMap = statusData.questProgress as Record<string, { progress: number; status: string }>;
              for (const [questId, prog] of Object.entries(progressMap)) {
                updateQuestProgress(questId, prog.progress, prog.status);
              }
            }
          }
        } catch { /* ignore */ }
      }
      if (logsRes?.ok) {
        try {
          const logsData = await logsRes.json();
          if (logsData.success && logsData.logs?.length > 0) {
            const currentLogs = logsRef.current;
            const latestLogTimestamp = currentLogs.length > 0 ? currentLogs[0].timestamp : 0;
            const newLogs = logsData.logs.filter((l: { timestamp: number }) => l.timestamp > latestLogTimestamp);
            for (const l of newLogs.reverse()) {
              addLog({ level: l.level, message: l.message, timestamp: l.timestamp });
            }
          }
        } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }, [setWorkerStatus, updateQuestProgress, addLog, tokenId, checkTokenExpired]);

  useEffect(() => {
    if (workerStatus === "running") {
      if (!pollingRef.current) pollingRef.current = setInterval(pollWorkerStatus, 3000);
    } else {
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
    }
    return () => { if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; } };
  }, [workerStatus, pollWorkerStatus]);

  const startQuests = async () => {
    if (!token) {
      addLog({ level: "warn", message: "Chưa có token — đăng nhập lại rồi thử", timestamp: Date.now() });
      return;
    }
    // Phản hồi ngay để bấm là thấy có tác dụng, không im lặng.
    addLog({ level: "info", message: "Đã bấm bắt đầu — đang khởi động engine quest…", timestamp: Date.now() });
    const avail = quests.filter((q) => q.status === "available" || q.status === "enrolled").length;
    // Owner: "mở khoá nút làm quest" — không chặn nút khi danh sách trống nữa.
    // Trước đây bấm vào là phát laugh.mp3 rồi return, nhìn như nút bị khoá.
    if (avail === 0) {
      addLog({ level: "info", message: "Chưa có quest nào để làm — vẫn khởi động engine để chờ quest mới", timestamp: Date.now() });
    }
    try {
      if (QUESTS_PAUSED) { addLog({ level: "warn", message: "Tạm đóng xử lý quest, sẽ bật lại sau." } as never); return; }
      if (isLocalEngineRunning()) {
        addLog({ level: "warn", message: "Quest đang chạy trên máy bạn rồi", timestamp: Date.now() });
        return;
      }
      // Owner chốt: xử lý quest chạy ở IP GỐC. Toàn bộ request enroll thường,
      // video-progress, heartbeat, gateway presence và claim đi thẳng từ trình
      // duyệt, không qua server, không tốn dung lượng proxy.
      setWorkerStatus("running");
      addLog({ level: "info", message: "Chạy quest từ IP mạng thật của máy bạn (không qua proxy)", timestamp: Date.now() });
      await startLocalEngine(token, {
        log: (level, message) => addLog({ level, message, timestamp: Date.now() }),
        progress: (questId, progress, status) => updateQuestProgress(questId, progress, status as never),
      }, { concurrency: multiQuestEnabled ? 3 : 1 });
      setWorkerStatus("idle");
      void refreshQuests();
    } catch (err: unknown) { setWorkerStatus("idle"); addLog({ level: "error", message: err instanceof Error ? err.message : "Lỗi kết nối", timestamp: Date.now() }); }
  };

  const enrollQuestAction = async (questId: string) => {
    if (!token) return;
    setActionLoading(questId);
    try {
      // Nhận quest NGAY TRONG TRÌNH DUYỆT (IP mạng nhà), không qua server/proxy.
      const data = await enrollQuestBrowser(token, questId);
      if (data.success) { addLog({ level: "success", message: `Đã đăng ký quest`, timestamp: Date.now() }); await refreshQuests(); }
      else addLog({ level: "error", message: data.message || "Đăng ký thất bại", timestamp: Date.now() });
    } catch (err: unknown) { addLog({ level: "error", message: err instanceof Error ? err.message : "Lỗi kết nối", timestamp: Date.now() }); }
    setActionLoading(null);
  };

  const initialDone = useRef(false);
  useEffect(() => {
    if (token && !initialDone.current) {
      initialDone.current = true;
      const t = setTimeout(() => refreshQuests(), 100);
      return () => clearTimeout(t);
    }
  }, [token, refreshQuests]);

  const initialStatusChecked = useRef(false);
  useEffect(() => {
    if (token && !initialStatusChecked.current) {
      initialStatusChecked.current = true;
      const tid = `t_${token.slice(0, 16)}`;
      fetch(`/api/quests/status?tokenId=${tid}`)
        .then((res) => { if (!res.ok) return null; return res.json(); })
        .then((data) => {
          if (data?.success && data.status === "running") {
            setWorkerStatus("running");
            if (data.questProgress) {
              const progressMap = data.questProgress as Record<string, { progress: number; status: string }>;
              for (const [questId, prog] of Object.entries(progressMap)) {
                updateQuestProgress(questId, prog.progress, prog.status);
              }
            }
          }
        })
        .catch(() => {/* ignore */});
    }
  }, [token, setWorkerStatus, updateQuestProgress]);

  // Stats
  const allCompleted = quests.filter((q) => q.status === "completed" || q.status === "unclaimed").length;
  const claimed = quests.filter((q) => (q.status === "completed" || q.status === "unclaimed") && q.isClaimed).length;
  const unclaimed = quests.filter((q) => (q.status === "completed" || q.status === "unclaimed") && !q.isClaimed).length;
  const running = quests.filter((q) => q.status === "running").length;
  const available = quests.filter((q) => q.status === "available" || q.status === "enrolled").length;
  const claimableOrbs = quests
    .filter((q) => (q.status === "completed" || q.status === "unclaimed") && !q.isClaimed && q.orbsReward)
    .reduce((sum, q) => sum + (q.orbsReward || 0), 0);

  const completionRate = quests.length > 0 ? Math.round((allCompleted / quests.length) * 100) : 0;

  const questOrder: Record<string, number> = { running: 0, enrolled: 1, available: 2, unclaimed: 3, completed: 4, expired: 5, failed: 6 };

  const filterFn = (q: QuestData) => {
    if (questFilter === "video") return isVideoType(q.type);
    if (questFilter === "game") return !isVideoType(q.type);
    return true;
  };

  const allQuestsSorted = quests
    .filter(filterFn)
    .filter((q) => { if (q.status === "expired" && !(q.completedAt && q.isClaimed)) return false; return true; })
    .sort((a, b) => {
      const aExpiredDone = a.status === "expired" && a.completedAt && a.isClaimed;
      const bExpiredDone = b.status === "expired" && b.completedAt && b.isClaimed;
      if (aExpiredDone !== bExpiredDone) return aExpiredDone ? 1 : -1;
      const orderA = questOrder[a.status] ?? 9;
      const orderB = questOrder[b.status] ?? 9;
      if (orderA !== orderB) return orderA - orderB;
      if ((a.status === "completed" || a.status === "unclaimed") && (b.status === "completed" || b.status === "unclaimed")) {
        return (a.isClaimed ? 1 : 0) - (b.isClaimed ? 1 : 0);
      }
      return 0;
    });

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 w-full relative bg-[#0A0B0E]">
      {/* ─── Top Bar ─── */}
      <header className="h-12 lg:h-14 shrink-0 flex items-center justify-between px-3 sm:px-4 lg:px-6 border-b border-white/[0.06] bg-[#0A0B0E]/80 backdrop-blur-xl relative z-30">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-2">
            <h1 className="text-display text-base lg:text-lg text-white tracking-[-0.01em]">Dashboard</h1>
            <span className="hidden sm:inline text-[11px] font-mono text-white/30">/overview</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={refreshQuests}
            disabled={loading}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-white/[0.04] border border-white/[0.06] hover:bg-white/[0.06] hover:border-white/[0.1] transition-all text-[12px] text-white/60 hover:text-white"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            <span className="hidden sm:inline">Làm mới</span>
          </button>
          <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#E879F9]/[0.1] border border-[#E879F9]/20">
            <OrbIcon className="w-4 h-4" />
            <span className="text-[13px] font-semibold font-mono orbs-rainbow-text">{orbsBalance ?? 0}</span>
            <span className="text-[10px] text-[#E879F9]/60 hidden sm:inline">orbs</span>
          </div>
        </div>
      </header>

      {/* ─── Scrollable ─── */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide relative">
        {!isVerified && token ? (
          /* Not Verified */
          <div className="flex-1 flex flex-col items-center justify-center px-4 py-16 relative">
            <div
              className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full pointer-events-none"
              style={{ background: "radial-gradient(circle, rgba(246, 96, 111, 0.12) 0%, transparent 70%)", filter: "blur(60px)" }}
            />
            <div className="relative w-16 h-16 rounded-2xl flex items-center justify-center mb-5" style={{
              background: "linear-gradient(135deg, #F6606F 0%, #F5B544 100%)",
              boxShadow: "0 8px 32px rgba(246, 96, 111, 0.3)",
            }}>
              <ShieldAlert className="w-8 h-8 text-white" />
            </div>
            <h2 className="text-display text-2xl text-white mb-2">Tài khoản chưa xác minh</h2>
            <p className="text-white/50 text-sm text-center max-w-sm leading-relaxed mb-6">
              Token chưa xác minh không thể sử dụng dịch vụ. Vui lòng xác minh email Discord để bắt đầu làm quest.
            </p>
            <div className="surface rounded-xl p-4 max-w-md w-full">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-md flex items-center justify-center bg-[#F6606F]/15 border border-[#F6606F]/25 shrink-0">
                  <AlertTriangle className="w-4 h-4 text-[#F6606F]" />
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-[#F6606F] mb-1">Yêu cầu xác minh Email</p>
                  <p className="text-[12px] text-white/50 leading-relaxed">
                    Mở Discord → User Settings → My Account → Verify Email
                  </p>
                </div>
              </div>
            </div>
          </div>
        ) : (
        <>
        {loading && quests.length > 0 && (
          <div className="absolute top-0 left-0 right-0 z-30 h-0.5 overflow-hidden">
            <div className="h-full w-1/3 shimmer-bar" />
          </div>
        )}

        {/* ─── Hero: Big action button ─── */}
        <MotionSection className="px-3 sm:px-4 lg:px-6 pt-4 pb-3">
          <div className="grid grid-cols-1 gap-3">
            {/* Big action button — full width */}
            <div className={`transition-all duration-700 ${mounted ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2"}`}>
              {workerStatus === "running" ? (
                <div className="surface rounded-xl p-4 sm:p-5 lg:p-6 flex items-center gap-4 relative overflow-hidden">
                  <div className="absolute inset-0 bg-gradient-to-r from-[#F5B544]/[0.1] via-[#F5B544]/[0.04] to-transparent" />
                  <div className="relative w-12 h-12 lg:w-14 lg:h-14 rounded-xl flex items-center justify-center bg-[#F5B544]/15 border border-[#F5B544]/30">
                    <Loader2 className="w-5 h-5 lg:w-6 lg:h-6 text-[#F5B544] animate-spin" />
                  </div>
                  <div className="relative flex-1 min-w-0">
                    <p className="text-display text-lg sm:text-xl text-[#F5B544] truncate">Đang làm {running} Quest</p>
                  </div>
                  <div className="relative hidden sm:flex flex-col items-end gap-1 shrink-0">
                    <span className="dot dot-warning dot-pulse" />
                    <span className="text-[10px] font-mono text-white/50">LIVE</span>
                  </div>
                </div>
              ) : (
                <button
                  onClick={startQuests}
                  className="w-full group relative rounded-xl overflow-hidden transition-all duration-300 active:scale-[0.99]"
                  style={{ contain: "layout style paint" }}
                >
                  {/* Layer 1: Outer pulsing glow ring */}
                  <div
                    className="absolute -inset-1 rounded-xl opacity-60 gpu-layer pointer-events-none"
                    style={{
                      background: "radial-gradient(circle, rgba(88,101,242,0.35) 0%, rgba(232,121,249,0.2) 40%, transparent 70%)",
                      animation: "start-pulse 2.5s ease-in-out infinite",
                    }}
                  />
                  {/* Layer 2: Rotating conic gradient border */}
                  <div
                    className="absolute -inset-px rounded-xl opacity-50 pointer-events-none gpu-layer"
                    style={{
                      background: "conic-gradient(from 0deg, #5865F2, #E879F9, #3DD68C, #5865F2)",
                      animation: "gradient-rotate 4s linear infinite",
                      mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
                      WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)",
                      WebkitMaskComposite: "xor",
                      maskComposite: "exclude",
                      padding: "1.5px",
                    }}
                  />
                  {/* Layer 3: Shimmer sweep */}
                  <div
                    className="absolute inset-0 pointer-events-none gpu-layer overflow-hidden"
                  >
                    <div
                      className="absolute -inset-full"
                      style={{
                        background: "linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.06) 50%, transparent 70%)",
                        backgroundSize: "200% 100%",
                        animation: "shimmer-sweep 3s linear infinite",
                      }}
                    />
                  </div>
                  {/* Gradient background + content */}
                  <div
                    className="relative surface rounded-xl p-4 sm:p-5 lg:p-6 flex items-center gap-4 overflow-hidden btn-sweep transition-all duration-300 group-hover:border-[#5865F2]/40"
                    style={{
                      background: "linear-gradient(135deg, rgba(88,101,242,0.15) 0%, rgba(232,121,249,0.12) 50%, rgba(61,214,140,0.08) 100%), linear-gradient(180deg, #15171D 0%, #11131A 100%)",
                    }}
                  >
                    {/* Icon with halo */}
                    <div className="relative shrink-0">
                      <div
                        className="absolute -inset-2 rounded-xl opacity-60 pointer-events-none"
                        style={{
                          background: "radial-gradient(circle, rgba(88,101,242,0.5) 0%, transparent 70%)",
                          animation: "icon-glow 2s ease-in-out infinite",
                        }}
                      />
                      <div
                        className="relative w-12 h-12 lg:w-14 lg:h-14 rounded-xl flex items-center justify-center bg-gradient-to-br from-[#5865F2] to-[#4752C4] transition-transform duration-300"
                        style={{
                          boxShadow: "0 8px 24px rgba(88, 101, 242, 0.6)",
                          animation: "icon-bounce 3s ease-in-out infinite",
                        }}
                      >
                        <Play className="w-5 h-5 lg:w-6 lg:h-6 text-white ml-0.5 group-hover:scale-110 transition-transform duration-200" fill="currentColor" />
                      </div>
                    </div>
                    <div className="relative flex-1 text-left min-w-0">
                      <p className="text-display text-lg sm:text-xl text-white truncate">Bắt đầu làm quest</p>
                      <p className="text-[11px] text-white/40 mt-0.5 hidden sm:block">
                        {available > 0 ? `${available} quest sẵn sàng` : "Không có quest mới"}
                      </p>
                    </div>
                    <div className="relative flex items-center gap-2 shrink-0">
                      <span className="hidden sm:inline text-[11px] font-mono text-[#5865F2] uppercase tracking-wider font-semibold">Start</span>
                      <div className="w-9 h-9 rounded-md bg-[#5865F2]/20 border border-[#5865F2]/30 flex items-center justify-center group-hover:bg-[#5865F2] group-hover:border-[#5865F2] transition-all">
                        <ArrowRight className="w-4 h-4 text-[#5865F2] group-hover:text-white group-hover:translate-x-1 transition-all duration-200" />
                      </div>
                    </div>
                  </div>
                </button>
              )}
            </div>
          </div>
        </MotionSection>

        {/* ─── Stats grid — 4 mini cards ─── */}
        <MotionSection className="px-3 sm:px-4 lg:px-6 pb-3" delay={0.05}>
          <div className="grid grid-cols-4 lg:grid-cols-4 gap-2 sm:gap-3">
            <StatCard icon={<TotalIcon className="w-[22px] h-[22px]" />} label="Tổng" value={quests.length} color="#8A8F98" delay={60} mounted={mounted} />
            <StatCard icon={<CompletedIcon className="w-5 h-5" />} label="Xong" value={allCompleted} color="#3DD68C" delay={120} mounted={mounted} />
            <StatCard icon={<WaitingIcon className="w-5 h-5" />} label="Chờ nhận" value={unclaimed} color="#5BC0EB" delay={180} mounted={mounted} />
            <StatCard icon={<OrbIcon className="w-5 h-5" />} label="Orbs" value={claimableOrbs || "—"} color="#E879F9" delay={240} mounted={mounted} rainbow />
          </div>
        </MotionSection>

        {/* ─── Quest List ─── */}
        <MotionSection className="px-3 sm:px-4 lg:px-6 pb-6" delay={0.1}>
          <div className="flex items-center justify-between mb-3 mt-2">
            <div className="flex items-center gap-2">
              <h2 className="text-[14px] font-semibold text-white">Quest của tôi</h2>
              <span className="text-[11px] font-mono text-white/40">({allQuestsSorted.length})</span>
            </div>
            <div className="flex items-center gap-2">
              {workerStatus === "running" && (
                <Badge variant="gradient" className="text-[10px] h-6 gap-1 px-2">
                  <Loader2 className="w-3 h-3 animate-spin" /> {running}
                </Badge>
              )}
              <div className="flex items-center gap-0.5 p-0.5 rounded-md bg-white/[0.03] border border-white/[0.06]">
                <FilterTab active={questFilter === "all"} color={FILTER_COLORS.all} onClick={() => setQuestFilter("all")} icon={<ListFilter className="w-3.5 h-3.5" />} />
                <FilterTab active={questFilter === "video"} color={FILTER_COLORS.video} onClick={() => setQuestFilter("video")} icon={<Video className="w-3.5 h-3.5" />} />
                <FilterTab active={questFilter === "game"} color={FILTER_COLORS.game} onClick={() => setQuestFilter("game")} icon={<Gamepad2 className="w-3.5 h-3.5" />} />
              </div>
            </div>
          </div>

          {loading && quests.length === 0 ? (
            <div className="surface rounded-xl py-16 flex flex-col items-center justify-center relative overflow-hidden">
              <div className="relative">
                <div className="w-12 h-12 rounded-full border-2 border-white/[0.06] flex items-center justify-center">
                  <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#5865F2] animate-spin" />
                  <div className="absolute inset-2 rounded-full border border-transparent border-b-[#E879F9]/40 animate-spin" style={{ animationDuration: "1.6s", animationDirection: "reverse" }} />
                </div>
              </div>
              <p className="text-[13px] text-white/60 mt-4 font-medium">Đang tải nhiệm vụ...</p>
              <p className="text-[11px] text-white/30 mt-1">Vui lòng chờ trong giây lát</p>
            </div>
          ) : quests.length === 0 ? (
            <div className="surface rounded-xl py-16 flex flex-col items-center">
              <div className="w-12 h-12 rounded-xl bg-white/[0.03] border border-white/[0.06] flex items-center justify-center mb-3">
                <Trophy className="w-6 h-6 text-white/30" />
              </div>
              <p className="text-[14px] text-white/70 font-medium">Chưa có quest nào</p>
              <p className="text-[12px] text-white/40 mt-1">Nhấn Làm mới để tải quest</p>
            </div>
          ) : (
            <div className={`grid gap-2.5 sm:gap-3 lg:gap-4 ${compactMode ? "grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6" : "grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"}`}>
              {allQuestsSorted.map((q, idx) => (
                <div
                  key={q.id}
                  className={`quest-enter opacity-0`}
                  style={{ animationDelay: `${Math.min(idx * 30, 300)}ms` }}
                >
                  <QuestCard quest={q} onEnroll={() => enrollQuestAction(q.id)} actionLoading={actionLoading === q.id} compact={compactMode} />
                </div>
              ))}
            </div>
          )}
        </MotionSection>
        </>
        )}
      </div>
    </div>
  );
}

/* ─── Stat Card — compact mini ─── */
function StatCard({
  icon, label, value, color, delay, mounted, rainbow,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  color: string;
  delay: number;
  mounted: boolean;
  rainbow?: boolean;
}) {
  return (
    <div
      className={`surface rounded-lg p-2 sm:p-2.5 lg:p-3 flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-1 sm:gap-2.5 text-center sm:text-left ${mounted ? "stat-enter" : "opacity-0"}`}
      style={{ transitionDelay: `${delay}ms`, animationDelay: `${delay}ms` } as React.CSSProperties}
    >
      <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0" style={{ background: `${color}1A`, border: `1px solid ${color}30`, color }}>
        {icon}
      </div>
      <div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-1.5 min-w-0">
        <span className={`text-display text-base sm:text-lg leading-none tabular-nums ${rainbow ? "orbs-rainbow-text" : "text-white"}`}>{value}</span>
        <span className="text-[9px] sm:text-[10px] font-mono font-semibold uppercase tracking-wider leading-none mt-0.5 sm:mt-0" style={{ color }}>{label}</span>
      </div>
    </div>
  );
}

/* ─── Filter Tab ─── */
function FilterTab({ active, color, onClick, icon }: { active: boolean; color: string; onClick: () => void; icon: React.ReactNode }) {
  const rgb = hexToRgb(color);
  return (
    <button
      onClick={onClick}
      className="relative flex items-center justify-center w-7 h-7 rounded transition-all duration-150"
      style={{
        backgroundColor: active ? (rgb ? `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.15)` : "rgba(255,255,255,0.08)") : "transparent",
        color: active ? color : "#8A8F98",
      }}
    >
      {icon}
    </button>
  );
}

/* ─── Quest Card ─── */
const QuestCard = memo(function QuestCard({
  quest, onEnroll, actionLoading, compact = false,
}: {
  quest: QuestData;
  onEnroll: () => void;
  actionLoading: boolean;
  compact?: boolean;
}) {
  const statusColor = getStatusColor(quest.status, quest.isClaimed);
  const statusRgb = hexToRgb(statusColor);
  const isRunning = quest.status === "running";
  const isCompleted = quest.status === "completed";
  const isUnclaimed = quest.status === "unclaimed";
  const isExpired = quest.status === "expired";
  const isExpiredClaimed = isExpired && !!quest.completedAt && quest.isClaimed;
  const isGame = !isVideoType(quest.type);
  const expiry = formatExpires(quest.expiresAt);

  const [imgError, setImgError] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(true); // assume loaded — prevents flash on scroll
  const hideQuestBanners = useAppStore((st) => st.hideQuestBanners);
  const bannerUrl = hideQuestBanners ? undefined : quest.bannerUrl;

  const imgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (imgRef.current && imgRef.current.complete && !imgRef.current.naturalWidth) {
        setImgError(true);
      }
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const showEnrollButton = quest.status === "available" && !quest.isEnrolled;
  const questName = quest.name || "Quest";
  const gameTitle = quest.gameTitle || null;
  const typeColor = getQuestTypeColor(quest.type);

  return (
    <div
      className={`group surface rounded-xl overflow-hidden transition-[border-color] duration-200 hover:border-white/[0.14] ${isExpiredClaimed ? "opacity-60" : ""}`}
      style={{
        borderColor: isExpiredClaimed
          ? "rgba(246, 96, 111, 0.4)"
          : statusRgb ? `rgba(${statusRgb.r}, ${statusRgb.g}, ${statusRgb.b}, 0.25)` : "rgba(255, 255, 255, 0.07)",
        contain: 'layout style paint',
        height: '100%',
      }}
    >
      {/* Banner — ẩn/t hiện tức thì, không animation */}
      {!compact && (
      <div className="relative aspect-video w-full overflow-hidden bg-[#11131A]">
        <div
          className="absolute inset-0"
          style={{
            background: statusRgb
              ? `linear-gradient(135deg, rgba(${statusRgb.r}, ${statusRgb.g}, ${statusRgb.b}, 0.4) 0%, rgba(${statusRgb.r}, ${statusRgb.g}, ${statusRgb.b}, 0.15) 50%, #1a1d24 100%)`
              : "linear-gradient(135deg, rgba(138, 143, 152, 0.4) 0%, rgba(138, 143, 152, 0.15) 50%, #1a1d24 100%)",
          }}
        />
        {bannerUrl && !imgError ? (
          <img
            ref={imgRef}
            src={bannerUrl}
            alt=""
            className={`absolute inset-0 w-full h-full object-cover object-[80%_50%] transition-opacity duration-500 ease-out ${imgLoaded ? "opacity-100" : "opacity-0"}`}
            onError={() => setImgError(true)}
            onLoad={() => setImgLoaded(true)}
            loading="eager"
            decoding="async"
            fetchPriority="high"
          />
        ) : null}
        {(!bannerUrl || imgError) && (
          <div
            className="w-full h-full absolute inset-0"
            style={{
              background: statusRgb
                ? `linear-gradient(135deg, rgba(${statusRgb.r}, ${statusRgb.g}, ${statusRgb.b}, 0.2) 0%, rgba(${statusRgb.r}, ${statusRgb.g}, ${statusRgb.b}, 0.05) 40%, #11131A 100%)`
                : "linear-gradient(135deg, rgba(138, 143, 152, 0.2) 0%, rgba(138, 143, 152, 0.05) 40%, #11131A 100%)",
            }}
          >
            <div className="absolute inset-0 flex items-center justify-center opacity-25">
              <div style={{ color: statusColor }}>
                {isGame ? <Gamepad2 className="w-10 h-10" /> : <Video className="w-10 h-10" />}
              </div>
            </div>
          </div>
        )}
        {bannerUrl && !imgError && !imgLoaded && (
          <div className="absolute inset-0 bg-[#1a1d24]/30" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0A0B0E] via-transparent to-transparent" />

        {quest.logotypeLight && (
          <div className="absolute bottom-2 left-2 z-10 max-w-[65%]">
            <img
              src={quest.logotypeLight.includes('/')
                ? `https://cdn.discordapp.com/${quest.logotypeLight}`
                : `https://cdn.discordapp.com/quests/${quest.id}/assets/${quest.logotypeLight}.png`}
              alt=""
              className="relative max-h-8 w-auto object-contain"
              style={{ filter: "drop-shadow(0 0 1.5px rgba(255,255,255,0.7))" }}
              loading="lazy"
              decoding="async"
              onError={(e) => { (e.target as HTMLImageElement).parentElement!.style.display = 'none'; }}
            />
          </div>
        )}

        {isExpiredClaimed && <div className="absolute inset-0 bg-black/30" />}

        <div className="absolute top-2 left-2 z-10">
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-black/60 border border-white/10">
            {isGame ? <Gamepad2 className="w-2.5 h-2.5" style={{ color: typeColor }} /> : <Video className="w-2.5 h-2.5" style={{ color: typeColor }} />}
            <span style={{ color: typeColor }}>{getQuestTypeLabel(quest.type)}</span>
          </div>
        </div>

        <div className="absolute top-2 right-2 z-10">
          <div
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold border"
            style={{
              backgroundColor: statusRgb ? `rgba(${statusRgb.r}, ${statusRgb.g}, ${statusRgb.b}, 0.7)` : "rgba(138, 143, 152, 0.7)",
              color: "#fff",
              borderColor: statusRgb ? `rgba(${statusRgb.r}, ${statusRgb.g}, ${statusRgb.b}, 0.4)` : "rgba(138, 143, 152, 0.4)",
            }}
          >
            {isRunning ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : null}
            {isExpiredClaimed ? "Đã nhận" :
             isUnclaimed ? "Chờ nhận" :
             isCompleted ? (quest.isClaimed ? "Đã nhận" : "Chờ nhận") :
             isRunning ? "Đang chạy" :
             quest.isEnrolled ? "Hàng chờ" :
             "Chờ nhận"}
          </div>
        </div>

        <a
          href={`https://discord.com/quests/${quest.id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute bottom-2 right-2 z-10 w-7 h-7 rounded-md bg-black/50 border border-white/10 flex items-center justify-center text-white/60 hover:text-white hover:bg-black/70 transition-colors"
          title="Mở trên Discord"
          onClick={(e) => e.stopPropagation()}
        >
          <ExternalLink className="w-3.5 h-3.5" />
        </a>
      </div>
      )}

      <div className="relative p-2.5 sm:p-3 flex flex-col gap-1.5">
        <h3 className="text-[12px] sm:text-[13px] font-semibold text-white leading-tight line-clamp-1" style={{ overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
          {questName}
        </h3>
        <p className="text-[11px] text-white/40 leading-tight line-clamp-1">{gameTitle || "—"}</p>

        {quest.reward && quest.reward !== "Unknown" && (
          <div className="flex items-center gap-1 text-[11px] min-w-0">
            {quest.rewardIconUrl ? (
              <img
                src={quest.rewardIconUrl}
                alt=""
                className="w-3.5 h-3.5 shrink-0 rounded-[3px] object-contain"
                loading="lazy"
                decoding="async"
              />
            ) : (
              <OrbIcon className="w-3 h-3 shrink-0" />
            )}
            <span className="text-[#E879F9] font-medium truncate">{quest.reward}</span>
          </div>
        )}

        <div className="flex items-center gap-1.5 text-[11px]">
          <Clock className="w-3 h-3 text-white/30" />
          <span style={{ color: expiry.color }}>{expiry.text}</span>
        </div>

        <div className="relative h-1 bg-white/[0.06] rounded-full overflow-hidden mt-1">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${isCompleted || isUnclaimed ? 100 : Math.max(0, quest.progress)}%`,
              backgroundColor: statusRgb ? `rgb(${statusRgb.r}, ${statusRgb.g}, ${statusRgb.b})` : statusColor,
              boxShadow: isRunning && statusRgb ? `0 0 6px rgba(${statusRgb.r}, ${statusRgb.g}, ${statusRgb.b}, 0.5)` : undefined,
            }}
          />
        </div>
      </div>
    </div>
  );
});
