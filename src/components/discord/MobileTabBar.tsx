"use client";
import { motion } from "framer-motion";
import { LayoutDashboard, EyeOff, Settings, Puzzle } from "lucide-react";
import type { LucideIcon } from "lucide-react";

type TabDef = {
  id: "dashboard" | "hidden" | "settings" | "extension";
  label: string;
  icon: LucideIcon;
  color: string;
};

const ALL_TABS: TabDef[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, color: "#E879F9" },
  { id: "hidden", label: "Quest ẩn", icon: EyeOff, color: "#5E6AD2" },
  { id: "extension", label: "Extension", icon: Puzzle, color: "#3DD68C" },
  { id: "settings", label: "Cài đặt", icon: Settings, color: "#8A8F98" },
];

export default function MobileTabBar({
  page,
  setPage,
  isVerified,
  workerStatus,
}: {
  page: "dashboard" | "hidden" | "settings" | "extension";
  setPage: (p: "dashboard" | "hidden" | "settings" | "extension") => void;
  isVerified: boolean;
  workerStatus: "idle" | "running" | "error";
}) {
  const tabs = ALL_TABS.filter((t) => t.id === "dashboard" || t.id === "settings" || t.id === "extension" || isVerified);
  return (
    <nav className="lg:hidden shrink-0 z-50 glass-mobile-solid border-t border-white/[0.08]" aria-label="Điều hướng mobile">
      <div className="absolute top-0 left-0 right-0 h-px pointer-events-none" style={{ background: "linear-gradient(90deg, transparent 10%, rgba(232, 121, 249,0.35) 30%, rgba(94, 106, 210,0.35) 50%, rgba(56, 189, 248,0.35) 70%, transparent 90%)" }} />
      <div className="flex items-stretch justify-around px-2 pt-2 pb-2" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 8px)" }}>
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = page === tab.id;
          const blocked = tab.id === "hidden" && workerStatus === "running";
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                if (blocked) return;
                setPage(tab.id);
              }}
              className="relative flex flex-col items-center justify-center gap-1 px-2 py-1.5 flex-1 min-w-0 rounded-xl"
              aria-current={active ? "page" : undefined}
              aria-label={tab.label}
              style={blocked ? { opacity: 0.4 } : undefined}
            >
              {active && (
                <motion.div layoutId="mobile-active-tab" className="absolute inset-0 rounded-xl pointer-events-none" style={{ background: `${tab.color}22`, border: `1px solid ${tab.color}55`, boxShadow: `0 0 14px ${tab.color}33, inset 0 1px 0 rgba(255,255,255,0.08)` }} transition={{ type: "spring", stiffness: 380, damping: 30 }} />
              )}
              <Icon className="w-5 h-5 relative z-10" style={{ color: active ? tab.color : "#8A8F98" }} />
              <span className="text-[10px] font-medium relative z-10 truncate tracking-[-0.005em]" style={{ color: active ? tab.color : "#8A8F98" }}>{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
