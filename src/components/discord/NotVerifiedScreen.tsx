"use client";
import { useAppStore } from "@/lib/store";
import { Mail, LogOut, ShieldAlert, ArrowRight, Loader2 } from "lucide-react";
import { useState } from "react";

export default function NotVerifiedScreen() {
  const { logout, profile } = useAppStore();
  const [loggingOut, setLoggingOut] = useState(false);
  const handleLogout = async () => {
    setLoggingOut(true);
    try { await new Promise((r) => setTimeout(r, 600)); logout(); } catch { logout(); }
  };
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 py-12 sm:py-20 relative overflow-hidden min-h-[100dvh]">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-1/4 left-1/3 w-[50vw] h-[50vw] rounded-full gpu-layer" style={{ background: "radial-gradient(circle, rgba(246,96,111,0.18) 0%, transparent 65%)" }} />
        <div className="absolute bottom-1/4 right-1/4 w-[40vw] h-[40vw] rounded-full gpu-layer" style={{ background: "radial-gradient(circle, rgba(245,181,68,0.10) 0%, transparent 65%)" }} />
      </div>
      <div className="relative surface rounded-2xl p-6 sm:p-8 lg:p-10 max-w-md w-full flex flex-col items-center animate-scale-in" style={{ boxShadow: "0 32px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(246,96,111,0.12)", background: "linear-gradient(180deg, #13151A 0%, #0F1115 100%)" }}>
        <div className="relative mb-6">
          <div className="absolute -inset-3 rounded-2xl opacity-50 gpu-layer pointer-events-none" style={{ background: "radial-gradient(circle, rgba(246,96,111,0.45) 0%, transparent 70%)", animation: "icon-glow 2s ease-in-out infinite" }} />
          <div className="absolute -inset-1 rounded-2xl opacity-90 gpu-layer pointer-events-none" style={{ background: "conic-gradient(from 0deg, #F6606F, #F5B544, #F6606F)", animation: "gradient-rotate 4s linear infinite", mask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)", WebkitMask: "linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)", WebkitMaskComposite: "xor", maskComposite: "exclude", padding: "2px" }} />
          <div className="relative w-20 h-20 sm:w-24 sm:h-24 rounded-2xl flex items-center justify-center border border-white/[0.08]" style={{ background: "linear-gradient(135deg, #1a1416 0%, #13151A 100%)" }}>
            <ShieldAlert className="w-10 h-10 sm:w-12 sm:h-12 text-[#F6606F]" />
          </div>
        </div>
        <h2 className="text-display text-2xl sm:text-3xl text-white tracking-tight mb-2">Tài khoản chưa xác minh</h2>
        {profile?.username && <p className="text-sm text-white/40 mb-4 font-mono">{profile.global_name || profile.username}</p>}
        <p className="text-[13px] sm:text-sm text-white/55 text-center mb-6 leading-relaxed max-w-sm">Token chưa xác minh không thể sử dụng dịch vụ. Vui lòng xác minh email Discord để bắt đầu làm quest.</p>
        <div className="w-full mb-6 px-3.5 py-3 rounded-xl bg-[#F5B544]/[0.06] border border-[#F5B544]/15">
          <p className="text-[11px] font-semibold text-[#F5B544] mb-2 flex items-center gap-1.5"><Mail className="w-3.5 h-3.5" />Yêu cầu xác minh Email</p>
          <ol className="space-y-1.5 text-[11px] text-white/55 leading-relaxed">
            <li className="flex gap-2"><span className="text-[#F5B544] font-bold shrink-0">1.</span><span>Mở Discord → User Settings</span></li>
            <li className="flex gap-2"><span className="text-[#F5B544] font-bold shrink-0">2.</span><span>My Account → Verify Email</span></li>
            <li className="flex gap-2"><span className="text-[#F5B544] font-bold shrink-0">3.</span><span>Đăng nhập lại vào đây sau khi xác minh</span></li>
          </ol>
        </div>
        <button onClick={handleLogout} disabled={loggingOut} className="group relative w-full inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl btn-sweep font-semibold text-sm transition-all hover:shadow-lg hover:shadow-[#F6606F]/30 disabled:opacity-50 disabled:cursor-not-allowed" style={{ background: "linear-gradient(135deg, #F6606F 0%, #C73E50 100%)", color: "#fff", boxShadow: "0 12px 32px rgba(246,96,111,0.4)" }}>
          {loggingOut ? <><Loader2 className="w-4 h-4 animate-spin" />Đang đăng xuất...</> : <><LogOut className="w-4 h-4" />Đăng xuất<ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" /></>}
        </button>
        <p className="text-[10px] text-white/30 mt-4 text-center font-mono">Sau khi xác minh email Discord, đăng nhập lại để sử dụng</p>
      </div>
    </div>
  );
}
