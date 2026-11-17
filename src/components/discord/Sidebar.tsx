"use client";

import { motion } from "framer-motion";
import { useAppStore, type DiscordProfile } from "@/lib/store";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Settings,
  LogOut,
  LayoutDashboard,
  X,
  EyeOff,
  Lock,
  Zap,
  ChevronRight,
  Puzzle,
} from "lucide-react";
import { layoutSpring } from "@/lib/motion";

function getAvatarUrl(profile: DiscordProfile | null) {
  if (!profile) return "";
  if (profile.avatar) {
    return `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png?size=128`;
  }
  const disc = profile.discriminator || "0";
  const index = disc === "0" ? (parseInt(profile.id) % 5) : (parseInt(disc) % 5);
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

/* ─── Status metadata — uses new dot-* utility classes ─── */
function getStatusMeta(status: string) {
  switch (status) {
    case "running": return { color: "#F5B544", label: "Đang chạy", dot: "dot-warning", pulse: true };
    case "idle":    return { color: "#8A8F98", label: "Chờ",       dot: "dot-idle",    pulse: false };
    case "error":   return { color: "#F6606F", label: "Lỗi",       dot: "dot-danger",  pulse: true };
    default:        return { color: "#3DD68C", label: "Sẵn sàng",  dot: "dot-success", pulse: false };
  }
}

/* ─── Nav Item — Linear-style (new source) ─── */
function NavItem({
  icon,
  label,
  active,
  onClick,
  locked,
  accentColor,
  shortcut,
  index = 0,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  locked?: boolean;
  accentColor?: string;
  shortcut?: string;
  index?: number;
}) {
  const color = accentColor || "#5865F2";

  return (
    <button
      onClick={onClick}
      className={`group relative w-full flex items-center gap-2.5 pl-2.5 pr-2 py-2 rounded-md text-[13px] font-medium transition-all duration-200 ${
        active ? "" : "hover:bg-white/[0.04] text-white/70 hover:text-white"
      }`}
      style={{
        backgroundImage: active ? `linear-gradient(90deg, ${color}1F 0%, ${color}08 100%)` : undefined,
        color: active ? color : undefined,
        boxShadow: active ? `inset 0 0 0 1px ${color}33, 0 0 16px ${color}1A` : undefined,
        animation: `slide-in-left 200ms ease-out ${index * 30}ms both`,
      }}
    >
      {/* Active left bar — framer-motion `layout` slides the bar between
          items when the active page changes. Single shared layoutId so
          framer-motion reuses the same element across renders. */}
      {active && (
        <motion.div
          layoutId="sidebar-active-bar"
          className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 rounded-r-full pointer-events-none"
          style={{
            backgroundColor: color,
            boxShadow: `0 0 8px ${color}80`,
          }}
          transition={layoutSpring}
          // initial={false} prevents the bar from animating on first mount
          // (no slide-in when the sidebar first opens).
          initial={false}
        />
      )}

      {/* Icon */}
      <div
        className="flex items-center justify-center w-5 h-5 shrink-0 transition-transform duration-150 group-hover:scale-110"
        style={{ color: active ? color : undefined }}
      >
        {icon}
      </div>

      {/* Label */}
      <span className="flex-1 text-left truncate">{label}</span>

      {/* Right: lock / shortcut */}
      {locked ? (
        <Lock className="w-3 h-3 text-white/30 shrink-0" />
      ) : shortcut ? (
        <span className="kbd opacity-0 group-hover:opacity-100 transition-opacity">{shortcut}</span>
      ) : null}
    </button>
  );
}

/* ─── Section Label — Linear-style with horizontal divider ─── */
function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 px-2.5 pt-4 pb-1.5">
      <span className="text-[10px] font-semibold text-white/30 uppercase tracking-[0.12em]">{children}</span>
      <div className="flex-1 h-px bg-white/[0.04]" />
    </div>
  );
}

