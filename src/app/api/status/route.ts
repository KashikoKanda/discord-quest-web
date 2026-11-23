import { NextResponse } from "next/server";
import { proxyAuthBlockedFor } from "@/lib/proxyHelper";
import { isMaintenance, MAINTENANCE_MESSAGE } from "@/lib/maintenance";

/**
 * GET /api/status
 *
 * Trạng thái vận hành để UI hiển thị chế độ bảo trì thay vì đổ lỗi cho người dùng.
 * Hiện tại nguồn duy nhất là cầu dao 407 của proxy: gateway owl từ chối xác thực
 * (hết traffic / hết hạn gói) thì mọi login đều fail, và câu "chọn server khác"
 * là vô nghĩa vì cả pool cùng một tài khoản.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const blockedMs = proxyAuthBlockedFor();
  // Công tắc đóng web (MAINTENANCE_MODE) hoặc cầu dao 407 của proxy.
  const manual = isMaintenance();
  const maintenance = manual || blockedMs > 0;
  return NextResponse.json({
    success: true,
    maintenance,
    reason: manual ? MAINTENANCE_MESSAGE : maintenance ? "Hệ thống đang bảo trì, vui lòng quay lại sau ít phút." : null,
    retryInSeconds: manual ? 0 : maintenance ? Math.ceil(blockedMs / 1000) : 0,
    checkedAt: new Date().toISOString(),
  });
}
