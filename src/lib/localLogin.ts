/**
 * Đăng nhập Discord NGAY TRONG TRÌNH DUYỆT người dùng.
 *
 * Owner chốt 22/11/2026: "thêm login từ ip của máy mình chứ không phải render
 * cả email và token". Toàn bộ request mang token/mật khẩu đi từ IP mạng thật
 * của thiết bị, server Render chỉ tạo phiên và trả hồ sơ, không gọi Discord.
 *
 * Discord trả access-control-allow-origin đúng theo Origin gọi tới và cho phép
 * header X-Super-Properties / X-Fingerprint / X-Captcha-* nên trình duyệt gọi
 * thẳng /auth/login được (đã kiểm bằng preflight thật).
 */

const API = "https://discord.com/api/v9";

export type LocalProfile = {
  id: string;
  username: string;
  global_name?: string | null;
  discriminator?: string | null;
  avatar?: string | null;
  email?: string | null;
  phone?: string | null;
  mfa_enabled?: boolean;
  flags?: number;
  premium_type?: number;
  locale?: string | null;
  verified?: boolean;
  banner?: string | null;
  accent_color?: number | null;
};

function superProps(): string {
  const nav = typeof navigator !== "undefined" ? navigator : ({} as Navigator);
  const raw = {
    os: "Windows",
    browser: "Chrome",
    device: "",
    system_locale: nav.language || "vi-VN",
    browser_user_agent: nav.userAgent || "",
    browser_version: "157.0.0.0",
    os_version: "10",
    referrer: "",
    referring_domain: "",
    release_channel: "stable",
    client_build_number: 678976,
    client_event_source: null,
  };
  try {
    return btoa(unescape(encodeURIComponent(JSON.stringify(raw))));
  } catch {
    return "";
  }
}

function fingerprint(): string {
  try {
    const k = "dqa_fp";
    const saved = localStorage.getItem(k);
    if (saved) return saved;
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    const fp = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
    localStorage.setItem(k, fp);
    return fp;
  } catch {
    return "0".repeat(32);
  }
}

function baseHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "X-Super-Properties": superProps(),
    "X-Fingerprint": fingerprint(),
    "X-Discord-Locale": "vi",
    "X-Discord-Timezone": "Asia/Saigon",
    ...extra,
  };
}

function mapProfile(p: any): LocalProfile {
  return {
    id: String(p.id),
    username: p.username,
    global_name: p.global_name ?? null,
    discriminator: p.discriminator ?? "0",
    avatar: p.avatar ?? null,
    email: p.email ?? null,
    phone: p.phone ?? null,
    mfa_enabled: !!p.mfa_enabled,
    flags: p.public_flags || 0,
    premium_type: p.premium_type || 0,
    locale: p.locale ?? null,
    verified: p.verified === true,
    banner: p.banner ?? null,
    accent_color: p.accent_color ?? null,
  };
}

/** Xác thực token bằng IP mạng thật. */
export async function verifyTokenLocal(token: string): Promise<{ ok: boolean; status: number; profile?: LocalProfile }> {
  try {
    const res = await fetch(`${API}/users/@me`, {
      headers: baseHeaders({ Authorization: token.trim() }),
    });
    if (res.status !== 200) return { ok: false, status: res.status };
    const p = await res.json();
    return { ok: true, status: 200, profile: mapProfile(p) };
  } catch {
    return { ok: false, status: 0 };
  }
}

export type PasswordResult =
  | { state: "success"; token: string; profile: LocalProfile }
  | { state: "captcha_required"; sitekey?: string; service?: string; rqdata?: string; rqtoken?: string }
  | { state: "mfa_required"; ticket: string; method: "totp" | "sms" | "webauthn" }
  | { state: "error"; error: string };

/** Đăng nhập email/số điện thoại + mật khẩu, chạy từ IP mạng thật. */
export async function loginPasswordLocal(input: {
  login: string;
  password: string;
  captchaKey?: string;
  captchaRqtoken?: string;
  captchaSessionId?: string;
}): Promise<PasswordResult> {
  const body: Record<string, unknown> = {
    login: input.login,
    password: input.password,
    undelete: false,
    login_source: null,
    gift_code_sku_id: null,
  };
  if (input.captchaKey) {
    body.captcha_key = [input.captchaKey];
    if (input.captchaRqtoken) body.captcha_rqtoken = input.captchaRqtoken;
  }
  try {
    const res = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: baseHeaders(input.captchaSessionId ? { "X-Captcha-Session-Id": input.captchaSessionId } : undefined),
      body: JSON.stringify(body),
    });
    const data: any = await res.json().catch(() => ({}));

    if (res.ok && data.token) {
      const v = await verifyTokenLocal(data.token);
      return {
        state: "success",
        token: data.token,
        profile: v.profile || mapProfile({ id: "0", username: "unknown" }),
      };
    }
    if (data?.captcha_sitekey || data?.captcha_key?.length) {
      return {
        state: "captcha_required",
        sitekey: data.captcha_sitekey,
        service: data.captcha_service,
        rqdata: data.captcha_rqdata,
        rqtoken: data.captcha_rqtoken,
      };
    }
    if (data?.mfa && data?.ticket) {
      return {
        state: "mfa_required",
        ticket: data.ticket,
        method: data.sms ? "sms" : data.webauthn ? "webauthn" : "totp",
      };
    }
    return { state: "error", error: data?.message || `Đăng nhập thất bại (HTTP ${res.status})` };
  } catch (e) {
    return { state: "error", error: "Lỗi kết nối tới Discord: " + (e instanceof Error ? e.message : String(e)) };
  }
}

/** Xác nhận mã 2FA, chạy từ IP mạng thật. */
export async function submitMfaLocal(input: {
  ticket: string;
  code: string;
  method: "totp" | "sms" | "webauthn";
}): Promise<{ ok: boolean; token?: string; profile?: LocalProfile; error?: string }> {
  try {
    const path = input.method === "sms" ? "/auth/mfa/sms" : "/auth/mfa/totp";
    const body: Record<string, unknown> = {
      code: input.code,
      ticket: input.ticket,
      login_source: null,
      gift_code_sku_id: null,
    };
    const res = await fetch(`${API}${path}`, {
      method: "POST",
      headers: baseHeaders(),
      body: JSON.stringify(body),
    });
    const data: any = await res.json().catch(() => ({}));
    if (res.ok && data.token) {
      const v = await verifyTokenLocal(data.token);
      return { ok: true, token: data.token, profile: v.profile };
    }
    return { ok: false, error: data?.message || `Mã xác thực không đúng (HTTP ${res.status})` };
  } catch (e) {
    return { ok: false, error: "Lỗi kết nối tới Discord: " + (e instanceof Error ? e.message : String(e)) };
  }
}

/**
 * Báo server tạo phiên, KHÔNG để server gọi Discord.
 * Trả profile từ server (đã chuẩn hoá) hoặc null nếu server lỗi — khi đó
 * trình duyệt vẫn cho vào app bằng profile vừa xác thực.
 */
export async function registerSessionLocal(token: string, profile: LocalProfile, platform?: string): Promise<any | null> {
  try {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, platform, clientVerified: true, profile }),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return data?.success ? data.profile || profile : null;
  } catch {
    return null;
  }
}
