"use client";

import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAppStore } from "@/lib/store";
import { useIsMobile } from "@/lib/useIsMobile";
import LoginPage from "@/components/discord/LoginPage";
import Dashboard from "@/components/discord/Dashboard";
import SettingsPage from "@/components/discord/Settings";
import HiddenQuests from "@/components/discord/HiddenQuests";
import ExtensionPage from "@/components/discord/ExtensionPage";
import AppSidebar from "@/components/discord/Sidebar";
import MobileTabBar from "@/components/discord/MobileTabBar";
import ErrorBoundary from "@/components/discord/ErrorBoundary";
import NotVerifiedScreen from "@/components/discord/NotVerifiedScreen";

/* ─── Loading splash — CSS-only aurora mesh + minimal progress bar ───
   Matches the new source design: 3 aurora-blob CSS keyframes, no
   framer-motion loops, single transition for content reveal. */
function LoadingSplash() {
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(true);
    const t = setInterval(() => {
      setProgress((p) => {
        if (p >= 100) return 100;
        return Math.min(100, p + Math.random() * 14 + 6);
      });
    }, 130);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="h-[100dvh] bg-[#0A0B0E] flex flex-col items-center justify-center relative overflow-hidden">
      {/* Aurora mesh bg — transform-only CSS animations (no filter:blur) */}
      <div className="absolute inset-0 pointer-events-none">
        <div
          className="absolute top-1/3 left-1/3 w-[50vw] h-[50vw] rounded-full aurora-blob-1 gpu-layer"
          style={{
            background: "radial-gradient(circle, rgba(94, 106, 210, 0.3) 0%, rgba(94, 106, 210, 0.08) 35%, transparent 65%)",
          }}
        />
        <div
          className="absolute bottom-1/4 right-1/4 w-[40vw] h-[40vw] rounded-full aurora-blob-2 gpu-layer"
          style={{
            background: "radial-gradient(circle, rgba(232, 121, 249, 0.2) 0%, rgba(232, 121, 249, 0.05) 35%, transparent 65%)",
          }}
        />
      </div>

      {/* Brand mark + progress — vòng quỹ đạo, halo thở, chữ shimmer */}
      <style>{`
        @keyframes dqaSpin { to { transform: rotate(360deg) } }
        @keyframes dqaSpinRev { to { transform: rotate(-360deg) } }
        @keyframes dqaBreathe { 0%,100% { opacity:.5; transform:scale(.94) } 50% { opacity:.95; transform:scale(1.08) } }
        @keyframes dqaFloat { 0%,100% { transform:translateY(0) } 50% { transform:translateY(-5px) } }
        @keyframes dqaShine { 0% { background-position:0% 50% } 100% { background-position:200% 50% } }
        @keyframes dqaScan { 0% { transform:translateX(-130%) } 100% { transform:translateX(330%) } }
        @keyframes dqaDots { 0%,100% { opacity:.18 } 50% { opacity:1 } }
        .dqa-ring {
          background: conic-gradient(from 0deg, transparent 0deg, rgba(94,106,210,.95) 55deg, rgba(232,121,249,.9) 125deg, transparent 210deg);
          -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 1.5px), #000 calc(100% - 1.4px));
          mask: radial-gradient(farthest-side, transparent calc(100% - 1.5px), #000 calc(100% - 1.4px));
        }
        .dqa-ring-1 { animation: dqaSpin 4.2s linear infinite; }
        .dqa-ring-2 { animation: dqaSpinRev 2.9s linear infinite; opacity:.65; }
        .dqa-title {
          background: linear-gradient(100deg,#ffffff 0%,#c9ceff 32%,#E879F9 52%,#ffffff 78%);
          background-size: 220% auto;
          -webkit-background-clip: text; background-clip: text; color: transparent;
          animation: dqaShine 5s linear infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .dqa-ring-1, .dqa-ring-2, .dqa-title, .dqa-breathe, .dqa-float, .dqa-scan { animation: none !important }
        }
      `}</style>

      <div
        className={`relative z-10 flex flex-col items-center transition-all duration-700 ${visible ? "opacity-100 scale-100" : "opacity-0 scale-95"}`}
      >
        <div className="relative w-32 h-32 flex items-center justify-center gpu-layer">
          {/* Halo thở */}
          <div
            className="dqa-breathe absolute inset-0 rounded-full gpu-layer"
            style={{
              background: "radial-gradient(circle, rgba(94,106,210,0.42) 0%, rgba(232,121,249,0.22) 42%, transparent 70%)",
              animation: "dqaBreathe 4.2s ease-in-out infinite",
            }}
          />
          {/* Hai vòng quỹ đạo quay ngược chiều */}
          <div className="dqa-ring dqa-ring-1 absolute inset-1 rounded-full" />
          <div className="dqa-ring dqa-ring-2 absolute inset-6 rounded-full" />
          {/* Vệ tinh nhỏ chạy trên quỹ đạo */}
          <div className="absolute inset-1" style={{ animation: "dqaSpin 6.5s linear infinite" }}>
            <span
              className="absolute left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full"
              style={{ background: "#E879F9", boxShadow: "0 0 10px rgba(232,121,249,0.9)" }}
            />
          </div>

          {/* Logo */}
          <div
            className="dqa-float relative w-14 h-14 rounded-2xl flex items-center justify-center overflow-hidden"
            style={{
              background: "linear-gradient(135deg, #5E6AD2 0%, #8B7CF6 55%, #E879F9 100%)",
              boxShadow: "0 10px 34px rgba(94,106,210,0.45), inset 0 1px 0 rgba(255,255,255,0.25)",
              animation: "dqaFloat 5.5s ease-in-out infinite",
            }}
          >
            <svg viewBox="0 0 24 24" fill="white" className="w-7 h-7 relative z-10">
              <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z" />
            </svg>
            {/* Vệt sáng quét qua logo */}
            <div
              className="dqa-scan absolute inset-0 opacity-60"
              style={{
                background: "linear-gradient(100deg, transparent 30%, rgba(255,255,255,0.55) 50%, transparent 70%)",
                animation: "dqaScan 3.2s ease-in-out infinite",
              }}
            />
          </div>
        </div>

        {/* Tên app — chữ chuyển màu chạy */}
        <h1 className="dqa-title text-display text-xl mt-6 mb-1.5 tracking-tight">Discord Quest Auto</h1>

        {/* Trạng thái khởi tạo */}
        <p className="text-[10px] font-mono tracking-[0.32em] text-white/35 mb-7 uppercase">
          Initializing system
          <span className="inline-block w-4 text-left">
            <span style={{ animation: "dqaDots 1.4s ease-in-out infinite" }}>.</span>
            <span style={{ animation: "dqaDots 1.4s ease-in-out .2s infinite" }}>.</span>
            <span style={{ animation: "dqaDots 1.4s ease-in-out .4s infinite" }}>.</span>
          </span>
        </p>

        {/* Thanh tiến trình */}
        <div className="relative w-60 h-[3px] rounded-full bg-white/[0.07] overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 rounded-full overflow-hidden transition-[width] duration-500 ease-out"
            style={{
              width: `${progress}%`,
              background: "linear-gradient(90deg, #5E6AD2, #8B7CF6, #E879F9)",
              boxShadow: "0 0 14px rgba(139,124,246,0.6)",
            }}
          >
            <div
              className="absolute inset-0"
              style={{
                background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.75), transparent)",
                animation: "dqaScan 1.7s linear infinite",
              }}
            />
          </div>
        </div>
        <p className="text-[10px] text-white/30 font-mono mt-2.5 tabular-nums tracking-wider">{Math.round(progress)}%</p>
      </div>
    </div>
  );
}

