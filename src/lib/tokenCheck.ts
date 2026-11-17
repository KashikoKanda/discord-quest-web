/**
 * Token check dùng chung cho mọi chỗ xác thực token Discord.
 *
 * Vì sao cần: web này làm quest bằng TOKEN TÀI KHOẢN (user token). Nếu người dùng
 * dán token BOT (lấy ở Developer Portal), Discord trả 401 khi gửi kiểu user, nên
 * code cũ báo "Token không hợp lệ" — trong khi token đó hoàn toàn hợp lệ, chỉ là
 * sai loại. Ở đây mình phân loại rõ: user / bot / invalid, để báo đúng lý do.
 *
 * Discord auth header:
 *   - user token : Authorization: <token>
 *   - bot token  : Authorization: Bot <token>
 */

export type TokenKind = "user" | "bot" | "invalid" | "unknown";

export interface TokenCheckResult {
  kind: TokenKind;
  /** HTTP status của lần kiểm tra cuối. */
  status: number;
  /** Profile Discord khi token hợp lệ. */
  profile?: Record<string, unknown>;
  /** Thông điệp lỗi gốc từ Discord (nếu có). */
  detail?: string;
}

/** Bỏ khoảng trắng, dấu nháy và tiền tố "Bot "/"Bearer " nếu người dùng dán kèm. */
export function normalizeToken(raw: string): string {
  let token = (raw || "").trim().replace(/^["'`]|["'`]$/g, "").trim();
  token = token.replace(/^(bot|bearer)\s+/i, "").trim();
  // Token không bao giờ chứa khoảng trắng/xuống dòng ở giữa.
  token = token.replace(/\s+/g, "");
  return token;
}

/** Token user/MFA luôn bắt đầu bằng "mfa.". */
export function looksLikeMfaUserToken(token: string): boolean {
  return token.startsWith("mfa.");
}

/**
 * Gọi Discord /users/@me theo đúng kiểu auth.
 * `dispatcher` cho phép truyền ProxyAgent của undici khi cần đi qua proxy.
 */
async function me(
  token: string,
  asBot: boolean,
  init: { dispatcher?: unknown; headers?: Record<string, string> } = {},
): Promise<{ status: number; profile?: Record<string, unknown>; detail?: string }> {
  const { fetch: undiciFetch } = await import("undici");
  const headers: Record<string, string> = {
    "Authorization": asBot ? `Bot ${token}` : token,
    "Content-Type": "application/json",
    ...(init.headers || {}),
  };

  const options: Record<string, unknown> = {
    headers,
    headersTimeout: 12_000,
    bodyTimeout: 12_000,
  };
  if (init.dispatcher) options.dispatcher = init.dispatcher;

  const res = await undiciFetch("https://discord.com/api/v10/users/@me", options as never);
  let body: Record<string, unknown> | undefined;
  let detail: string | undefined;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    detail = typeof body?.message === "string" ? (body.message as string) : undefined;
    body = undefined;
  }
  return { status: res.status, profile: body, detail };
}

/**
 * Kiểm tra token và phân loại.
 *
 * Luồng:
 *   1. Thử như user token (Authorization: <token>)
 *   2. Nếu 401 → thử như bot token (Authorization: Bot <token>) để biết có phải
 *      token bot hợp lệ hay không (báo lỗi cho đúng, không nói "sai token")
 *   3. 429 / 5xx → "unknown" (không kết luận token sai)
 */
export async function checkDiscordToken(
  rawToken: string,
  init: { dispatcher?: unknown; headers?: Record<string, string> } = {},
): Promise<TokenCheckResult> {
  const token = normalizeToken(rawToken);
  if (!token) return { kind: "invalid", status: 400, detail: "empty token" };

  const asUser = await me(token, false, init);
  if (asUser.status === 200 && asUser.profile) {
    return { kind: "user", status: 200, profile: asUser.profile };
  }

  if (asUser.status === 401) {
    // 401 với user auth: hoặc token sai, hoặc đây là token bot.
    const asBot = await me(token, true, init);
    if (asBot.status === 200 && asBot.profile) {
      return { kind: "bot", status: 200, profile: asBot.profile };
    }
    if (asBot.status === 401) {
      return { kind: "invalid", status: 401, detail: asUser.detail };
    }
    return { kind: "unknown", status: asBot.status, detail: asBot.detail };
  }

  if (asUser.status === 429) {
    return { kind: "unknown", status: 429, detail: asUser.detail };
  }

  return { kind: "unknown", status: asUser.status, detail: asUser.detail };
}

/** Thông điệp lỗi thân thiện cho từng loại token. */
export function tokenErrorMessage(result: TokenCheckResult): string {
  if (result.kind === "bot") {
    return "Đây là token BOT (lấy ở Developer Portal). Web cần token TÀI KHOẢN (user token) — token bot không thể nhận quest hộ tài khoản.";
  }
  if (result.kind === "invalid") {
    return "Token không hợp lệ hoặc đã hết hạn";
  }
  if (result.status === 429) {
    return "Discord đang rate-limit IP server, thử lại sau ít phút.";
  }
  return `Không kiểm tra được token với Discord (HTTP ${result.status}). Thử lại sau.`;
}
