"use client";

import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import {
  Globe, Plus, Trash2, Loader2, CheckCircle2, XCircle,
  AlertTriangle, ExternalLink, X, Server,
} from "lucide-react";
import { useState, useEffect, useCallback, useRef } from "react";

interface UserProxyRow {
  id: string;
  raw: string;
  protocol: string;
  host: string;
  port: number;
  user: string;
  countryCode: string | null;
  createdAt: string;
}

/* ─── Animated Section Wrapper ─── */
function AnimatedSection({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 60 + delay);
    return () => clearTimeout(t);
  }, [delay]);

  return (
    <div
      className={`transition-all duration-500 ease-out ${
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
      }`}
    >
      {children}
    </div>
  );
}

/* ─── Country Flag (image via flagcdn — works on all platforms) ─── */
function CountryFlag({ code, size = 32 }: { code: string | null; size?: number }) {
  const [errored, setErrored] = useState(false);

  if (!code || code.length !== 2 || errored) {
    return (
      <div
        className="rounded-md bg-white/[0.06] flex items-center justify-center shrink-0"
        style={{ width: size, height: Math.round(size * 0.75) }}
      >
        <Globe className="text-[#8A8F98]" style={{ width: size * 0.5, height: size * 0.5 }} />
      </div>
    );
  }

  return (
    <img
      src={`https://flagcdn.com/w80/${code.toLowerCase()}.png`}
      srcSet={`https://flagcdn.com/w160/${code.toLowerCase()}.png 2x`}
      width={size}
      height={Math.round(size * 0.75)}
      alt={`${code} flag`}
      loading="lazy"
      onError={() => setErrored(true)}
      className="rounded-md object-cover shrink-0 border border-white/[0.08]"
      style={{ width: size, height: Math.round(size * 0.75) }}
    />
  );
}

