/**
 * Nhận / nhả quest NGAY TRONG TRÌNH DUYỆT — mọi request đi từ IP mạng nhà
 * (wifi hoặc 3G), không qua server, không qua proxy.
 *
 * Body giữ y hệt bản server cũ (location 11/12, is_targeted, metadata_sealed,
 * traffic_metadata_raw/sealed) để Discord nhận đúng định dạng.
 */
import { buildDiscordHeaders } from "@/lib/deviceIdentity";

// v10 giống hệt file nguồn (hidden-enroll/route.ts dùng DISCORD_API v10). v9 và
// v10 khác nhau ở một số endpoint quest nên dùng đúng bản đã chạy được.
const API = "https://discord.com/api/v10";

/**
 * Dịch lỗi Discord thành câu có nghĩa — chép theo parseDiscordError() của file
 * nguồn. Trước đây gặp 260008 là hiện "Quest không xác định", người dùng không
 * biết là do khoá vùng hay do tài khoản.
 */
function explainDiscordError(status: number, code: number, raw: string): string {
  if (code === 260008 || status === 404) {
    return "Discord không thấy quest này với tài khoản của bạn (thường do quest khoá vùng hoặc đã hết hạn)";
  }
  if (code === 40001 || status === 401) return "Token không hợp lệ hoặc đã hết hạn";
  if (code === 50001) return "Tài khoản không có quyền nhận quest này";
  if (code === 50000) return "Tài khoản bị chặn nhận quest (có thể do vi phạm điều khoản)";
  if (status === 403) return "Tài khoản không đủ điều kiện nhận quest (tuổi hoặc vùng miền)";
  if (status === 400) return `Yêu cầu không hợp lệ: ${raw || "thiếu dữ liệu"}`;
  if (status === 429) return "Discord giới hạn tần suất, thử lại sau";
  return raw || `Lỗi ${status}`;
}

type QuestLike = Record<string, unknown> | undefined;

export type ActionResult = { success: boolean; status: number; message: string; retryAfter?: number };

export async function enrollQuestBrowser(
  token: string,
  questId: string,
  opts?: { isMobile?: boolean; questData?: QuestLike },
): Promise<ActionResult> {
  const isMobile = opts?.isMobile === true;
  const body = JSON.stringify({
    location: isMobile ? 12 : 11,
    is_targeted: false,
    metadata_sealed: null,
    traffic_metadata_raw: (opts?.questData?.traffic_metadata_raw as string) || null,
    traffic_metadata_sealed: (opts?.questData?.traffic_metadata_sealed as string) || null,
  });
  try {
    const res = await fetch(`${API}/quests/${questId}/enroll`, {
      method: "POST",
      // KHÔNG gửi AndroidRequest: header này không có trong
      // access-control-allow-headers của Discord nên preflight bị chặn và
      // trình duyệt không gửi được request enroll. Loại client đã nằm trong
      // x-super-properties của dữ liệu thiết bị.
      headers: buildDiscordHeaders(token),
      body,
      cache: "no-store",
    });
    if (res.ok || res.status === 204) {
      return { success: true, status: res.status, message: "Đã nhận quest" };
    }
    let message = `Lỗi ${res.status}`;
    try {
      const text = await res.text();
      const parsed = JSON.parse(text) as { message?: string; code?: number; retry_after?: number };
      message = explainDiscordError(res.status, Number(parsed?.code ?? 0), String(parsed?.message ?? ""));
      if (res.status === 429) {
        const wait = Math.ceil(Number(parsed?.retry_after ?? 15));
        return {
          success: false,
          status: 429,
          message: `Discord giới hạn tần suất, thử lại sau ${wait}s`,
          retryAfter: wait,
        };
      }
    } catch { /* body không phải JSON */ }
    if (res.status === 401) message = "Token bị Discord từ chối (401)";
    return { success: false, status: res.status, message };
  } catch {
    // fetch ném lỗi = bị chặn CORS hoặc mất mạng
    return { success: false, status: 0, message: "Trình duyệt không gọi được Discord (CORS/mạng)" };
  }
}

export async function claimQuestBrowser(
  token: string,
  questId: string,
  questData?: QuestLike,
): Promise<ActionResult> {
  const rewards = (questData?.rewards_config as { platforms?: unknown[] } | undefined)?.platforms;
  const platform = Array.isArray(rewards) && rewards.length > 0 ? String(rewards[0]) : "desktop";
  const body = JSON.stringify({
    platform,
    location: 11,
    is_targeted: false,
    metadata_sealed: null,
    traffic_metadata_raw: (questData?.traffic_metadata_raw as string) || null,
    traffic_metadata_sealed: (questData?.traffic_metadata_sealed as string) || null,
  });
  try {
    const res = await fetch(`${API}/quests/${questId}/claim`, {
      method: "POST",
      headers: buildDiscordHeaders(token),
      body,
      cache: "no-store",
    });
    if (res.ok || res.status === 204) return { success: true, status: res.status, message: "Đã nhận thưởng" };
    let message = `Lỗi ${res.status}`;
    try {
      const text = await res.text();
      const parsed = JSON.parse(text) as { message?: string };
      if (parsed?.message) message = parsed.message;
    } catch { /* ignore */ }
    return { success: false, status: res.status, message };
  } catch {
    return { success: false, status: 0, message: "Trình duyệt không gọi được Discord (CORS/mạng)" };
  }
}
