/**
 * Cửa chuyển phiên (session handoff) — giảm revoke khi nhận quest ẩn khác nước.
 *
 * VẤN ĐỀ: enroll quest ẩn khoá vùng bắt buộc request mang token đi từ proxy
 * đúng nước của quest, trong khi phiên trình duyệt vẫn đang sống ở IP nhà. Hai
 * IP (hai nước) cùng lúc là mẫu Discord coi là "phiên bị đánh cắp" → revoke.
 *
 * CÁCH GIẢI: không để hai IP hoạt động chồng lên nhau. Trước khi gửi request
 * enroll qua proxy, web TẠM DỪNG mọi request Discord của chính nó (polling
 * dashboard, tải quest ẩn, engine, check guild) trong một khoảng lặng; gửi đúng
 * MỘT request enroll qua proxy; rồi chờ thêm một nhịp trước khi hoạt động lại từ
 * IP nhà. IP gốc vẫn tồn tại suốt, chỉ là không phát request trong lúc proxy làm
 * việc.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let pausedUntil = 0;

/** Có đang trong cửa sổ chuyển phiên không. */
export function isSessionPaused(): boolean {
  return Date.now() < pausedUntil;
}

/** Chờ cho tới khi cửa sổ chuyển phiên kết thúc (tối đa maxWaitMs). */
export async function waitIfPaused(maxWaitMs = 60000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() < pausedUntil && Date.now() - startedAt < maxWaitMs) {
    await sleep(300);
  }
}

/**
 * Chạy một việc "đi qua proxy" trong lúc web im lặng.
 * quietMs: khoảng lặng trước khi gửi (để request trước đó của IP nhà kịp xong).
 * settleMs: khoảng lặng sau khi gửi (để phiên không nhảy IP quá nhanh).
 */
export async function withSessionHandoff<T>(
  fn: () => Promise<T>,
  opts: { quietMs?: number; settleMs?: number } = {},
): Promise<T> {
  const quietMs = opts.quietMs ?? 8000;
  const settleMs = opts.settleMs ?? 15000;
  // Khoá rất xa để mọi request chen ngang đều bị chặn; mở lại ở finally.
  pausedUntil = Date.now() + quietMs + settleMs + 600_000;
  await sleep(quietMs);
  try {
    return await fn();
  } finally {
    await sleep(settleMs);
    pausedUntil = 0;
  }
}