export default function Sidebar() {
  const { profile, workerStatus, page, sidebarOpen, isVerified, isGuildMember, setSidebarOpen, setPage, logout } = useAppStore();
  const statusMeta = getStatusMeta(workerStatus);

  return (
    <>
      {/* Mobile overlay — CSS-only fade */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/70 backdrop-blur-md z-40 lg:hidden"
          style={{ animation: "sidebar-overlay-in 0.4s ease-out both" }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside
        className={`fixed lg:static inset-y-0 left-0 z-50 w-[260px] bg-[#0D0E12] border-r border-white/[0.06] flex flex-col shrink-0 transition-transform duration-500 ease-out lg:transition-none contain-section ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        }`}
      >
        {/* ─── Header (mobile close only — no logo) ─── */}
        <div className="lg:hidden p-3 border-b border-white/[0.06] flex justify-end">
          <Button
            variant="ghost"
            size="icon"
            className="text-white/50 hover:text-white h-7 w-7"
            onClick={() => setSidebarOpen(false)}
            style={{ animation: "sidebar-item-in 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.15s both" }}
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* ─── User card ─── */}
        <div
          className="p-3 border-b border-white/[0.06] lg:!opacity-100 lg:!translate-x-0"
          style={sidebarOpen ? { animation: "sidebar-item-in 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.1s both" } : undefined}
        >
          <div className="flex items-center gap-2.5 p-2 rounded-lg bg-white/[0.025] border border-white/[0.04]">
            {/* Avatar */}
            <div className="relative shrink-0">
              {workerStatus === "running" && (
                <div
                  className="absolute -inset-[2px] rounded-full opacity-60 pointer-events-none"
                  style={{
                    background: `conic-gradient(from 0deg, transparent, ${statusMeta.color}, transparent)`,
                    animation: "spin 3s linear infinite",
                  }}
                />
              )}
              <Avatar className="w-8 h-8 rounded-md border border-white/[0.1] relative">
                <AvatarImage src={getAvatarUrl(profile)} className="rounded-md" />
                <AvatarFallback className="bg-[#5865F2]/15 text-[#5865F2] text-[11px] font-semibold rounded-md">
                  {profile?.username?.slice(0, 2)?.toUpperCase() || "??"}
                </AvatarFallback>
              </Avatar>
            </div>
            {/* Info */}
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-semibold text-white truncate leading-tight">
                {profile?.global_name || profile?.username || "Unknown"}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className={`dot ${statusMeta.dot} ${statusMeta.pulse ? "dot-pulse" : ""}`} style={{ width: 6, height: 6 }} />
                <span className="text-[10px] text-white/50">{statusMeta.label}</span>
              </div>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-white/30" />
          </div>
        </div>

        {/* ─── Navigation ─── */}
        <ScrollArea className="flex-1 relative">
          <div className="p-2">
            <SectionLabel>Chính</SectionLabel>
            <div className="space-y-0.5">
              <div style={sidebarOpen ? { animation: "sidebar-item-in 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.2s both" } : undefined}>
                <NavItem
                  icon={<LayoutDashboard className="w-4 h-4" />}
                  label="Dashboard"
                  active={page === "dashboard"}
                  onClick={() => { setPage("dashboard"); setSidebarOpen(false); }}
                  accentColor="#5865F2"
                  shortcut="D"
                  index={0}
                />
              </div>
              {isVerified && (
                <div style={sidebarOpen ? { animation: "sidebar-item-in 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.25s both" } : undefined}>
                  <NavItem
                    icon={<EyeOff className="w-4 h-4" />}
                    label="Quest ẩn"
                    active={page === "hidden"}
                    onClick={() => {
                      if (workerStatus === "running") return;
                      setPage("hidden");
                      setSidebarOpen(false);
                    }}
                    locked={!isGuildMember}
                    accentColor="#E879F9"
                    shortcut="H"
                    index={1}
                  />
                </div>
              )}
            </div>

            <SectionLabel>Chung</SectionLabel>
            <div className="space-y-0.5">
              <div style={sidebarOpen ? { animation: "sidebar-item-in 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.35s both" } : undefined}>
                <NavItem
                  icon={<Puzzle className="w-4 h-4" />}
                  label="Extension"
                  active={page === "extension"}
                  onClick={() => { setPage("extension"); setSidebarOpen(false); }}
                  accentColor="#3DD68C"
                  shortcut="E"
                  index={2}
                />
              </div>
              <div style={sidebarOpen ? { animation: "sidebar-item-in 0.5s cubic-bezier(0.16, 1, 0.3, 1) 0.4s both" } : undefined}>
                <NavItem
                  icon={<Settings className="w-4 h-4" />}
                  label="Cài đặt"
                  active={page === "settings"}
                  onClick={() => { setPage("settings"); setSidebarOpen(false); }}
                  accentColor="#8A8F98"
                  shortcut="S"
                  index={3}
                />
              </div>
            </div>

            {/* Running indicator */}
            {workerStatus === "running" && (
              <div className="mt-3 p-2.5 rounded-lg bg-[#F5B544]/[0.08] border border-[#F5B544]/20 flex items-center gap-2">
                <Zap className="w-3.5 h-3.5 text-[#F5B544]" fill="currentColor" />
                <span className="text-[11px] font-medium text-[#F5B544]/90">Quest đang chạy</span>
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-[#F5B544] animate-pulse" />
              </div>
            )}

            {/* NO Kanda credit — removed per user requirement */}
          </div>
        </ScrollArea>

        {/* ─── Bottom: Logout ─── */}
        <div className="p-2 border-t border-white/[0.06]">
          <button
            onClick={logout}
            className="group w-full flex items-center gap-2.5 px-2.5 py-2 rounded-md text-[13px] font-medium text-white/60 hover:text-[#F6606F] hover:bg-[#F6606F]/[0.08] transition-all duration-150"
          >
            <div className="flex items-center justify-center w-5 h-5">
              <LogOut className="w-4 h-4" />
            </div>
            <span>Đăng xuất</span>
            <span className="ml-auto kbd opacity-0 group-hover:opacity-100 transition-opacity">⌫</span>
          </button>
        </div>
      </aside>

      <style jsx>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes slide-in-left {
          0% { opacity: 0; transform: translateX(-6px); }
          100% { opacity: 1; transform: translateX(0); }
        }
        @keyframes sidebar-overlay-in {
          0% { opacity: 0; backdrop-filter: blur(0px); }
          100% { opacity: 1; backdrop-filter: blur(12px); }
        }
        @keyframes sidebar-item-in {
          0% { opacity: 0; transform: translateX(-24px); }
          60% { opacity: 1; }
          100% { opacity: 1; transform: translateX(0); }
        }
        @media (min-width: 1024px) {
          .sidebar-panel {
            transform: translateX(0) !important;
          }
        }
      `}</style>
    </>
  );
}
