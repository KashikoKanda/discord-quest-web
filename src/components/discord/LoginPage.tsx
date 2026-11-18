"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ShieldCheck, Eye, EyeOff, AlertTriangle, ArrowRight,
  Zap, Clock, Trophy, Lock, Fingerprint,
  ChevronRight, KeyRound, Globe, Loader2, Check, MapPin, QrCode, Smartphone, CheckCircle2, RefreshCw,
} from "lucide-react";

/* Discord SVG logo path (preserved per hard constraint #5) */
const DISCORD_PATH = "M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z";

type LoginTab = "token" | "email" | "qr";

interface DiscordProfileFromApi {
  id: string;
  username: string;
  global_name?: string | null;
  discriminator: string;
  avatar: string | null;
  email?: string;
  phone?: string;
  mfa_enabled: boolean;
  flags: number;
  premium_type: number;
  locale: string;
  verified: boolean;
  banner?: string | null;
  accent_color?: number | null;
  avatar_decoration?: unknown;
}

/* ──────────────────────────────────────────────────────────────
 * Tab bar
 * ────────────────────────────────────────────────────────────── */
function TabBar({ tab, setTab, disabled }: { tab: LoginTab; setTab: (t: LoginTab) => void; disabled: boolean }) {
  const tabs: { key: LoginTab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
    { key: "token", label: "Token", icon: KeyRound },
    { key: "qr", label: "QR Code", icon: QrCode },
  ];
  return (
    <div className="flex items-center gap-1 p-1 mb-5 rounded-lg bg-white/[0.03] border border-white/[0.06]">
      {tabs.map((t) => {
        const Icon = t.icon;
        const active = tab === t.key;
        return (
          <button
            key={t.key}
            type="button"
            disabled={disabled}
            onClick={() => setTab(t.key)}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-2 rounded-md text-[12px] font-medium transition-all duration-200 ${
              active
                ? "bg-[#5865F2] text-white shadow-[0_4px_14px_rgba(88,101,242,0.4)]"
                : "text-white/50 hover:text-white/80 hover:bg-white/[0.04]"
            } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
          >
            <Icon className="w-3.5 h-3.5" />
            <span>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
 * Proxy Selector — dropdown chọn server/proxy location
 * ────────────────────────────────────────────────────────────── */
interface ProxyCountry {
  code: string;
  label: string;
  flag: string;
  count: number;
}

function ProxySelector({ value, onChange }: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [countries, setCountries] = useState<ProxyCountry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/proxy-countries")
      .then((res) => res.json())
      .then((data) => {
        if (data.success && Array.isArray(data.countries)) {
          setCountries(data.countries);
        }
      })
      .catch(() => { /* ignore */ })
      .finally(() => setLoading(false));
  }, []);

  const selected = value === "auto"
    ? { code: "auto", label: "Tự động", flag: "🌍", count: 0 }
    : countries.find((c) => c.code === value) || { code: value, label: value, flag: "🏳️", count: 0 };

  return (
    <div className="relative">
      <label className="block text-[11px] font-medium text-white/50 mb-1.5 uppercase tracking-wider">
        Server Location
      </label>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full h-11 flex items-center justify-between px-3 rounded-lg bg-white/[0.03] border border-white/[0.08] hover:border-white/[0.14] transition-all text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">{selected.flag}</span>
          <div>
            <p className="text-[12px] font-semibold text-white leading-tight">{selected.label}</p>
            {/* Chỉ hiện count trên desktop (sm trở lên) — mobile ẩn cho gọn */}
            <p className="text-[9px] text-white/40 leading-tight hidden sm:block">
              {value === "auto"
                ? "Server chọn proxy tốt nhất"
                : `${selected.count} proxies available`}
            </p>
            <p className="text-[9px] text-white/40 leading-tight sm:hidden">
              {value === "auto" ? "Tự động chọn" : selected.label}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {loading && <Loader2 className="w-3 h-3 animate-spin text-white/30" />}
          <ChevronRight className={`w-4 h-4 text-white/40 transition-transform ${open ? "rotate-90" : ""}`} />
        </div>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute z-50 mt-1 w-full max-h-[280px] overflow-y-auto rounded-lg bg-[#1a1d24] border border-white/[0.1] shadow-2xl scrollbar-hide">
            {/* Auto option */}
            <button
              type="button"
              onClick={() => { onChange("auto"); setOpen(false); }}
              className={`w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-white/[0.04] transition-colors text-left ${
                value === "auto" ? "bg-[#5865F2]/[0.08]" : ""
              }`}
            >
              <span className="text-lg">🌍</span>
              <div className="flex-1">
                <p className="text-[12px] font-semibold text-white leading-tight">Tự động</p>
                <p className="text-[9px] text-white/40 leading-tight">Server chọn proxy tốt nhất</p>
              </div>
              {value === "auto" && <Check className="w-3.5 h-3.5 text-[#5865F2] shrink-0" />}
            </button>

            <div className="px-3 py-1.5 text-[9px] font-mono text-white/30 uppercase tracking-wider border-t border-white/[0.04] hidden sm:block">
              {countries.length} quốc gia khả dụng
            </div>

            {countries.map((country) => (
              <button
                key={country.code}
                type="button"
                onClick={() => { onChange(country.code); setOpen(false); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-white/[0.04] transition-colors text-left ${
                  value === country.code ? "bg-[#5865F2]/[0.08]" : ""
                }`}
              >
                <span className="text-lg">{country.flag}</span>
                <div className="flex-1">
                  <p className="text-[12px] font-semibold text-white leading-tight">{country.label}</p>
                  {/* ẩn count trên mobile */}
                  <p className="text-[9px] text-white/40 leading-tight hidden sm:block">{country.count} proxies</p>
                </div>
                {value === country.code && <Check className="w-3.5 h-3.5 text-[#5865F2] shrink-0" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
 * Token login (existing flow, preserved)
 * ────────────────────────────────────────────────────────────── */
function TokenLogin({ onLoginSuccess, parentLoading, proxyCountry }: {
  onLoginSuccess: (token: string, profile: DiscordProfileFromApi) => void;
  parentLoading: boolean;
  proxyCountry: string;
}) {
  const [tokenInput, setTokenInput] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");  // "connecting" | "connected" | ""

  const handleLogin = async () => {
    if (!tokenInput.trim()) { setError("Vui lòng nhập Discord token"); return; }
    setLoading(true);
    setError("");
    setStatus("connecting");

    try {
      // Step 1: Gửi login + proxyCountry → server assign proxy + verify token
      // Server sẽ đợi proxy kết nối thành công trước khi verify token
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenInput.trim(), proxyCountry }),
      });
      let data: any;
      try {
        data = await res.json();
      } catch {
        setError(`Lỗi server (HTTP ${res.status}). Vui lòng thử lại sau.`);
        setStatus("");
        setLoading(false);
        return;
      }
      if (!res.ok || !data.success) {
        setError(data.error || "Token không hợp lệ");
        setStatus("");
        setLoading(false);
        return;
      }
      // Login success
      setStatus("connected");
      onLoginSuccess(tokenInput.trim(), data.profile);
    } catch (err: any) {
      setError("Lỗi kết nối: " + err.message);
      setStatus("");
      setLoading(false);
    }
  };

  const isLoading = loading || parentLoading;

  return (
    <div>
      <label className="block text-[11px] font-medium text-white/50 mb-1.5 uppercase tracking-wider">
        Discord Token
      </label>
      <div className="relative mb-3">
        <Input
          type={showToken ? "text" : "password"}
          placeholder="Dán token vào đây..."
          value={tokenInput}
          onChange={(e) => setTokenInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !isLoading && handleLogin()}
          autoComplete="off"
          data-form-type="other"
          data-lpignore="true"
          disabled={isLoading}
          className="bg-white/[0.03] border-white/[0.08] text-white placeholder:text-white/30 h-12 pr-12 font-mono text-sm rounded-lg focus:border-[#5865F2]/50 focus:bg-white/[0.05] transition-all duration-200"
        />
        <button
          onClick={() => setShowToken(!showToken)}
          className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 rounded-md flex items-center justify-center text-white/40 hover:text-white hover:bg-white/[0.05] transition-colors"
          type="button"
          tabIndex={-1}
        >
          {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>

      {error && (
        <div className="mb-3 flex items-center gap-2 p-2.5 rounded-lg bg-[#F6606F]/[0.08] border border-[#F6606F]/20 text-[#F6606F] text-xs animate-scale-in">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}

      <Button
        onClick={handleLogin}
        disabled={isLoading || !tokenInput.trim()}
        className="w-full h-12 bg-[#5865F2] hover:bg-[#4752C4] text-white font-semibold text-sm rounded-lg transition-all duration-300 hover:shadow-[0_12px_36px_rgba(88,101,242,0.55),0_0_24px_rgba(94,106,210,0.4)] active:scale-[0.98] hover:scale-[1.01] disabled:opacity-60 disabled:hover:scale-100 relative overflow-hidden btn-sweep group"
      >
        {isLoading ? (
          <span className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            {status === "connecting" ? "Đang kết nối proxy..." : "Đang đăng nhập..."}
          </span>
        ) : (
          <span className="flex items-center gap-2">
            Đăng nhập <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </span>
        )}
      </Button>

      <div className="mt-4 flex items-center gap-2 text-[10px] text-white/30">
        <Lock className="w-3 h-3" />
        <span>Token theo phiên đăng nhập, hết hạn khi đăng xuất Discord.</span>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
 * Email/Password login (with captcha + MFA)
 * ────────────────────────────────────────────────────────────── */

interface CaptchaInfo {
  sitekey: string;
  service?: string;
  rqdata?: string;
  // Discord binds the captcha challenge to a session_id + rqtoken.
  // These MUST be sent back on retry along with the captcha_key, otherwise
  // Discord rejects the captcha_key and asks for a new one → infinite loop.
  sessionId?: string;
  rqtoken?: string;
}
interface MfaInfo {
  ticket: string;
  method: "totp" | "sms" | "webauthn";
  webauthnChallenge?: string;
  webauthnRpId?: string;
}

function EmailLogin({ onLoginSuccess, parentLoading }: {
  onLoginSuccess: (token: string, profile: DiscordProfileFromApi) => void;
  parentLoading: boolean;
}) {
  const [loginInput, setLoginInput] = useState("");      // email or phone
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [captcha, setCaptcha] = useState<CaptchaInfo | null>(null);
  const [mfa, setMfa] = useState<MfaInfo | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [hcaptchaToken, setHcaptchaToken] = useState<string | null>(null);
  const [hcaptchaWidgetId, setHcaptchaWidgetId] = useState<string | number | null>(null);
  const hcaptchaRef = useRef<HTMLDivElement>(null);
  const [hcaptchaReady, setHcaptchaReady] = useState(false);
  // Debounce submit — chặn user bấm "Đăng nhập" liên tục để tránh Discord
  // flag spam captcha (rate-limit + account lockout).
  const [lastSubmitAt, setLastSubmitAt] = useState(0);
  // Persistent UA per login session — generate 1 lần khi mount LoginPage,
  // gửi kèm mỗi request /api/auth/password + /api/auth/mfa để server dùng
  // cùng 1 UA bundle cho cả login flow (giống real device, không đổi UA
  // giữa captcha_required và submit).
  const loginSessionId = useMemo(
    () => `ls_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
    [],
  );

  // Load hCaptcha script lazily — only when captcha is required
  useEffect(() => {
    if (!captcha) return;
    // If script already loaded, just mark ready
    if ((window as any).hcaptcha) {
      setHcaptchaReady(true);
      return;
    }
    if (document.getElementById("hcaptcha-script")) {
      // Script tag exists but not loaded yet — wait for it
      const t = setInterval(() => {
        if ((window as any).hcaptcha) {
          setHcaptchaReady(true);
          clearInterval(t);
        }
      }, 100);
      return;
    }
    // Set up global onload callback
    (window as any).hcaptchaOnLoad = () => setHcaptchaReady(true);
    const script = document.createElement("script");
    script.id = "hcaptcha-script";
    script.src = "https://js.hcaptcha.com/1/api.js?onload=hcaptchaOnLoad&render=explicit&recaptchacompat=off";
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  }, [captcha]);

  // Render hCaptcha widget when sitekey is available + script is ready
  useEffect(() => {
    if (!captcha || !hcaptchaReady || !hcaptchaRef.current) return;
    try {
      // Reset any previous widget
      const w = (window as any).hcaptcha;
      // Clear container
      while (hcaptchaRef.current.firstChild) {
        hcaptchaRef.current.removeChild(hcaptchaRef.current.firstChild);
      }
      const renderOpts: Record<string, unknown> = {
        sitekey: captcha.sitekey,
        theme: "dark",
        size: "normal",
        // KHÔNG auto-resubmit sau khi user giải captcha — Discord sẽ flag spam
        // nếu login bị fail nhiều lần với captcha token mới liên tục.
        // User phải tự bấm nút "Đăng nhập" sau khi giải xong.
        callback: (token: string) => {
          setHcaptchaToken(token);
        },
        "expired-callback": () => setHcaptchaToken(null),
        "error-callback": (err: unknown) => {
          console.error("hCaptcha error:", err);
          setError("Captcha gặp lỗi. Vui lòng làm mới trang và thử lại.");
          setHcaptchaToken(null);
        },
      };
      if (captcha.rqdata) {
        // hCaptcha rqdata enables enterprise mode (Discord uses this)
        renderOpts.rqdata = captcha.rqdata;
      }
      const id = w.render(hcaptchaRef.current, renderOpts);
      setHcaptchaWidgetId(id);
    } catch (err) {
      console.error("Failed to render hCaptcha:", err);
      setError("Không thể tải captcha. Vui lòng thử lại.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [captcha, hcaptchaReady]);

  const doLogin = useCallback(async (captchaToken?: string) => {
    if (!loginInput.trim() || !password) {
      setError("Vui lòng nhập email/số điện thoại và mật khẩu");
      return;
    }
    // Debounce — nếu user vừa submit < 2s trước, bỏ qua
    const now = Date.now();
    if (now - lastSubmitAt < 2000) {
      return;
    }
    setLastSubmitAt(now);
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          login: loginInput.trim(),
          password,
          captchaKey: captchaToken || hcaptchaToken || undefined,
          // Send back the session_id + rqtoken from the previous
          // captcha_required response — Discord binds the challenge to
          // these tokens and will reject the captcha_key without them.
          captchaSessionId: captcha?.sessionId,
          captchaRqtoken: captcha?.rqtoken,
          // Persistent UA per login session — server cache UA bundle theo
          // loginSessionId, dùng cùng UA cho cả login → captcha → MFA.
          loginSessionId,
        }),
      });
      // Parse JSON an toàn — nếu server trả "Internal Server Error" (HTML),
      // res.json() sẽ throw "Unexpected token 'I', "Internal S"..."
      // → catch và hiển thị message thân thiện thay vì stack trace khó hiểu.
      let data: any;
      try {
        data = await res.json();
      } catch (parseErr: any) {
        console.error("[Login] Response is not JSON. Status:", res.status, "Content-Type:", res.headers.get("content-type"));
        // Fallback: lấy text thô để debug
        const rawText = await res.text().catch(() => "");
        if (res.status === 500) {
          setError("Server error — vui lòng thử lại sau ít phút. (Proxy có thể đang quá tải)");
        } else if (res.status === 502 || res.status === 503) {
          setError("Server đang bận — vui lòng thử lại sau");
        } else {
          setError(`Lỗi server (HTTP ${res.status}). Vui lòng thử lại.`);
        }
        setLoading(false);
        return;
      }
      if (data.success) {
        onLoginSuccess(data.token, data.profile);
        return;
      }
      // Inspect state to determine next step
      if (data.state === "captcha_required") {
        setCaptcha({
          sitekey: data.captchaSitekey,
          service: data.captchaService,
          rqdata: data.captchaRqdata,
          sessionId: data.captchaSessionId,
          rqtoken: data.captchaRqtoken,
        });
        setError("");  // hide previous errors once captcha shows
        // Reset captcha token — user must re-solve for new attempt
        setHcaptchaToken(null);
        setLoading(false);
        return;
      }
      if (data.state === "mfa_required" || data.state === "sms_required" || data.state === "webauthn_required") {
        setMfa({
          ticket: data.mfaTicket,
          method: data.state === "sms_required" ? "sms"
                : data.state === "webauthn_required" ? "webauthn"
                : "totp",
          webauthnChallenge: data.webauthnChallenge,
          webauthnRpId: data.webauthnRpId,
        });
        setError("");
        setLoading(false);
        return;
      }
      // Real error (invalid creds, rate limit, etc.)
      setError(data.error || "Đăng nhập thất bại");
      // Reset captcha token — user must re-solve
      setHcaptchaToken(null);
      // Reset hCaptcha widget if present
      if (hcaptchaWidgetId !== null && (window as any).hcaptcha) {
        try { (window as any).hcaptcha.reset(hcaptchaWidgetId); } catch { /* ignore */ }
      }
      setLoading(false);
    } catch (err: any) {
      setError("Lỗi kết nối: " + err.message);
      setLoading(false);
    }
  }, [loginInput, password, hcaptchaToken, hcaptchaWidgetId, onLoginSuccess, lastSubmitAt]);

  const doMfa = async () => {
    if (!mfa || !mfaCode.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticket: mfa.ticket,
          code: mfaCode.trim(),
          method: mfa.method,
          // Reuse the SAME loginSessionId from login — server sẽ lấy cùng
          // UA bundle đã cache, để Discord thấy fingerprint consistent
          // giữa login và MFA verify (giống real device).
          loginSessionId,
        }),
      });
      // Parse JSON an toàn — server có thể trả "Internal Server Error" HTML
      let data: any;
      try {
        data = await res.json();
      } catch (parseErr: any) {
        console.error("[MFA] Response is not JSON. Status:", res.status);
        if (res.status === 500) {
          setError("Server error — vui lòng thử lại sau (proxy có thể quá tải)");
        } else {
          setError(`Lỗi server (HTTP ${res.status}). Vui lòng thử lại.`);
        }
        setLoading(false);
        return;
      }
      if (data.success) {
        onLoginSuccess(data.token, data.profile);
        return;
      }
      setError(data.error || "Mã MFA không đúng");
      setLoading(false);
    } catch (err: any) {
      setError("Lỗi kết nối: " + err.message);
      setLoading(false);
    }
  };

  const resetCaptcha = () => {
    if (hcaptchaWidgetId !== null && (window as any).hcaptcha) {
      try { (window as any).hcaptcha.reset(hcaptchaWidgetId); } catch { /* ignore */ }
    }
    setHcaptchaToken(null);
  };

  const isLoading = loading || parentLoading;

  // ── MFA view ──
  if (mfa) {
    // WebAuthn (security key / passkey) — UI khác biệt
    if (mfa.method === "webauthn") {
      return (
        <div>
          <div className="mb-4 flex items-center gap-2.5 p-3 rounded-lg bg-[#5865F2]/[0.08] border border-[#5865F2]/20">
            <KeyRound className="w-4 h-4 text-[#5865F2] shrink-0" />
            <div>
              <p className="text-[12px] font-semibold text-[#5865F2] mb-0.5">
                Xác minh bằng khóa bảo mật
              </p>
              <p className="text-[11px] text-white/50 leading-relaxed">
                Discord yêu cầu xác minh bằng Security Key hoặc Passkey (vân tay / Face ID).
                Vui lòng hoàn tất xác minh trên thiết bị của bạn.
              </p>
            </div>
          </div>
          <div className="p-3 rounded-lg bg-white/[0.02] border border-white/[0.06] text-[11px] text-white/50 leading-relaxed">
            <p className="mb-1">⚠️ WebAuthn chưa được hỗ trợ trong app này.</p>
            <p>Vui lòng dùng tab <span className="text-white/80 font-semibold">Token</span> hoặc <span className="text-white/80 font-semibold">QR Code</span> để đăng nhập.</p>
            <p className="mt-1">Hoặc đăng nhập trực tiếp trên <a href="https://discord.com/login" target="_blank" rel="noopener noreferrer" className="text-[#5865F2] underline">discord.com</a> và lấy token.</p>
          </div>
          <button
            type="button"
            onClick={() => { setMfa(null); setError(""); }}
            className="mt-3 w-full text-[11px] text-white/40 hover:text-white/70 transition-colors"
          >
            ← Quay lại đăng nhập
          </button>
        </div>
      );
    }
    return (
      <div>
        <div className="mb-4 flex items-center gap-2.5 p-3 rounded-lg bg-[#3DD68C]/[0.08] border border-[#3DD68C]/20">
          <Smartphone className="w-4 h-4 text-[#3DD68C] shrink-0" />
          <div>
            <p className="text-[12px] font-semibold text-[#3DD68C] mb-0.5">
              {mfa.method === "sms" ? "Xác minh qua SMS" : "Xác minh 2 bước (TOTP)"}
            </p>
            <p className="text-[11px] text-white/50 leading-relaxed">
              {mfa.method === "sms"
                ? "Mã đã được gửi qua SMS đến số điện thoại của bạn."
                : "Nhập mã 6 chữ số từ ứng dụng Authy/Google Authenticator."}
            </p>
          </div>
        </div>

        <label className="block text-[11px] font-medium text-white/50 mb-1.5 uppercase tracking-wider">
          Mã {mfa.method === "sms" ? "SMS" : "TOTP"}
        </label>
        <Input
          type="text"
          inputMode="numeric"
          maxLength={6}
          placeholder="000000"
          value={mfaCode}
          onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && !isLoading && doMfa()}
          autoComplete="one-time-code"
          disabled={isLoading}
          className="bg-white/[0.03] border-white/[0.08] text-white placeholder:text-white/30 h-12 text-center font-mono text-lg tracking-[0.5em] rounded-lg focus:border-[#3DD68C]/50 focus:bg-white/[0.05] transition-all duration-200"
        />

        {error && (
          <div className="mt-3 flex items-center gap-2 p-2.5 rounded-lg bg-[#F6606F]/[0.08] border border-[#F6606F]/20 text-[#F6606F] text-xs">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
            {error}
          </div>
        )}

        <Button
          onClick={doMfa}
          disabled={isLoading || mfaCode.length !== 6}
          className="mt-3 w-full h-12 bg-[#3DD68C] hover:bg-[#2FB077] text-white font-semibold text-sm rounded-lg transition-all duration-300 hover:shadow-[0_12px_36px_rgba(61,214,140,0.4)] active:scale-[0.98] disabled:opacity-50"
        >
          {isLoading ? (
            <span className="flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Đang xác minh</span>
          ) : (
            <span className="flex items-center gap-2">Xác minh <ArrowRight className="w-4 h-4" /></span>
          )}
        </Button>

        <button
          type="button"
          onClick={() => { setMfa(null); setMfaCode(""); setError(""); }}
          className="mt-3 w-full text-[11px] text-white/40 hover:text-white/70 transition-colors"
        >
          ← Quay lại đăng nhập
        </button>
      </div>
    );
  }

  // ── Email/password + optional captcha view ──
  return (
    <div>
      <label className="block text-[11px] font-medium text-white/50 mb-1.5 uppercase tracking-wider">
        Email hoặc SĐT
      </label>
      <Input
        type="text"
        placeholder="email@example.com hoặc +84..."
        value={loginInput}
        onChange={(e) => setLoginInput(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && !isLoading && doLogin()}
        autoComplete="username"
        disabled={isLoading}
        className="bg-white/[0.03] border-white/[0.08] text-white placeholder:text-white/30 h-12 px-3 text-sm rounded-lg focus:border-[#5865F2]/50 focus:bg-white/[0.05] transition-all duration-200 mb-3"
      />

      <label className="block text-[11px] font-medium text-white/50 mb-1.5 uppercase tracking-wider">
        Mật khẩu
      </label>
      <div className="relative mb-3">
        <Input
          type={showPwd ? "text" : "password"}
          placeholder="••••••••"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !isLoading && doLogin()}
          autoComplete="current-password"
          disabled={isLoading}
          className="bg-white/[0.03] border-white/[0.08] text-white placeholder:text-white/30 h-12 pr-12 text-sm rounded-lg focus:border-[#5865F2]/50 focus:bg-white/[0.05] transition-all duration-200"
        />
        <button
          onClick={() => setShowPwd(!showPwd)}
          type="button"
          tabIndex={-1}
          className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 rounded-md flex items-center justify-center text-white/40 hover:text-white hover:bg-white/[0.05] transition-colors"
        >
          {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>

      {/* Captcha widget — shown when Discord requires it */}
      {captcha && (
        <div className="mb-3 p-3 rounded-lg bg-white/[0.02] border border-white/[0.08]">
          <div className="flex items-center gap-2 mb-2">
            <ShieldCheck className="w-3.5 h-3.5 text-[#5865F2]" />
            <p className="text-[11px] text-white/60">Discord yêu cầu xác minh captcha</p>
          </div>
          {/* Warning: IP mới — Discord có thể gửi email xác minh địa điểm */}
          <div className="mb-2 p-2 rounded-md bg-[#F5B544]/[0.08] border border-[#F5B544]/20 flex items-start gap-2">
            <AlertTriangle className="w-3 h-3 text-[#F5B544] shrink-0 mt-0.5" />
            <p className="text-[10px] text-white/60 leading-relaxed">
              Discord phát hiện đăng nhập từ thiết bị / vị trí mới.
              Sau khi đăng nhập, kiểm tra email để xác nhận "Đó là tôi" nếu Discord gửi thông báo.
            </p>
          </div>
          <div ref={hcaptchaRef} className="hcaptcha-container min-h-[78px] flex items-center justify-center">
            {!hcaptchaReady && (
              <div className="flex items-center gap-2 text-[11px] text-white/40">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang tải captcha...
              </div>
            )}
          </div>
          {hcaptchaToken ? (
            <div className="mt-2 flex items-center gap-1.5 text-[10px] text-[#3DD68C]">
              <CheckCircle2 className="w-3 h-3" /> Đã xác minh — bấm "Đăng nhập" bên dưới để tiếp tục
            </div>
          ) : (
            <p className="mt-2 text-[10px] text-white/40 leading-relaxed">
              Giải captcha rồi bấm nút "Đăng nhập" — không tự động submit để tránh bị Discord rate-limit.
            </p>
          )}
          {hcaptchaToken && (
            <button
              type="button"
              onClick={resetCaptcha}
              className="mt-1 text-[10px] text-white/40 hover:text-white/70 transition-colors flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" /> Giải lại captcha
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="mb-3 flex items-center gap-2 p-2.5 rounded-lg bg-[#F6606F]/[0.08] border border-[#F6606F]/20 text-[#F6606F] text-xs animate-scale-in">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}

      <Button
        onClick={() => doLogin()}
        disabled={isLoading || !loginInput.trim() || !password || !!lastSubmitAt && Date.now() - lastSubmitAt < 2000}
        className="w-full h-12 bg-[#5865F2] hover:bg-[#4752C4] text-white font-semibold text-sm rounded-lg transition-all duration-300 hover:shadow-[0_12px_36px_rgba(88,101,242,0.55),0_0_24px_rgba(94,106,210,0.4)] active:scale-[0.98] hover:scale-[1.01] disabled:opacity-60 disabled:hover:scale-100 relative overflow-hidden btn-sweep group"
      >
        {isLoading ? (
          <span className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Đang kết nối qua proxy...
          </span>
        ) : captcha && !hcaptchaToken ? (
          <span className="flex items-center gap-2">
            <Lock className="w-4 h-4" /> Vui lòng giải captcha trước
          </span>
        ) : lastSubmitAt && Date.now() - lastSubmitAt < 2000 ? (
          <span className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" /> Vui lòng đợi...
          </span>
        ) : (
          <span className="flex items-center gap-2">
            Đăng nhập <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
          </span>
        )}
      </Button>

      <div className="mt-4 flex items-center gap-2 text-[10px] text-white/30">
        <Lock className="w-3 h-3" />
        <span>Thông tin được gửi trực tiếp đến Discord qua kết nối được mã hóa.</span>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
 * QR Code login
 * ────────────────────────────────────────────────────────────── */

type QRStatus = "idle" | "loading_session" | "pending_scan" | "pending_confirm" | "captcha_required" | "success" | "expired" | "error";

type QRCaptchaChallenge = { sitekey: string; rqdata?: string; rqtoken?: string };

/**
 * hCaptcha widget for the captcha Discord asks for on the QR ticket exchange.
 * The challenge's rqdata is passed into the widget so the solved token is bound
 * to the same captcha request Discord issued.
 */
function QRCaptchaWidget({ challenge, onSolved, busy }: {
  challenge: QRCaptchaChallenge;
  onSolved: (token: string) => void;
  busy: boolean;
}) {
  const holderRef = useRef<HTMLDivElement | null>(null);
  const solvedRef = useRef(onSolved);
  solvedRef.current = onSolved;

  useEffect(() => {
    let cancelled = false;
    const w = window as unknown as {
      hcaptcha?: { render: (el: HTMLElement, opts: Record<string, unknown>) => unknown; reset?: (id?: unknown) => void };
      __dqaHcaptchaOnload?: () => void;
    };

    const renderWidget = () => {
      if (cancelled || !holderRef.current) return;
      if (!w.hcaptcha || typeof w.hcaptcha.render !== "function") return;
      holderRef.current.innerHTML = "";
      try {
        w.hcaptcha.render(holderRef.current, {
          sitekey: challenge.sitekey,
          theme: "dark",
          rqdata: challenge.rqdata || undefined,
          callback: (token: string) => solvedRef.current(token),
        });
      } catch {
        /* widget already rendered for this container */
      }
    };

    w.__dqaHcaptchaOnload = renderWidget;

    if (w.hcaptcha && typeof w.hcaptcha.render === "function") {
      renderWidget();
      return () => { cancelled = true; };
    }

    let script = document.getElementById("dqa-hcaptcha-api") as HTMLScriptElement | null;
    if (!script) {
      script = document.createElement("script");
      script.id = "dqa-hcaptcha-api";
      script.src = "https://js.hcaptcha.com/1/api.js?render=explicit&onload=__dqaHcaptchaOnload";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }

    // Safety net: if the onload callback already fired, poll for the API.
    const poll = setInterval(() => {
      if (w.hcaptcha && typeof w.hcaptcha.render === "function") {
        clearInterval(poll);
        renderWidget();
      }
    }, 400);
    const stop = setTimeout(() => clearInterval(poll), 15000);

    return () => {
      cancelled = true;
      clearInterval(poll);
      clearTimeout(stop);
    };
  }, [challenge.sitekey, challenge.rqdata]);

  return (
    <div className="mt-1">
      <div ref={holderRef} className="flex justify-center min-h-[78px]" />
      {busy && (
        <p className="mt-1 text-center text-[10px] text-white/50 flex items-center justify-center gap-1">
          <Loader2 className="w-3 h-3 animate-spin" /> Đang xác minh captcha...
        </p>
      )}
    </div>
  );
}

function QRLogin({ onLoginSuccess, parentLoading, onSwitchToToken }: {
  onLoginSuccess: (token: string, profile: DiscordProfileFromApi) => void;
  parentLoading: boolean;
  onSwitchToToken?: () => void;
}) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<QRStatus>("idle");
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [error, setError] = useState<string>("");
  const [logs, setLogs] = useState<Array<{ ts: number; level: string; message: string }>>([]);
  const [showLogs, setShowLogs] = useState(false);
  const [captcha, setCaptcha] = useState<QRCaptchaChallenge | null>(null);
  const [captchaBusy, setCaptchaBusy] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);  // Đếm ngược tới khi QR hết hạn
  const pollRef = useRef<NodeJS.Timeout | null>(null);
  const countdownRef = useRef<NodeJS.Timeout | null>(null);
  const autoRefreshRef = useRef<NodeJS.Timeout | null>(null);  // Auto-refresh sau 4 phút
  const cancelledRef = useRef(false);

  const cleanup = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    if (autoRefreshRef.current) {
      clearTimeout(autoRefreshRef.current);
      autoRefreshRef.current = null;
    }
  }, []);

  const cancelSession = useCallback(async () => {
    if (sessionId) {
      try {
        await fetch("/api/auth/qr/cancel", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
      } catch { /* ignore */ }
    }
  }, [sessionId]);

  const startSession = useCallback(async () => {
    if (cancelledRef.current) return;
    setStatus("loading_session");
    setError("");
    setQrImage(null);
    setSessionId(null);
    setCaptcha(null);
    setCaptchaBusy(false);
    setSecondsLeft(0);
    try {
      const res = await fetch("/api/auth/qr/start", { method: "POST" });
      const data = await res.json();
      if (!data.success) {
        throw new Error(data.error || "Không thể tạo phiên QR");
      }
      setSessionId(data.sessionId);
      if (data.qrImage) setQrImage(data.qrImage);
      setStatus(data.state === "error" ? "error" : "pending_scan");
      if (data.state === "error" && data.error) setError(data.error);

      // ─── Start countdown timer (Discord QR expires after ~5 min = 300s) ───
      // Hiển thị còn 4:59 → 0:00 để user biết QR sắp hết hạn
      const TOTAL_SECONDS = 290;  // 4 phút 50 giây (để dư 10s cho auto-refresh)
      setSecondsLeft(TOTAL_SECONDS);
      if (countdownRef.current) clearInterval(countdownRef.current);
      countdownRef.current = setInterval(() => {
        setSecondsLeft((prev) => {
          if (prev <= 1) {
            // Hết giờ — sẽ bị auto-refresh
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      // ─── Auto-refresh sau 4 phút (240s) — tránh bị Discord timeout ───
      // Trước khi user kịp thấy "QR hết hạn", tự động tạo mã mới
      if (autoRefreshRef.current) clearTimeout(autoRefreshRef.current);
      autoRefreshRef.current = setTimeout(() => {
        // Chỉ auto-refresh nếu đang pending_scan (chưa scan xong)
        // Nếu đang pending_confirm thì KHÔNG refresh (đang chờ user bấm "Yes" trên mobile)
        if (!cancelledRef.current) {
          setStatus((cur) => {
            if (cur === "pending_scan") {
              console.log("[QRAuth] Auto-refresh sau 4 phút (tránh timeout Discord)");
              void startSession();
            }
            return cur;
          });
        }
      }, 240 * 1000);
    } catch (err: any) {
      setStatus("error");
      setError(err.message);
    }
  }, []);

  const pollSession = useCallback(async (sid: string) => {
    if (cancelledRef.current) return;
    try {
      const res = await fetch(`/api/auth/qr/poll?sessionId=${encodeURIComponent(sid)}`, { cache: "no-store" });
      const data = await res.json();
      if (!data.success && data.state !== "expired" && data.state !== "error") {
        // ignore transient errors
        return;
      }
      // Update QR image if just received
      if (data.qrImage && !qrImage) setQrImage(data.qrImage);
      // Always update logs from server
      if (Array.isArray(data.logs)) setLogs(data.logs);

      switch (data.state) {
        case "pending_scan":
          setStatus("pending_scan");
          break;
        case "pending_confirm":
          setStatus("pending_confirm");
          break;
        case "captcha_required":
          setStatus("captcha_required");
          setCaptcha(data.captcha || null);
          break;
        case "success":
          setStatus("success");
          cleanup();
          if (data.token && data.profile) {
            onLoginSuccess(data.token, data.profile);
          }
          break;
        case "expired":
          setStatus("expired");
          setError(data.errorMessage || "Phiên hết hạn");
          cleanup();
          break;
        case "error":
          setStatus("error");
          setError(data.errorMessage || data.error || "Lỗi không xác định");
          cleanup();
          break;
      }
    } catch {
      /* ignore transient network errors — keep polling */
    }
  }, [cleanup, onLoginSuccess, qrImage]);

  /** Send the solved hCaptcha token back so the server can retry the exchange. */
  const solveCaptcha = useCallback(async (captchaToken: string) => {
    if (!sessionId || captchaBusy) return;
    setCaptchaBusy(true);
    setError("");
    try {
      const res = await fetch("/api/auth/qr/captcha", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, captchaToken }),
      });
      const data = await res.json();
      if (data.success && data.state === "success") {
        setStatus("success");
        cleanup();
        if (data.token && data.profile) onLoginSuccess(data.token, data.profile);
        return;
      }
      if (data.captcha) {
        // Discord issued a new challenge — render it again.
        setCaptcha(data.captcha);
        setError(data.error || "Captcha chưa được chấp nhận, giải lại giúp mình");
        setStatus("captcha_required");
        return;
      }
      setStatus("error");
      setError(data.error || "Captcha thất bại");
      cleanup();
    } catch (err: any) {
      setError(err.message || "Không gửi được captcha");
    } finally {
      setCaptchaBusy(false);
    }
  }, [sessionId, captchaBusy, cleanup, onLoginSuccess]);

  // Start session on mount
  useEffect(() => {
    cancelledRef.current = false;
    void startSession();
    return () => {
      cancelledRef.current = true;
      cleanup();
      // Best-effort cancel the active session so WS doesn't leak
      void cancelSession();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Start polling once we have a sessionId
  useEffect(() => {
    if (!sessionId) return;
    cleanup();
    // Immediate poll
    void pollSession(sessionId);
    // Then every 1.5s
    pollRef.current = setInterval(() => void pollSession(sessionId), 1500);
    return () => cleanup();
  }, [sessionId, cleanup, pollSession]);

  const isLoading = parentLoading || status === "success";
  const showRefresh = status === "expired" || status === "error" || status === "captcha_required";

  // Helper to render QR image
  const renderQr = () => {
    if (status === "loading_session" || (!qrImage && status === "pending_scan")) {
      return (
        <div className="w-[200px] h-[200px] rounded-xl bg-white/[0.04] border border-white/[0.08] flex flex-col items-center justify-center gap-2">
          <Loader2 className="w-6 h-6 animate-spin text-[#5865F2]" />
          <span className="text-[11px] text-white/50">Đang tạo mã QR...</span>
        </div>
      );
    }
    if (qrImage) {
      return (
        <div className="relative">
          {/* Pulse glow ring */}
          <div
            className="absolute -inset-1 rounded-xl opacity-50"
            style={{
              background: "linear-gradient(135deg, #5865F2 0%, #E879F9 100%)",
              filter: "blur(8px)",
              animation: status === "pending_confirm" ? "qr-pulse 1.4s ease-in-out infinite" : "qr-pulse 3s ease-in-out infinite",
            }}
          />
          <img
            src={qrImage}
            alt="Discord QR Code"
            className="relative w-[200px] h-[200px] rounded-xl bg-white p-2 object-contain"
            style={{
              filter: status === "pending_confirm" ? "none" : "none",
              opacity: status === "expired" ? 0.4 : 1,
              transition: "opacity 0.3s ease",
            }}
          />
          {/* Scan-line overlay when waiting for scan */}
          {status === "pending_scan" && (
            <div className="absolute inset-2 pointer-events-none overflow-hidden rounded-lg">
              <div
                className="absolute left-0 right-0 h-[3px]"
                style={{
                  background: "linear-gradient(90deg, transparent, #5865F2, transparent)",
                  animation: "qr-scan 2.5s linear infinite",
                }}
              />
            </div>
          )}
          {/* Confirm overlay */}
          {status === "pending_confirm" && (
            <div className="absolute inset-0 rounded-xl bg-black/60 flex flex-col items-center justify-center gap-1">
              <Smartphone className="w-7 h-7 text-[#3DD68C] animate-bounce" />
              <p className="text-[11px] text-white font-semibold">Đã quét!</p>
              <p className="text-[10px] text-white/60 text-center px-3">
                Mở Discord trên điện thoại<br/>và bấm <span className="text-[#3DD68C] font-semibold">"Yes, log me in"</span>
              </p>
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  return (
    <div>
      {/* QR display */}
      <div className="flex flex-col items-center gap-4 py-2">
        {renderQr()}

        {/* Status text */}
        <div className="text-center min-h-[40px]">
          {status === "loading_session" && (
            <p className="text-[12px] text-white/50">Đang chuẩn bị mã QR...</p>
          )}
          {status === "pending_scan" && (
            <div>
              <p className="text-[12px] text-white/80 font-medium">Quét mã QR bằng Discord</p>
              {secondsLeft > 0 && (
                <p className={`mt-1.5 text-[10px] font-mono ${secondsLeft < 60 ? "text-[#F5B544]" : "text-white/40"}`}>
                  ⏱ QR hết hạn sau {Math.floor(secondsLeft / 60)}:{String(secondsLeft % 60).padStart(2, "0")}
                  {secondsLeft < 60 && " — sắp tự động tạo mã mới"}
                </p>
              )}
            </div>
          )}
          {status === "pending_confirm" && (
            <div>
              <p className="text-[12px] text-[#3DD68C] font-medium">Đang chờ xác nhận trên điện thoại</p>
              <p className="text-[10px] text-white/40 mt-0.5">Vui lòng bấm "Yes, log me in" trên Discord mobile</p>
            </div>
          )}
          {status === "captcha_required" && (
            <div className="w-full">
              <p className="text-[12px] text-[#F5B544] font-medium">Discord yêu cầu captcha</p>
              <p className="text-[10px] text-white/40 mt-0.5">Giải captcha bên dưới để lấy token đăng nhập</p>
              {captcha ? (
                <QRCaptchaWidget challenge={captcha} onSolved={solveCaptcha} busy={captchaBusy} />
              ) : (
                <p className="mt-2 text-[10px] text-white/50 flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Đang lấy thử thách captcha...
                </p>
              )}
              {error && <p className="mt-1 text-[10px] text-[#F6606F]">{error}</p>}
              <p className="mt-2 text-[10px] leading-relaxed text-white/40">
                Discord hay từ chối captcha giải ngoài discord.com. Nếu giải mãi vẫn lỗi,
                {onSwitchToToken ? (
                  <>
                    {" "}
                    <button
                      type="button"
                      onClick={onSwitchToToken}
                      className="text-[#5865F2] hover:text-[#7C8FFF] underline transition-colors"
                    >
                      đăng nhập bằng token
                    </button>{" "}
                    sẽ chắc ăn hơn.
                  </>
                ) : (
                  " hãy đăng nhập bằng token."
                )}
              </p>
            </div>
          )}
          {status === "success" && (
            <p className="text-[12px] text-[#3DD68C] font-medium flex items-center justify-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> Đăng nhập thành công
            </p>
          )}
          {status === "expired" && (
            <div>
              <p className="text-[12px] text-[#F6606F] font-medium">Phiên QR kết thúc</p>
              <button
                type="button"
                onClick={() => setShowLogs(s => !s)}
                className="mt-1 text-[10px] text-white/50 hover:text-white/80 underline transition-colors"
              >
                {showLogs ? "Ẩn log" : "Xem log chi tiết"} ({logs.length})
              </button>
            </div>
          )}
          {status === "error" && (
            <div>
              <p className="text-[12px] text-[#F6606F] font-medium">Lỗi: {error}</p>
              <button
                type="button"
                onClick={() => setShowLogs(s => !s)}
                className="mt-1 text-[10px] text-white/50 hover:text-white/80 underline transition-colors"
              >
                {showLogs ? "Ẩn log" : "Xem log chi tiết"} ({logs.length})
              </button>
            </div>
          )}
        </div>

        {/* Log panel — shown when expired/error OR user toggled it */}
        {(showLogs || status === "expired" || status === "error") && logs.length > 0 && (
          <div className="mt-2 mb-2 max-h-[180px] overflow-y-auto rounded-lg bg-black/40 border border-white/[0.06] p-2 font-mono text-[10px] leading-relaxed">
            {logs.slice().reverse().map((log, i) => {
              const color =
                log.level === "error" ? "text-[#F6606F]"
                : log.level === "warn" ? "text-[#F5B544]"
                : log.level === "success" ? "text-[#3DD68C]"
                : "text-white/60";
              const time = new Date(log.ts).toLocaleTimeString("vi-VN", { hour12: false });
              return (
                <div key={i} className="flex gap-2">
                  <span className="text-white/30 shrink-0">{time}</span>
                  <span className={`uppercase font-bold shrink-0 w-10 ${color}`}>{log.level}</span>
                  <span className={color}>{log.message}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Live log toggle when QR is active */}
        {(status === "pending_scan" || status === "pending_confirm") && logs.length > 0 && (
          <button
            type="button"
            onClick={() => setShowLogs(s => !s)}
            className="mt-2 text-[10px] text-white/40 hover:text-white/70 underline transition-colors"
          >
            {showLogs ? "Ẩn log" : `Xem log (${logs.length})`}
          </button>
        )}

        {showLogs && (status === "pending_scan" || status === "pending_confirm") && logs.length > 0 && (
          <div className="mt-1 max-h-[120px] overflow-y-auto rounded-lg bg-black/40 border border-white/[0.06] p-2 font-mono text-[10px] leading-relaxed">
            {logs.slice().reverse().map((log, i) => {
              const color =
                log.level === "error" ? "text-[#F6606F]"
                : log.level === "warn" ? "text-[#F5B544]"
                : log.level === "success" ? "text-[#3DD68C]"
                : "text-white/60";
              const time = new Date(log.ts).toLocaleTimeString("vi-VN", { hour12: false });
              return (
                <div key={i} className="flex gap-2">
                  <span className="text-white/30 shrink-0">{time}</span>
                  <span className={`uppercase font-bold shrink-0 w-10 ${color}`}>{log.level}</span>
                  <span className={color}>{log.message}</span>
                </div>
              );
            })}
          </div>
        )}

        {/* Refresh button */}
        {showRefresh && (
          <Button
            onClick={() => { cleanup(); void startSession(); }}
            disabled={isLoading}
            variant="outline"
            className="h-9 px-4 bg-white/[0.04] border-white/[0.1] hover:bg-white/[0.08] text-white text-[12px] rounded-lg"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Tạo mã mới
          </Button>
        )}
      </div>

      <style jsx>{`
        @keyframes qr-pulse {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 0.6; transform: scale(1.02); }
        }
        @keyframes qr-scan {
          0% { top: 0; }
          100% { top: 100%; }
        }
      `}</style>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────
 * Main LoginPage
 * ────────────────────────────────────────────────────────────── */

export default function LoginPage() {
  // UI hiện chỉ mount TokenLogin (Email/QR đã bỏ theo yêu cầu trước đó),
  // nên giữ "token" để khối báo lỗi "Token hết hạn" vẫn hiển thị.
  const [tab, setTab] = useState<LoginTab>("token");
  const [loginSuccess, setLoginSuccess] = useState(false);
  // UI chọn server đã bỏ — luôn để "auto" (server tự chọn proxy tốt nhất)
  const [proxyCountry] = useState("auto");
  const [error] = useState(() => {
    if (typeof window !== "undefined") {
      try {
        const expired = sessionStorage.getItem("dq_token_expired");
        if (expired) {
          sessionStorage.removeItem("dq_token_expired");
          return "Token hết hạn, vui lòng nhập lại";
        }
      } catch { /* ignore */ }
    }
    return "";
  });
  const login = useAppStore((s) => s.login);

  const handleLoginSuccess = useCallback((token: string, profile: DiscordProfileFromApi) => {
    setLoginSuccess(true);
    setTimeout(() => { login(token, profile as any); }, 900);
  }, [login]);

  const features = [
    { icon: Zap, title: "Tự động 24/7", desc: "Hệ thống kiểm tra Discord mỗi 60 giây và xử lý mọi quest chưa hoàn thành — không cần bấm gì thêm.", color: "#5865F2" },
    { icon: Clock, title: "Chạy ngầm offline", desc: "Đóng tab vẫn tiếp tục làm quest. Token lưu theo phiên đăng nhập, hết hạn khi đăng xuất Discord.", color: "#3DD68C" },
    { icon: Trophy, title: "Theo dõi orbs", desc: "Quản lý orbs real-time ngay trên dashboard. Theo dõi tiến độ và phần thưởng của mọi quest.", color: "#F5B544" },
  ];

  return (
    <div
      className="h-screen flex flex-col relative overflow-y-auto scrollbar-hide"
      style={loginSuccess ? { animation: "login-page-out 600ms cubic-bezier(0.4, 0, 0.2, 1) 400ms forwards" } : undefined}
    >
      {/* ─── Aurora mesh background (CSS-only — no framer-motion) ─── */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div
          className="absolute top-[-15%] left-[-10%] w-[60vw] h-[60vw] rounded-full aurora-blob-1 gpu-layer"
          style={{ background: "radial-gradient(circle, rgba(94, 106, 210, 0.4) 0%, rgba(94, 106, 210, 0.1) 35%, transparent 65%)" }}
        />
        <div
          className="absolute bottom-[-20%] right-[-10%] w-[55vw] h-[55vw] rounded-full aurora-blob-2 gpu-layer"
          style={{ background: "radial-gradient(circle, rgba(232, 121, 249, 0.28) 0%, rgba(232, 121, 249, 0.08) 35%, transparent 65%)" }}
        />
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[40vw] h-[40vw] rounded-full aurora-blob-3 gpu-layer"
          style={{ background: "radial-gradient(circle, rgba(61, 214, 140, 0.15) 0%, rgba(61, 214, 140, 0.04) 40%, transparent 70%)" }}
        />
      </div>

      {/* ─── Top nav ─── */}
      <header className="relative z-10 px-6 lg:px-10 py-5 animate-fade-up">
      </header>

      {/* ─── Main: 2-column hero layout ─── */}
      <main className="flex-1 grid lg:grid-cols-2 gap-8 lg:gap-16 px-6 lg:px-12 xl:px-16 py-6 lg:py-12 relative z-10 max-w-[1400px] mx-auto w-full">
        {/* LEFT: hero content */}
        <div className="flex flex-col justify-center">
          {/* Status pill */}
          <div
            className="inline-flex self-start items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.08] mb-6 animate-fade-up"
            style={{ animationDelay: "50ms" }}
          >
            <span className="dot dot-success" />
            <span className="text-[11px] font-mono text-white/60 tracking-wide">SYSTEM ONLINE</span>
          </div>

          {/* Headline */}
          <h1
            className="text-display text-4xl lg:text-5xl xl:text-6xl text-white mb-5 leading-[1.05] animate-fade-up"
            style={{ animationDelay: "100ms" }}
          >
            Tự động hoàn thành
            <br />
            <span className="text-gradient-aurora">Discord Quests</span>
          </h1>

          <p
            className="text-white/50 text-base lg:text-lg leading-relaxed max-w-md mb-8 animate-fade-up"
            style={{ animationDelay: "150ms" }}
          >
            Đăng nhập bằng Token hoặc mã QR — hệ thống chạy ngầm trên server,
            đóng tab vẫn tiếp tục làm quest.
          </p>

          {/* Feature list */}
          <div className="space-y-3 mb-8 max-w-md">
            {features.map((feat, i) => {
              const Icon = feat.icon;
              return (
                <div
                  key={feat.title}
                  className="flex items-start gap-3 animate-fade-up"
                  style={{ animationDelay: `${200 + i * 60}ms` }}
                >
                  <div
                    className="w-9 h-9 rounded-md flex items-center justify-center shrink-0 transition-transform duration-300 hover:scale-110"
                    style={{ background: `${feat.color}1A`, border: `1px solid ${feat.color}30`, color: feat.color }}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <div>
                    <p className="text-[14px] font-semibold text-white leading-tight">{feat.title}</p>
                    <p className="text-[12px] text-white/50 leading-relaxed mt-1">{feat.desc}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT: login card */}
        <div className="flex items-center justify-center animate-scale-in" style={{ animationDelay: "150ms" }}>
          <div className={`glass rounded-2xl p-6 lg:p-8 w-full max-w-[440px] transition-all duration-500 ${loginSuccess ? "login-success-anim" : ""}`}>
            {/* Card header */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-md flex items-center justify-center bg-[#5865F2]/15 border border-[#5865F2]/25">
                  <ShieldCheck className="w-4 h-4 text-[#5865F2]" />
                </div>
                <div>
                  <p className="text-[14px] font-semibold text-white">Đăng nhập</p>
                  <p className="text-[11px] text-white/40">Chọn phương thức đăng nhập</p>
                </div>
              </div>
              <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-white/[0.03] border border-white/[0.06]">
                <Fingerprint className="w-3 h-3 text-white/40" />
                <span className="text-[9px] font-mono text-white/50 uppercase tracking-wider">Secure</span>
              </div>
            </div>

            {/* TOS warning */}
            <div className="mb-5 flex items-start gap-2.5 p-3 rounded-lg bg-[#F6606F]/[0.08] border border-[#F6606F]/20">
              <AlertTriangle className="w-4 h-4 text-[#F6606F] shrink-0 mt-0.5" />
              <div>
                <p className="text-[12px] font-semibold text-[#F6606F] mb-0.5">Vi phạm Điều khoản Discord</p>
                <p className="text-[11px] text-white/50 leading-relaxed">
                  Công cụ này vi phạm TOS Discord. Tài khoản có thể bị đình chỉ.
                </p>
              </div>
            </div>

            {/* Persistent error from previous session */}
            {error && tab === "token" && (
              <div className="mb-3 flex items-center gap-2 p-2.5 rounded-lg bg-[#F6606F]/[0.08] border border-[#F6606F]/20 text-[#F6606F] text-xs">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                {error}
              </div>
            )}

            {/* Đăng nhập: Token hoặc QR */}
            <TabBar tab={tab} setTab={setTab} disabled={loginSuccess} />
            {tab === "qr" ? (
              <QRLogin
                onLoginSuccess={handleLoginSuccess}
                parentLoading={loginSuccess}
                onSwitchToToken={() => setTab("token")}
              />
            ) : (
              <TokenLogin onLoginSuccess={handleLoginSuccess} parentLoading={loginSuccess} proxyCountry={proxyCountry} />
            )}

          </div>
        </div>
      </main>

      {/* ─── Footer ─── */}
      <footer
        className="relative z-10 px-6 lg:px-10 py-4 flex items-center justify-between text-[10px] font-mono text-white/30 border-t border-white/[0.04] animate-fade-up"
        style={{ animationDelay: "350ms" }}
      >
        <span>© 2026 Discord Quest Auto</span>
        <span className="hidden sm:inline">Aurora Edition</span>
      </footer>

      {/* ─── Inline animations ─── */}
      <style jsx>{`
        .login-success-anim {
          animation: login-success 900ms cubic-bezier(0.4, 0, 0.2, 1) forwards;
        }
        @keyframes login-success {
          0% { transform: scale(1); opacity: 1; }
          30% { transform: scale(1.02); }
          60% { transform: scale(0.98); opacity: 0.9; }
          100% { transform: scale(0.95); opacity: 0; }
        }
        .login-success-text {
          animation: success-glow 900ms ease-out;
        }
        @keyframes success-glow {
          0%, 100% { text-shadow: 0 0 0 transparent; }
          50% { text-shadow: 0 0 12px rgba(255, 255, 255, 0.6); }
        }
        @keyframes login-page-out {
          0% { opacity: 1; }
          100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
}
