/**
 * Discord email/password login helpers
 *
 * Flow:
 *   1. POST /auth/login { login, password, captcha_key?, undelete:false, gift_code_sku_id:null, login_source:"urn:discord:app:login" }
 *      - 200 → {"token": "<user_token>"}
 *      - 400 captcha → {"captcha_key": ["captcha-required"], "captcha_sitekey": "...", "captcha_service": "hcaptcha"}
 *      - 400 mfa → {"mfa": true, "ticket": "...", "sms": false, "totp": true, "webauthn": false}
 *   2. (if MFA) POST /auth/mfa/totp { code, ticket, gift_code_sku_id:null, login_source:"urn:discord:app:login" }
 *      - 200 → {"token": "<user_token>"}
 *   3. (if SMS) POST /auth/mfa/sms { code, ticket }
 *      - 200 → {"token": "<user_token>"}
 *
 * All requests use Discord's super-properties + browser UA so they look
 * like the official web client.
 */

import { randomUUID } from "node:crypto";
import { initBuildVersion, getBuildVersion } from "./discord";
import { pickRandomUA, pickSessionUA, buildSuperProperties, buildDiscordHeaders, type UABundle } from "./uaPool";
import { fetchWithProxy } from "./proxyHelper";

// Re-export for backwards compat
export function getVersions() {
  return getBuildVersion();
}

const DISCORD_API = "https://discord.com/api/v9";

/**
 * Pick a UA bundle for a login attempt.
 *
 * If loginSessionId is provided → uses pickSessionUA() which caches the UA
 * per session (so login → captcha_required → submit → MFA all use the same
 * UA, matching what a real device does).
 *
 * If no loginSessionId → falls back to pickRandomUA() (stateless).
 */
function pickLoginUA(loginSessionId?: string): { ua: UABundle; superProps: string } {
  if (loginSessionId) {
    const { ua, superProps } = pickSessionUA(loginSessionId);
    return { ua, superProps };
  }
  // Stateless fallback
  const ua = pickRandomUA();
  const { superProps } = buildSuperProperties(ua);
  return { ua, superProps };
}

export interface LoginResult {
  ok: boolean;
  state: "success" | "captcha_required" | "mfa_required" | "sms_required" | "webauthn_required" | "invalid_credentials" | "rate_limited" | "error";
  token?: string;
  // Captcha
  captchaSitekey?: string;
  captchaService?: string;
  captchaRqdata?: string;       // hCaptcha rqdata (sent to hCaptcha widget)
  captchaSessionId?: string;   // Discord session_id (MUST send back on retry)
  captchaRqtoken?: string;     // Discord rqtoken (MUST send back on retry)
  // MFA
  mfaTicket?: string;
  // WebAuthn (security key)
  webauthnChallenge?: string;
  webauthnRpId?: string;
  // Error
  errorMessage?: string;
  code?: number;
}

/**
 * POST /auth/login to Discord.
 *
 * captchaKey: optional — if the previous attempt returned captcha_required,
 *   pass the hCaptcha response token here.
 * captchaSessionId / captchaRqtoken: MUST be passed back on retry — Discord
 *   binds the captcha challenge to a session_id + rqtoken. If missing on retry,
 *   Discord will reject the captcha_key and ask for a new one (loop).
 */