export default function Proxy() {
  const { profile, setSidebarOpen } = useAppStore();
  const userId = profile?.id || "";

  const [proxies, setProxies] = useState<UserProxyRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [rawInput, setRawInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error" | "info"; msg: string; invalidLines?: string[] } | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const feedbackTimer = useRef<NodeJS.Timeout | null>(null);

  const showFeedback = useCallback((type: "success" | "error" | "info", msg: string, invalidLines?: string[]) => {
    setFeedback({ type, msg, invalidLines });
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(null), 6000);
  }, []);

  const loadProxies = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/proxy?userId=${encodeURIComponent(userId)}`);
      const data = await res.json();
      if (data.success) {
        setProxies(data.proxies);
      } else {
        showFeedback("error", data.error || "Không tải được danh sách proxy");
      }
    } catch {
      showFeedback("error", "Lỗi kết nối khi tải proxy");
    }
    setLoading(false);
  }, [userId, showFeedback]);

  useEffect(() => {
    if (userId) {
      const id = requestAnimationFrame(() => loadProxies());
      return () => cancelAnimationFrame(id);
    }
  }, [userId, loadProxies]);

  const handleAdd = async () => {
    if (!userId || !rawInput.trim()) return;
    setAdding(true);
    try {
      const lines = rawInput
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      const res = await fetch("/api/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, proxies: lines }),
      });
      const data = await res.json();

      if (data.success) {
        const parts: string[] = [];
        parts.push(`Đã thêm ${data.added} proxy`);
        if (data.duplicates > 0) parts.push(`${data.duplicates} trùng lặp`);
        if (data.invalid > 0) parts.push(`${data.invalid} không hợp lệ`);
        showFeedback(data.invalid > 0 ? "info" : "success", parts.join(" • "), data.invalidLines);
        setRawInput("");
        await loadProxies();
      } else {
        showFeedback("error", data.error || "Thêm proxy thất bại");
      }
    } catch {
      showFeedback("error", "Lỗi kết nối khi thêm proxy");
    }
    setAdding(false);
  };

  const handleDelete = async (proxyId: string) => {
    if (!userId) return;
    try {
      const res = await fetch("/api/proxy", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, proxyId }),
      });
      const data = await res.json();
      if (data.success) {
        await loadProxies();
      } else {
        showFeedback("error", data.error || "Xoá thất bại");
      }
    } catch {
      showFeedback("error", "Lỗi kết nối khi xoá proxy");
    }
  };

  const handleDeleteAll = async () => {
    if (!userId) return;
    if (!confirmDeleteAll) {
      setConfirmDeleteAll(true);
      setTimeout(() => setConfirmDeleteAll(false), 3000);
      return;
    }
    setConfirmDeleteAll(false);
    try {
      const res = await fetch("/api/proxy", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, all: true }),
      });
      const data = await res.json();
      if (data.success) {
        showFeedback("success", `Đã xoá ${data.deleted} proxy`);
        setProxies([]);
      } else {
        showFeedback("error", data.error || "Xoá tất cả thất bại");
      }
    } catch {
      showFeedback("error", "Lỗi kết nối khi xoá tất cả");
    }
  };

  // Group proxies by country for display
  const byCountry: Record<string, UserProxyRow[]> = {};
  for (const p of proxies) {
    const key = p.countryCode || "Khác";
    if (!byCountry[key]) byCountry[key] = [];
    byCountry[key].push(p);
  }

  return (
    <div className="flex-1 flex flex-col h-full min-h-0 w-full bg-[#0A0B0E]">
      {/* Header */}
      <header className="h-12 lg:h-14 shrink-0 flex items-center justify-between px-3 sm:px-4 lg:px-6 border-b border-white/[0.06] bg-[#0A0B0E]/80 backdrop-blur-xl relative z-30">
        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-2">
            <div className="relative w-7 h-7 rounded-lg flex items-center justify-center" style={{
              background: "linear-gradient(135deg, #3DD68C 0%, #5BC0EB 100%)",
              boxShadow: "0 2px 8px rgba(61, 214, 140, 0.35)",
            }}>
              <Globe className="w-3.5 h-3.5 text-white" />
            </div>
            <h1 className="text-display text-base lg:text-lg text-white tracking-[-0.01em]">Proxy</h1>
            <span className="hidden sm:inline text-[11px] font-mono text-white/30">/proxy</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {proxies.length > 0 && (
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-[#3DD68C]/[0.08] border border-[#3DD68C]/20">
              <span className="dot dot-success" style={{ width: 6, height: 6 }} />
              <span className="text-[11px] font-mono text-white/60">{proxies.length} proxy • {Object.keys(byCountry).length} quốc gia</span>
            </div>
          )}
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-hide">
        <div className="p-3 sm:p-5 lg:p-6 space-y-3 lg:space-y-4 max-w-3xl mx-auto">

          {/* Feedback banner */}
          {feedback && (
            <div
              className={`flex items-start gap-2.5 py-3 px-3.5 rounded-xl border ${
                feedback.type === "success"
                  ? "bg-[#3DD68C]/5 border-[#3DD68C]/15"
                  : feedback.type === "error"
                  ? "bg-[#F6606F]/5 border-[#F6606F]/15"
                  : "bg-[#F5B544]/5 border-[#F5B544]/15"
              }`}
            >
              {feedback.type === "success" ? (
                <CheckCircle2 className="w-4 h-4 text-[#3DD68C] mt-0.5 shrink-0" />
              ) : feedback.type === "error" ? (
                <XCircle className="w-4 h-4 text-[#F6606F] mt-0.5 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 text-[#F5B544] mt-0.5 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p
                  className={`text-xs font-medium ${
                    feedback.type === "success"
                      ? "text-[#3DD68C]"
                      : feedback.type === "error"
                      ? "text-[#F6606F]"
                      : "text-[#F5B544]"
                  }`}
                >
                  {feedback.msg}
                </p>
                {feedback.invalidLines && feedback.invalidLines.length > 0 && (
                  <div className="mt-2 space-y-1">
                    <p className="text-[10px] text-white/40">Dòng bị từ chối:</p>
                    <div className="max-h-32 overflow-y-auto space-y-1">
                      {feedback.invalidLines.map((line, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-[10px] font-mono text-[#F6606F]/80 bg-[#F6606F]/5 px-2 py-1 rounded">
                          <X className="w-3 h-3 shrink-0" />
                          <span className="truncate">{line}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <button
                onClick={() => setFeedback(null)}
                className="shrink-0 text-white/40 hover:text-white transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* ═══════════════════ Add Proxy Form ═══════════════════ */}
          <AnimatedSection delay={0}>
            <div className="surface rounded-2xl overflow-hidden">
              {/* Section Header */}
              <div className="px-4 sm:px-6 py-3 border-b border-white/[0.04] flex items-center gap-2">
                <div className="w-7 h-7 rounded-md flex items-center justify-center bg-[#3DD68C]/12 border border-[#3DD68C]/20">
                  <Plus className="w-3.5 h-3.5 text-[#3DD68C]" />
                </div>
                <h3 className="text-[13px] font-semibold text-white">Thêm Proxy</h3>
              </div>

              <div className="p-4 sm:p-5 space-y-3">
                {/* Owlproxy link button */}
                <a
                  href="https://proxy.owlproxy.com/proxy/extract"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group relative w-full flex items-center gap-3 rounded-xl overflow-hidden transition-all duration-300 active:scale-[0.99] btn-sweep"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-[#5865F2]/12 via-[#5865F2]/6 to-[#5865F2]/12 group-hover:from-[#5865F2]/20 group-hover:via-[#5865F2]/10 group-hover:to-[#5865F2]/20 transition-all duration-300" />
                  <div className="absolute inset-0 rounded-xl border border-[#5865F2]/20 group-hover:border-[#5865F2]/35 transition-colors duration-300" />
                  <div className="relative flex items-center gap-3 w-full py-3 px-4">
                    <div className="w-7 h-7 rounded-lg bg-[#5865F2]/15 flex items-center justify-center shrink-0">
                      <ExternalLink className="w-3.5 h-3.5 text-[#5865F2]" />
                    </div>
                    <div className="flex-1 text-left min-w-0">
                      <p className="text-xs font-semibold text-[#5865F2]">Lấy Proxy từ OwlProxy</p>
                      <p className="text-[10px] text-white/40 truncate font-mono">proxy.owlproxy.com/proxy/extract</p>
                    </div>
                    <ExternalLink className="w-3.5 h-3.5 text-[#5865F2]/60 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform duration-200 shrink-0" />
                  </div>
                </a>

                {/* Textarea for bulk add */}
                <textarea
                  value={rawInput}
                  onChange={(e) => setRawInput(e.target.value)}
                  placeholder="Dán proxy vào đây..."
                  rows={5}
                  className="w-full bg-black/30 rounded-xl px-3.5 py-3 text-[11px] lg:text-xs text-white placeholder:text-white/30 border border-white/[0.06] focus:border-[#3DD68C]/30 focus:outline-none transition-colors font-mono resize-y min-h-[100px]"
                />

                {/* Add button */}
                <button
                  onClick={handleAdd}
                  disabled={!rawInput.trim() || adding}
                  className="w-full group relative rounded-xl overflow-hidden transition-all duration-300 active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed btn-sweep"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-[#3DD68C]/12 via-[#3DD68C]/6 to-[#3DD68C]/12 group-hover:from-[#3DD68C]/20 group-hover:via-[#3DD68C]/10 group-hover:to-[#3DD68C]/20 transition-all duration-300" />
                  <div className="absolute inset-0 rounded-xl border border-[#3DD68C]/20 group-hover:border-[#3DD68C]/35 transition-colors duration-300" />
                  <div className="relative flex items-center justify-center gap-2.5 py-3">
                    {adding ? (
                      <Loader2 className="w-4 h-4 text-[#3DD68C] animate-spin" />
                    ) : (
                      <Plus className="w-4 h-4 text-[#3DD68C]" />
                    )}
                    <span className="text-sm font-semibold text-[#3DD68C]">
                      {adding ? "Đang thêm..." : "Thêm Proxy"}
                    </span>
                  </div>
                </button>
              </div>
            </div>
          </AnimatedSection>

          {/* ═══════════════════ Proxy List ═══════════════════ */}
          <AnimatedSection delay={80}>
            <div className="surface rounded-2xl overflow-hidden">
              {/* Section Header */}
              <div className="px-4 sm:px-6 py-3 border-b border-white/[0.04] flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-md flex items-center justify-center bg-[#5865F2]/12 border border-[#5865F2]/20">
                    <Server className="w-3.5 h-3.5 text-[#5865F2]" />
                  </div>
                  <h3 className="text-[13px] font-semibold text-white">Kho Proxy</h3>
                </div>
                {proxies.length > 0 && (
                  <button
                    onClick={handleDeleteAll}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] lg:text-[11px] font-semibold transition-all duration-200 ${
                      confirmDeleteAll
                        ? "bg-[#F6606F]/15 text-[#F6606F] border border-[#F6606F]/30"
                        : "bg-[#F6606F]/5 text-[#F6606F]/70 border border-[#F6606F]/10 hover:bg-[#F6606F]/10 hover:text-[#F6606F]"
                    }`}
                  >
                    <Trash2 className="w-3 h-3" />
                    {confirmDeleteAll ? "Nhấn lần nữa để xoá tất cả" : "Xoá tất cả"}
                  </button>
                )}
              </div>

              {/* Loading state */}
              {loading && (
                <div className="p-8 flex flex-col items-center gap-3">
                  <div className="relative">
                    <div className="w-10 h-10 rounded-full border-2 border-white/[0.06] flex items-center justify-center">
                      <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-[#5865F2] animate-spin" />
                    </div>
                  </div>
                  <p className="text-xs text-white/40 font-mono">Đang tải...</p>
                </div>
              )}

              {/* Empty state */}
              {!loading && proxies.length === 0 && (
                <div className="p-8 flex flex-col items-center gap-3 text-center">
                  <div className="w-12 h-12 rounded-xl bg-white/[0.04] border border-white/[0.06] flex items-center justify-center">
                    <Globe className="w-6 h-6 text-white/30" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-white">Chưa có proxy nào</p>
                    <p className="text-[11px] text-white/40 mt-1 max-w-[280px] leading-relaxed">
                      Thêm proxy OwlProxy ở trên. Proxy được lưu riêng cho tài khoản Discord của bạn.
                    </p>
                  </div>
                </div>
              )}

              {/* Proxy list grouped by country */}
              {!loading && proxies.length > 0 && (
                <div className="p-3 lg:p-4 space-y-3">
                  {Object.entries(byCountry)
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([country, items]) => (
                      <div key={country} className="space-y-1.5">
                        {/* Country header */}
                        <div className="flex items-center gap-2 px-1 py-1">
                          <CountryFlag code={country === "Khác" ? null : country} size={28} />
                          <span className="text-xs lg:text-sm font-bold text-white">
                            {country === "Khác" ? "Không rõ quốc gia" : country}
                          </span>
                          <span className="text-[10px] text-white/40 font-mono">({items.length})</span>
                          <div className="flex-1 h-px bg-white/[0.04]" />
                        </div>

                        {/* Proxy rows */}
                        {items.map((p, idx) => (
                          <div
                            key={p.id}
                            className="group flex items-center gap-3 bg-black/20 border border-white/[0.04] rounded-xl px-3 py-2.5 hover:border-white/[0.1] transition-all duration-200"
                          >
                            <span className="text-[10px] text-white/30 font-mono w-4 text-center shrink-0">{idx + 1}</span>
                            <span className="text-xs font-semibold text-white flex-1 font-mono">
                              {country === "Khác" ? "—" : country}
                              <span className="text-white/40 ml-1">#{idx + 1}</span>
                            </span>
                            <button
                              onClick={() => handleDelete(p.id)}
                              className="w-7 h-7 rounded-lg flex items-center justify-center text-white/40 hover:text-[#F6606F] hover:bg-[#F6606F]/10 transition-all duration-200 shrink-0"
                              title="Xoá"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    ))}
                </div>
              )}
            </div>
          </AnimatedSection>

        </div>
      </div>
    </div>
  );
}
