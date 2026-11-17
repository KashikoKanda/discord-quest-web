"use client";

import { useAppStore } from "@/lib/store";
import { LayoutDashboard } from "lucide-react";
import { MotionSection } from "@/components/discord/MotionSection";

export default function ExtensionPage() {
  const { setSidebarOpen, setPage } = useAppStore();

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 w-full relative bg-[#0A0B0E]">
      {/* Top bar */}
      <header className="h-12 lg:h-14 shrink-0 flex items-center justify-between px-3 sm:px-4 lg:px-6 border-b border-white/[0.06] bg-[#0A0B0E]/80 backdrop-blur-xl relative z-30">
        <div className="flex items-center gap-2">
          <h1 className="text-display text-base lg:text-lg text-white tracking-[-0.01em]">Extension</h1>
          <span className="hidden sm:inline text-[11px] font-mono text-white/30">/extension</span>
        </div>
      </header>

      {/* Scrollable */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide relative">

        {/* ─── Extension locked — clean & beautiful ─── */}
        <MotionSection>
          <div className="flex flex-col items-center justify-center px-4 py-10 sm:py-14 relative overflow-hidden">
            {/* Aurora background */}
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute top-1/4 left-1/4 w-[45vw] h-[45vw] rounded-full gpu-layer" style={{ background: "radial-gradient(circle, rgba(245,181,68,0.14) 0%, transparent 60%)", animation: "aurora-drift-1 8s ease-in-out infinite alternate" }} />
              <div className="absolute bottom-1/4 right-1/4 w-[40vw] h-[40vw] rounded-full gpu-layer" style={{ background: "radial-gradient(circle, rgba(232,121,249,0.10) 0%, transparent 60%)", animation: "aurora-drift-2 10s ease-in-out infinite alternate" }} />
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[35vw] h-[35vw] rounded-full gpu-layer" style={{ background: "radial-gradient(circle, rgba(88,101,242,0.06) 0%, transparent 60%)", animation: "aurora-drift-1 12s ease-in-out infinite alternate-reverse" }} />
            </div>

            {/* Main card */}
            <div className="relative surface rounded-2xl p-8 sm:p-10 max-w-md w-full flex flex-col items-center" style={{ boxShadow: "0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(245,181,68,0.12)" }}>
              {/* Lock icon — bigger, more glow */}
              <div className="relative w-28 h-28 sm:w-36 sm:h-36 mb-6">
                {/* Outer glow */}
                <div className="absolute inset-0 rounded-full gpu-layer" style={{ background: "radial-gradient(circle, rgba(245,181,68,0.42) 0%, transparent 65%)", animation: "icon-glow 2.5s ease-in-out infinite" }} />
                {/* Shimmer sweep */}
                <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-full">
                  <div className="absolute -inset-full" style={{ background: "linear-gradient(110deg, transparent 35%, rgba(255,255,255,0.12) 50%, transparent 65%)", backgroundSize: "200% 100%", animation: "shimmer-sweep 3s linear infinite" }} />
                </div>
                {/* Lock icon */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/lock-icon.png" alt="Locked" className="relative w-full h-full object-contain p-1" style={{ filter: "drop-shadow(0 0 16px rgba(245,181,68,0.5)) drop-shadow(0 4px 12px rgba(0,0,0,0.6))" }} />
              </div>

              {/* Message — bigger, more prominent */}
              <h3 className="text-display text-xl sm:text-2xl text-white mb-2 tracking-tight text-center font-semibold">
                Extension đang trong quá trình phát triển
              </h3>

              <p className="text-[12px] sm:text-[13px] text-white/40 text-center leading-relaxed mb-7 max-w-[280px]">
                Sẽ sớm trở lại với trải nghiệm tốt nhất
              </p>

              {/* CTA Button */}
              <button
                onClick={() => { setPage("dashboard"); setSidebarOpen(false); }}
                className="group relative inline-flex items-center gap-2 px-6 py-3 rounded-xl btn-sweep font-semibold text-sm transition-all hover:shadow-lg hover:shadow-[#F5B544]/25 w-full justify-center"
                style={{ background: "linear-gradient(135deg, #F5B544 0%, #E0A030 100%)", color: "#1a1416", boxShadow: "0 8px 24px rgba(245,181,68,0.3)" }}
              >
                <LayoutDashboard className="w-4 h-4" />
                Về Dashboard
                <svg className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
              </button>
            </div>
          </div>
        </MotionSection>

      </div>
    </div>
  );
}
