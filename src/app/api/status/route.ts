import { NextResponse } from "next/server";
import { proxyAuthBlockedFor } from "@/lib/proxyHelper";
import { isMaintenance, MAINTENANCE_MESSAGE } from "@/lib/maintenance";

/**
 * GET /api/status
 *
 * maintenance = CHỈ công tắc đóng web thủ công (MAINTENANCE_MODE).
 * Cầu dao 407 của proxy KHÔNG khoá UI nữa: login, tải quest, nhận quest thường
 * và quest ẩn đều chạy trong trình duyệt từ IP mạng nhà, không cần proxy.
 * Tình trạng proxy chỉ trả về ở field riêng để chẩn đoán.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const blockedMs = proxyAuthBlockedFor();
  const manual = isMaintenance();
  return NextResponse.json({
    success: true,
    maintenance: manual,
    reason: manual ? MAINTENANCE_MESSAGE : null,
    retryInSeconds: 0,
    proxyBlocked: blockedMs > 0,
    proxyRetryInSeconds: blockedMs > 0 ? Math.ceil(blockedMs / 1000) : 0,
    checkedAt: new Date().toISOString(),
  });
}
