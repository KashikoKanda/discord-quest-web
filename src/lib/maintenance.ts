/**
 * Công tắc đóng web để bảo trì.
 *
 * Bật bằng env MAINTENANCE_MODE=1 trên Render (đổi env KHÔNG tự deploy, phải
 * trigger deploy). Khi bật: /api/auth/login trả 503 và trang login hiện panel
 * "Web đang tạm đóng", không cho đăng nhập.
 */
export function isMaintenance(): boolean {
  const v = (process.env.MAINTENANCE_MODE || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

export const MAINTENANCE_MESSAGE = "Web đang tạm đóng để bảo trì. Vui lòng quay lại sau.";