export async function discordPasswordLogin(opts: {
  login: string;       // email or phone
  password: string;
  captchaKey?: string;          // h-captcha-response token
  captchaSessionId?: string;    // From previous captcha_required response
  captchaRqtoken?: string;      // From previous captcha_required response
  loginSessionId?: string;      // Persistent UA per login session (recommended)
}): Promise<LoginResult> {
  // Make sure build version is loaded (best-effort)
  try { await initBuildVersion(); } catch { /* ignore */ }

  // Pick (or reuse) a UA bundle for this login session.
  // If loginSessionId is provided, the SAME UA is used across login → captcha
  // retry → MFA — matching what a real device does.
  const { ua, superProps } = pickLoginUA(opts.loginSessionId);

  const body: Record<string, unknown> = {
    login: opts.login,
    password: opts.password,
    undelete: false,
    gift_code_sku_id: null,
    login_source: "urn:discord:app:login",
  };
  if (opts.captchaKey) body.captcha_key = opts.captchaKey;
  // CRITICAL: Discord binds the captcha challenge to a session_id + rqtoken.
  // If we don't send them back on retry, Discord will reject the captcha_key
  // and ask for a new captcha → infinite loop.
  if (opts.captchaSessionId) body.captcha_session_id = opts.captchaSessionId;
  if (opts.captchaRqtoken) body.captcha_rqtoken = opts.captchaRqtoken;

  const headers = buildDiscordHeaders(ua, superProps);
  // Sử dụng proxy pool — tránh IP server bị Discord rate-limit
  // (nhiều user dùng chung 1 IP server → Discord flag spam → yêu cầu captcha thật + lock)
  const res = await fetchWithProxy(`${DISCORD_API}/auth/login`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  return parseLoginResponse(res);
}

/**
 * POST /auth/mfa/totp (or /auth/mfa/sms) to verify MFA.
 *
 * loginSessionId: pass the SAME sessionId used in discordPasswordLogin() so
 * the same UA is reused — Discord will reject MFA if UA changes between
 * login and MFA verify.
 */
export async function discordMfaVerify(opts: {
  code: string;
  ticket: string;
  method: "totp" | "sms";
  loginSessionId?: string;  // MUST match the sessionId used in discordPasswordLogin
}): Promise<LoginResult> {
  try { await initBuildVersion(); } catch { /* ignore */ }

  // Reuse the same UA bundle from the login session (if loginSessionId provided)
  const { ua, superProps } = pickLoginUA(opts.loginSessionId);
  const headers = buildDiscordHeaders(ua, superProps);

  const path = opts.method === "sms" ? "/auth/mfa/sms" : "/auth/mfa/totp";
  // Sử dụng proxy pool — tránh IP server bị Discord rate-limit
  const res = await fetchWithProxy(`${DISCORD_API}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      code: opts.code,
      ticket: opts.ticket,
      gift_code_sku_id: null,
      login_source: "urn:discord:app:login",
    }),
  });

  return parseLoginResponse(res);
}

async function parseLoginResponse(res: Response): Promise<LoginResult> {
  // 429 — rate limited
  if (res.status === 429) {
    const data = await res.json().catch(() => ({}));
    return {
      ok: false,
      state: "rate_limited",
      errorMessage: data.message || "Quá nhiều yêu cầu, vui lòng thử lại sau",
      code: 429,
    };
  }

  // 400 — captcha / MFA / invalid credentials
  if (res.status === 400) {
    const data = await res.json().catch(() => ({}));
    // MFA required
    if (data.mfa === true) {
      // Discord supports 3 MFA methods: TOTP, SMS, WebAuthn (security key)
      if (data.webauthn) {
        return {
          ok: false,
          state: "webauthn_required",
          mfaTicket: data.ticket,
          webauthnChallenge: data.webauthn_challenge,
          webauthnRpId: data.webauthn_rp_id,
          errorMessage: "Yêu cầu xác minh bằng khóa bảo mật (WebAuthn / Security Key)",
        };
      }
      return {
        ok: false,
        state: data.sms ? "sms_required" : "mfa_required",
        mfaTicket: data.ticket,
        errorMessage: "Yêu cầu xác minh 2 bước (MFA)",
      };
    }
    // Captcha required
    if (data.captcha_key && Array.isArray(data.captcha_key) && data.captcha_key.includes("captcha-required")) {
      return {
        ok: false,
        state: "captcha_required",
        captchaSitekey: data.captcha_sitekey,
        captchaService: data.captcha_service || "hcaptcha",
        captchaRqdata: data.captcha_rqdata,
        // Discord binds the captcha to a session_id + rqtoken — these MUST
        // be sent back along with the captcha_key when retrying, otherwise
        // Discord rejects the captcha_key and asks for a new one.
        captchaSessionId: data.captcha_session_id,
        captchaRqtoken: data.captcha_rqtoken,
        errorMessage: "Discord yêu cầu captcha — vui lòng xác minh bên dưới",
      };
    }
    // Invalid credentials
    const errs = data.errors?.login?._errors?.[0]?.message
      || data.errors?.password?._errors?.[0]?.message
      || data.message
      || "Email hoặc mật khẩu không đúng";
    return {
      ok: false,
      state: "invalid_credentials",
      errorMessage: errs,
      code: 400,
    };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      state: "error",
      errorMessage: `Discord lỗi ${res.status}: ${text}`,
      code: res.status,
    };
  }

  const data = await res.json().catch(() => ({}));
  if (!data.token) {
    return {
      ok: false,
      state: "error",
      errorMessage: "Discord không trả về token",
    };
  }
  return { ok: true, state: "success", token: data.token };
}
