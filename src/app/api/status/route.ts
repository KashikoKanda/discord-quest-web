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
  // maintenance = CHỈ công tắc đóng web thủ công (MAINTENANCE_MODE).
  // Cầu dao 407 của proxy KHÔNG được khoá UI nữa: login, tải quest, nhận quest
  // thường/ẩn đều chạy trong trình duyệt từ IP mạng nhà, không cần proxy.
  // Trước đây chỉ cần một request proxy ăn 407 là cả trang bị panel bảo trì.
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
});
}