/* Page transition variants — spring physics, scene transitions.
   Mobile skips these entirely (page re-mounts are too expensive on small
   devices). Desktop duration dropped from 0.5s → 0.3s for snappier feel. */
const pageVariants = {
  initial: { opacity: 0, y: 12, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.3, ease: [0.22, 1, 0.36, 1] as [number, number, number] } },
  exit: { opacity: 0, y: -8, scale: 1.01, transition: { duration: 0.2, ease: [0.65, 0, 0.35, 1] as [number, number, number] } },
};

export default function Home() {
  const {
    isLoggedIn, page, isVerified, restoreSession, token, logout,
    setGuildMember, setGuildCheckLoading, setPage,
    isGuildMember, guildCheckedOnce, autoQuestEnabled, setAutoQuestEnabled,
    sessionId, workerStatus, sessionChecking,
  } = useAppStore();
  const [restored, setRestored] = useState(false);
  const isMobile = useIsMobile();

  const tokenChecked = useRef(false);
  const prevLoggedIn = useRef(false);
  const autoQuestRestoreAttempted = useRef(false);

  useEffect(() => {
    restoreSession();
    const id = requestAnimationFrame(() => setRestored(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // Token alive check — once per login session.
  // KHÔNG logout ngay khi Discord API fail — chỉ logout khi server confirm token dead
  useEffect(() => {
    if (!isLoggedIn && prevLoggedIn.current) {
      tokenChecked.current = false;
      autoQuestRestoreAttempted.current = false;
    }
    prevLoggedIn.current = isLoggedIn;

    if (!isLoggedIn || !token || tokenChecked.current) return;
    tokenChecked.current = true;

    fetch("/api/auth/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((res) => {
        // Network error hoặc server error → KHÔNG logout (chỉ logout khi 401)
        if (!res.ok && res.status !== 401) return null;
        return res.json();
      })
      .then((data) => {
        // Chỉ logout khi server xác nhận token expired (data.tokenExpired === true)
        if (data && data.alive === false && data.tokenExpired === true) {
          try { sessionStorage.setItem("dq_token_expired", "1"); } catch { /* ignore */ }
          logout();
        }
      })
      .catch(() => { /* Network error — don't logout */ });
  }, [isLoggedIn, token, logout]);

  // ─── Session heartbeat — multi-session mode ───
  // Multi-session: KHÔNG logout khi session_not_found hoặc khi có session khác active.
  // Chỉ re-register nếu heartbeat fail 3 lần liên tiếp (server restart / network issue).
  const heartbeatFailCount = useRef(0);
  useEffect(() => {
    if (!isLoggedIn || !token || !sessionId) return;
    const tokenId = `t_${token.slice(0, 16)}`;

    const sendHeartbeat = () => {
      fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "heartbeat", tokenId, sessionId }),
      })
        .then(async (res) => {
          if (res.ok) {
            heartbeatFailCount.current = 0;
            return;
          }
          if (res.status === 401) {
            try {
              const data = await res.json();
              // Multi-session: KHÔNG logout khi session_evicted nữa (không xảy ra vì
              // sessionManager không reject multi-session). Chỉ re-register nếu
              // session_not_found (server restart).
              heartbeatFailCount.current += 1;
              console.warn(`[Heartbeat] 401 ${data.reason} (count: ${heartbeatFailCount.current})`);
              if (heartbeatFailCount.current >= 3) {
                // Auto re-register để tiếp tục heartbeat
                fetch("/api/auth/session", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ action: "register", tokenId, sessionId }),
                })
                  .then((regRes) => {
                    if (regRes.ok) {
                      console.log("[Heartbeat] Re-registered session after 3 failures (multi-session mode)");
                      heartbeatFailCount.current = 0;
                    }
                    // KHÔNG logout nếu re-register fail — multi-session cho phép tiếp tục dùng
                  })
                  .catch(() => { /* Network error — keep trying */ });
              }
            } catch {
              // JSON parse fail — don't logout
            }
          }
        })
        .catch(() => { /* Network error — don't logout, keep trying */ });
    };

    // Đợi 5s sau khi mount rồi mới heartbeat (tránh call ngay khi component render)
    const initialDelay = setTimeout(() => {
      sendHeartbeat();
    }, 5000);
    const interval = setInterval(sendHeartbeat, 30 * 1000);

    const onVisible = () => {
      if (document.visibilityState === "visible") {
        heartbeatFailCount.current = 0;
        sendHeartbeat();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearTimeout(initialDelay);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [isLoggedIn, token, sessionId, logout]);

  // Not-verified redirect is no longer needed — NotVerifiedScreen blocks
  // all pages including dashboard/hidden when !isVerified.

  // Guild check — on page change only
  useEffect(() => {
    if (!isLoggedIn || !token) return;
    setGuildCheckLoading(true);
    fetch("/api/auth/guild-check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        if (data && data.isMember !== undefined) {
          setGuildMember(data.isMember, data.guildName, data.guildIcon);
        }
      })
      .catch(() => { /* Network error — don't change existing membership state */ })
      .finally(() => {
        setGuildCheckLoading(false);
      });
  }, [isLoggedIn, token, page, setGuildMember, setGuildCheckLoading]);

  // Auto-quest loop restore — fires once per login session, after the FIRST
  // guild check completes.
  useEffect(() => {
    if (!isLoggedIn || !token || !guildCheckedOnce) return;
    if (autoQuestRestoreAttempted.current) return;
    autoQuestRestoreAttempted.current = true;

    const tokenId = `t_${token.slice(0, 16)}`;
    const pushToggle = async (enabled: boolean) => {
      try {
        await fetch("/api/quests/auto-loop", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tokenId, token, enabled, isVerified }),
        });
      } catch { /* swallow */ }
    };

    if (isGuildMember && isVerified && autoQuestEnabled) {
      pushToggle(true);
    } else if (!isGuildMember && autoQuestEnabled) {
      setAutoQuestEnabled(false);
      pushToggle(false);
    }
  }, [isLoggedIn, token, guildCheckedOnce, isGuildMember, isVerified, autoQuestEnabled, setAutoQuestEnabled]);

  if (!restored || sessionChecking) {
    return <LoadingSplash />;
  }

  if (!isLoggedIn) {
    // On mobile: render login directly (no page transition — avoids the
    // entire tree re-mounting on every state change).
    if (isMobile) {
      return <LoginPage />;
    }
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key="login"
          variants={pageVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          className="h-[100dvh]"
        >
          <LoginPage />
        </motion.div>
      </AnimatePresence>
    );
  }

  // Pick the active page content
  const activePageContent =
    page === "settings" ? <SettingsPage /> :
    page === "hidden" ? <HiddenQuests /> :
    page === "extension" ? <ExtensionPage /> :
    <Dashboard />;

  // ─── Not verified → block ALL features, show warning screen ───
  if (isLoggedIn && !isVerified) {
    return (
      <div className="h-[100dvh] flex flex-col overflow-hidden bg-[#0A0B0E] relative">
        <NotVerifiedScreen />
      </div>
    );
  }

  return (
    <div className="h-[100dvh] flex flex-col lg:flex-row overflow-hidden bg-[#0A0B0E] contain-section relative">
      {/* Desktop sidebar — hidden on mobile (lg:hidden wrapper).
          On mobile the MobileTabBar at the bottom is the primary nav. */}
      <div className="hidden lg:flex">
        <AppSidebar />
      </div>

      <ErrorBoundary>
        {/* Main content — flex-1 takes remaining height (mobile: above tab bar,
            desktop: full height since tab bar is hidden). No padding-bottom
            needed because MobileTabBar is now a flex child, not fixed. */}
        <div className="flex-1 flex flex-col min-w-0 h-full min-h-0">
          {isMobile ? (
            // Mobile: no page-level AnimatePresence (avoids re-mounting the
            // entire page tree on every nav). Each child component handles
            // its own subtle entrance animation.
            <div className="flex-1 flex flex-col min-h-0 h-full">
              {activePageContent}
            </div>
          ) : (
            // Desktop: keep the spring page transitions but shorter (0.3s).
            <AnimatePresence mode="wait">
              <motion.div
                key={page}
                variants={pageVariants}
                initial="initial"
                animate="animate"
                exit="exit"
                className="flex-1 flex flex-col min-h-0 h-full"
              >
                {activePageContent}
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </ErrorBoundary>

      {/* Mobile bottom tab bar — primary nav on mobile, hidden on desktop.
          Rendered as a flex child (not position:fixed) so iOS Safari URL bar
          hide/show doesn't make it jump. */}
      {isMobile && (
        <MobileTabBar
          page={page}
          setPage={setPage}
          isVerified={isVerified}
          workerStatus={workerStatus}
        />
      )}
    </div>
  );
}
