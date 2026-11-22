"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useAppStore } from "@/lib/store";
import { verifyTokenLocal, loginPasswordLocal, submitMfaLocal, registerSessionLocal } from "@/lib/localLogin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ShieldCheck, Eye, EyeOff, AlertTriangle, ArrowRight,
  Zap, Clock, Trophy, Lock, Fingerprint,
  ChevronRight, KeyRound, Globe, Loader2, Check, MapPin, Smartphone, CheckCircle2, RefreshCw,
  Clipboard, Sparkles,
} from "lucide-react";

/* Discord SVG logo path (preserved per hard constraint #5) */
const DISCORD_PATH = "M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189z";

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
  const [pasted, setPasted] = useState(false);
  const [preview, setPreview] = useState<null | { id: string; username: string; global_name: string | null; discriminator: string; avatar: string | null; locale: string | null; verified: boolean; country: string | null }>(null);
  const [previewing, setPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [platform, setPlatform] = useState<"pc" | "android">("pc");

  const handleLogin = async () => {
    if (!tokenInput.trim()) { setError("Vui lòng nhập Discord token"); return; }
    setLoading(true);
    setError("");
    setStatus("connecting");

    try {
      // Step 1: Gửi login + proxyCountry → server assign proxy + verify token
      // Server sẽ đợi proxy kết nối thành công trước khi verify token
      // Timeout phía client: server có thể thử 3 proxy × verify token, nếu treo
      // quá lâu thì báo rõ thay vì quay vòng "Đang xử lý..." mãi.
      // Xác thực token NGAY TRONG TRÌNH DUYỆT: request đi từ IP mạng thật của
      // máy, không qua Render cũng không qua proxy. Server chỉ tạo phiên.
      const local = await verifyTokenLocal(tokenInput.trim());
      if (!local.ok) {
        setError(local.status === 401 ? "Token không hợp lệ hoặc đã hết hạn" : "Không kết nối được tới Discord, thử lại");
        setStatus("");
        setLoading(false);
        return;
      }
      const serverProfile = await registerSessionLocal(tokenInput.trim(), local.profile!, platform);
      setStatus("connected");
      onLoginSuccess(tokenInput.trim(), (serverProfile || local.profile)!);
      setLoading(false);
      return;
      // eslint-disable-next-line no-unreachable
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenInput.trim(), proxyCountry, platform }),
        signal: AbortSignal.timeout(120000),
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
        setError(
          data.maintenance
            ? "Hệ thống đang bảo trì, vui lòng quay lại sau ít phút."
            : data.error || "Token không hợp lệ",
        );
        setStatus("");
        setLoading(false);
        return;
      }
      // Login success
      setStatus("connected");
      onLoginSuccess(tokenInput.trim(), data.profile);
    } catch (err: any) {
      const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
      setError(
        timedOut
          ? "Máy chủ phản hồi quá lâu (quá 2 phút). Thử lại, nếu vẫn vậy thì đổi proxy khác."
          : "Lỗi kết nối: " + err.message,
      );
      setStatus("");
      setLoading(false);
    }
  };

  const isLoading = loading || parentLoading;
  const tokenLen = tokenInput.trim().length;
  const looksValid = tokenLen >= 50;

  const ccFlag = (cc: string) =>
    /^[A-Za-z]{2}$/.test(cc) ? String.fromCodePoint(...cc.toUpperCase().split("").map((c) => 127397 + c.charCodeAt(0))) : "🌐";


  // Tự quét mỗi khi token thay đổi (debounce 700ms) — không có nút bấm nào cả.
  useEffect(() => {
    const t = tokenInput.trim();
    if (t.length < 20) { setPreview(null); setPreviewError(""); setPreviewing(false); return; }
    setPreview(null); setPreviewError("");
    setPreviewing(true);
    let cancelled = false;
    const id = setTimeout(async () => {
      try {
        const res = await fetch("/api/auth/preview", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: t }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (data?.success && data.account) setPreview({ ...data.account, country: data.country || null });
        else setPreviewError(data?.error || "Token không hợp lệ");
      } catch {
        if (!cancelled) setPreviewError("Không kết nối được máy chủ");
      } finally {
        if (!cancelled) setPreviewing(false);
      }
    }, 700);
    return () => { cancelled = true; clearTimeout(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokenInput]);

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) { setTokenInput(text.trim()); setError(""); setPasted(true); setTimeout(() => setPasted(false), 1400); }
    } catch {
      /* trình duyệt chặn clipboard → để người dùng tự dán */
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-[11px] font-semibold text-white/45 uppercase tracking-[0.14em]">
          Discord Token
        </label>
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-mono tabular-nums transition-colors duration-300 ${
            looksValid ? "text-[#3DD68C]" : tokenLen > 0 ? "text-white/40" : "text-white/20"
          }`}>
            {tokenLen > 0 ? `${tokenLen} ký tự` : "chưa nhập"}
          </span>
        </div>
      </div>

      <div className={`token-shell mb-3 ${looksValid ? "is-valid" : ""}`}>
        <div className="relative rounded-[0.9rem] bg-white/[0.035] border border-white/[0.08] overflow-hidden">
          <div className="absolute inset-y-0 left-0 w-9 flex items-center justify-center pointer-events-none">
            <KeyRound className={`w-4 h-4 transition-colors duration-300 ${looksValid ? "text-[#3DD68C]" : "text-white/25"}`} />
          </div>
          <Input
            type={showToken ? "text" : "password"}
            placeholder="Dán token tài khoản Discord..."
            value={tokenInput}
            onChange={(e) => { setTokenInput(e.target.value); if (error) setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && !isLoading && handleLogin()}
            autoComplete="off"
            data-form-type="other"
            data-lpignore="true"
            disabled={isLoading}
            className="h-14 pl-9 pr-[92px] bg-transparent border-0 text-white placeholder:text-white/25 font-mono text-[13px] tracking-tight focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
            <button
              type="button"
              onClick={pasteFromClipboard}
              disabled={isLoading}
              tabIndex={-1}
              title="Dán từ clipboard"
              className="h-8 px-2 rounded-lg flex items-center gap-1 text-[11px] font-medium text-white/45 hover:text-white hover:bg-white/[0.07] transition-all duration-200 disabled:opacity-40"
            >
              {pasted ? <Check className="w-3.5 h-3.5 text-[#3DD68C]" /> : <Clipboard className="w-3.5 h-3.5" />}
              <span className="hidden sm:inline">{pasted ? "Đã dán" : "Dán"}</span>
            </button>
            <button
              type="button"
              onClick={() => setShowToken(!showToken)}
              tabIndex={-1}
              title={showToken ? "Ẩn token" : "Hiện token"}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-white/40 hover:text-white hover:bg-white/[0.07] transition-all duration-200"
            >
              {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      <div className={`grid transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${tokenLen >= 20 ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
        <div className="overflow-hidden">
        <div className="mb-3 rounded-xl border border-white/[0.08] bg-white/[0.04] p-3">
          {previewing && !preview ? (
            <p className="text-[12px] text-white/50 flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />Đang kiểm tra token...
            </p>
          ) : previewError ? (
            <p className="text-[12px] text-[#F5B544] flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />{previewError}
            </p>
          ) : preview && (
            <div className="flex items-center gap-3">
              <img
                src={preview.avatar
                  ? `https://cdn.discordapp.com/avatars/${preview.id}/${preview.avatar}.png?size=64`
                  : `https://cdn.discordapp.com/embed/avatars/${Number(preview.discriminator || 0) % 5}.png`}
                alt=""
                className="w-9 h-9 rounded-full ring-1 ring-white/10 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-white truncate">
                  {preview.global_name || preview.username}
                  {preview.discriminator !== "0" && <span className="text-white/35 font-normal">#{preview.discriminator}</span>}
                </p>
                <p className="text-[10px] font-mono text-white/35 truncate">
                  {preview.username} · {preview.id}
                </p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-[13px] leading-none">{preview.country ? ccFlag(preview.country) : "🌐"}</p>
                <p className="text-[9px] text-white/30 mt-1 uppercase tracking-wide">{preview.country || "không rõ"}</p>
              </div>
            </div>
          )}
          {!preview && (
            <p className="text-[9px] text-white/25 mt-2">
              {previewing ? "Đang quét token..." : "Token chưa hợp lệ, chưa thể đăng nhập"}
            </p>
          )}
        </div>
        </div>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 p-2.5 rounded-xl bg-[#F6606F]/[0.08] border border-[#F6606F]/20 text-[#F6606F] text-xs animate-lp-shake">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" />
          <span className="leading-relaxed">{error}</span>
        </div>
      )}

      <div className={`grid transition-all duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] ${preview ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0 pointer-events-none"}`}>
      <div className="overflow-hidden">
      <div className="mb-3 animate-lp-pop">
        <p className="text-[10px] text-white/35 mb-1.5">Token này lấy từ đâu?</p>
        <div className="flex gap-1.5 p-1 rounded-xl bg-white/[0.04] border border-white/[0.07]">
          {([
            { key: "pc", label: "PC (web)" },
            { key: "android", label: "Android" },
          ] as const).map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setPlatform(opt.key)}
              className={`flex-1 h-9 rounded-lg text-[12px] font-medium transition-all duration-300 ${
                platform === opt.key
                  ? "bg-[linear-gradient(135deg,#5865F2_0%,#8B5CF6_100%)] text-white shadow-[0_8px_20px_-10px_rgba(109,91,246,0.9)]"
                  : "text-white/45 hover:text-white/70"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <p className="text-[9px] text-white/25 mt-1.5">
          Chọn đúng nơi tạo token: PC dùng Chrome Windows, Android dùng WebView Chrome 154.
        </p>
      </div>

      <Button
        onClick={handleLogin}
        disabled={isLoading || !tokenInput.trim()}
        className="btn-shine group relative overflow-hidden w-full h-14 rounded-xl font-semibold text-[14px] text-white transition-all duration-300
                   bg-[linear-gradient(135deg,#5865F2_0%,#6D5BF6_45%,#8B5CF6_100%)]
                   hover:shadow-[0_18px_46px_-12px_rgba(109,91,246,0.85)]
                   active:scale-[0.985] hover:-translate-y-[1px]
                   disabled:opacity-55 disabled:hover:translate-y-0 disabled:hover:shadow-none"
      >
        {status === "connected" ? (
          <span className="flex items-center gap-2 animate-lp-pop">
            <CheckCircle2 className="w-4 h-4" /> Đã đăng nhập
          </span>
        ) : isLoading ? (
          <span className="flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            {status === "connecting" ? "Đang xử lý..." : "Đang đăng nhập..."}
          </span>
        ) : (
          <span className="flex items-center gap-2">
            Đăng nhập
            <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" />
          </span>
        )}
        {isLoading && status !== "connected" && (
          <span className="lp-progress"><span /></span>
        )}
      </Button>

      </div>
      </div>

      <div className="mt-4 flex items-center justify-center gap-1.5 text-[10.5px] text-white/30">
        <Lock className="w-3 h-3" />
        <span>Token chỉ dùng trong phiên, hết hạn khi đăng xuất Discord</span>
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
      // Đăng nhập email/mật khẩu NGAY TRONG TRÌNH DUYỆT (IP mạng thật).
      const localResult = await loginPasswordLocal({
        login: loginInput.trim(),
        password,
        captchaKey: captchaToken || hcaptchaToken || undefined,
        captchaRqtoken: captcha?.rqtoken,
        captchaSessionId: captcha?.sessionId,
      });
      if (localResult.state === "success") {
        const serverProfile = await registerSessionLocal(localResult.token, localResult.profile);
        onLoginSuccess(localResult.token, (serverProfile || localResult.profile)!);
        return;
      }
      if (localResult.state === "captcha_required") {
        setCaptcha({
          sitekey: localResult.sitekey || "",
          service: localResult.service || "hcaptcha",
          rqdata: localResult.rqdata || "",
          sessionId: "",
          rqtoken: localResult.rqtoken || "",
        });
        setHcaptchaToken(null);
        setError("");
        setLoading(false);
        return;
      }
      if (localResult.state === "mfa_required") {
        setMfa({ ticket: localResult.ticket, method: localResult.method } as never);
        setError("");
        setLoading(false);
        return;
      }
      setError(localResult.error || "Đăng nhập thất bại");
      setHcaptchaToken(null);
      if (hcaptchaWidgetId !== null && (window as any).hcaptcha) {
        try { (window as any).hcaptcha.reset(hcaptchaWidgetId); } catch { /* ignore */ }
      }
      setLoading(false);
      return;
      // eslint-disable-next-line no-unreachable
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
      // Xác nhận 2FA NGAY TRONG TRÌNH DUYỆT (IP mạng thật).
      const localMfa = await submitMfaLocal({ ticket: mfa.ticket, code: mfaCode.trim(), method: mfa.method as never });
      if (localMfa.ok && localMfa.token) {
        const serverProfile = await registerSessionLocal(localMfa.token, localMfa.profile!);
        onLoginSuccess(localMfa.token, (serverProfile || localMfa.profile)!);
        return;
      }
      setError(localMfa.error || "Mã MFA không đúng");
      setLoading(false);
      return;
      // eslint-disable-next-line no-unreachable
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
 * Main LoginPage
 * ────────────────────────────────────────────────────────────── */

export default function LoginPage() {
  // Owner yêu cầu: mặc định đăng nhập bằng email + mật khẩu.
  const [loginMode, setLoginMode] = useState<"email" | "token">("token"); // owner: chỉ chừa token
  // UI hiện chỉ mount TokenLogin (Email/QR đã bỏ theo yêu cầu trước đó),
  // nên giữ "token" để khối báo lỗi "Token hết hạn" vẫn hiển thị.
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
  const [oauthError, setOauthError] = useState("");

  // Chế độ bảo trì: proxy hết dung lượng (407) thì login chắc chắn fail, nên báo
  // "đang bảo trì" thay vì để người dùng dán token rồi ăn lỗi đỏ.
  const [maintenance, setMaintenance] = useState<{ reason: string; retryInSeconds: number } | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);

  const refreshStatus = useCallback(async () => {
    setCheckingStatus(true);
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      const data = await res.json();
      setMaintenance(data?.maintenance ? { reason: data.reason || "Đang bảo trì", retryInSeconds: data.retryInSeconds || 0 } : null);
    } catch {
      /* giữ nguyên trạng thái cũ */
    } finally {
      setCheckingStatus(false);
    }
  }, []);

  useEffect(() => {
    refreshStatus();
    const t = setInterval(refreshStatus, 60_000);
    return () => clearInterval(t);
  }, [refreshStatus]);

  // Nhận kết quả từ luồng OAuth Discord (?discord_login=1 | ?discord_error=...)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const oauthErr = params.get("discord_error");
    if (oauthErr) {
      setOauthError(oauthErr);
      window.history.replaceState({}, "", "/");
      return;
    }
    if (params.get("discord_login") !== "1") return;
    window.history.replaceState({}, "", "/");
    fetch("/api/auth/discord/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: any) => {
        if (d?.success && d.token) handleLoginSuccess(d.token, d.profile);
        else setOauthError(d?.error || "Đăng nhập Discord thất bại.");
      })
      .catch(() => setOauthError("Đăng nhập Discord thất bại."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      className="h-[100dvh] w-full max-w-full flex flex-col relative overflow-y-auto overflow-x-hidden scrollbar-hide"
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

        {/* Tia sáng quét chéo + bụi lơ lửng cho cảm giác "sống" */}
        <div className="lp-beam" style={{ left: "8%", animationDelay: "0s" }} />
        <div className="lp-beam" style={{ left: "58%", animationDelay: "-6s" }} />
        {[
          { top: "18%", left: "12%", d: "0s" },
          { top: "34%", left: "78%", d: "-2.5s" },
          { top: "62%", left: "24%", d: "-4s" },
          { top: "76%", left: "68%", d: "-1.5s" },
          { top: "46%", left: "46%", d: "-6s" },
          { top: "12%", left: "58%", d: "-3.5s" },
        ].map((dot, i) => (
          <span key={i} className="lp-dust" style={{ top: dot.top, left: dot.left, animationDelay: dot.d }} />
        ))}

        {/* Lưới mờ tạo chiều sâu */}
        <div
          className="absolute inset-0 opacity-[0.16]"
          style={{
            backgroundImage:
              "linear-gradient(to right, rgba(255,255,255,0.07) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.07) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage: "radial-gradient(circle at 50% 40%, black 0%, transparent 72%)",
            WebkitMaskImage: "radial-gradient(circle at 50% 40%, black 0%, transparent 72%)",
          }}
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
            Đăng nhập bằng token tài khoản — hệ thống chạy ngầm trên server,
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
          <div
            onMouseMove={(e) => {
              const el = e.currentTarget;
              const r = el.getBoundingClientRect();
              el.style.setProperty("--mx", `${e.clientX - r.left}px`);
              el.style.setProperty("--my", `${e.clientY - r.top}px`);
            }}
            className={`login-spot glass rounded-3xl p-6 lg:p-8 w-full max-w-[460px] transition-all duration-500 ${loginSuccess ? "login-success-anim" : ""}`}
          >
            {/* Card header */}
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-md flex items-center justify-center bg-[#5865F2]/15 border border-[#5865F2]/25">
                  <ShieldCheck className="w-4 h-4 text-[#5865F2]" />
                </div>
                <div>
                  <p className="text-[14px] font-semibold text-white">Đăng nhập</p>
                  <p className="text-[11px] text-white/40">Dán token tài khoản để bắt đầu</p>
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
            {error && (
              <div className="mb-3 flex items-center gap-2 p-2.5 rounded-lg bg-[#F6606F]/[0.08] border border-[#F6606F]/20 text-[#F6606F] text-xs">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                {error}
              </div>
            )}

            {maintenance ? (
              <div className="rounded-xl border border-[#F5B544]/25 bg-[#F5B544]/[0.06] p-5 text-center">
                <Loader2 className="w-5 h-5 text-[#F5B544] animate-spin mx-auto mb-3" />
                <p className="text-[14px] font-semibold text-[#F5B544] mb-1.5">Hệ thống đang bảo trì</p>
           <>
              <TokenLogin onLoginSuccess={handleLoginSuccess} parentLoading={loginSuccess} proxyCountry={proxyCountry} />
            </>    </div>
            ) : (
              <>
                <TokenLogin onLoginSuccess={handleLoginSuccess} parentLoading={loginSuccess} proxyCountry={proxyCountry} />
              </>
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
