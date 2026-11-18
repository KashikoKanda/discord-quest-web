export async function register() {
  // Only run on server side
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startTokenScheduler } = await import("@/lib/tokenScheduler");
    startTokenScheduler();

    // Nạp build number + client version desktop thật ngay khi khởi động, để
    // request login đầu tiên không dùng version cũ (lệch với build number).
    const { initBuildVersion } = await import("@/lib/discord");
    initBuildVersion().catch(() => { /* không chặn khởi động */ });

    // Đóng gateway gọn gàng khi Render tắt instance cũ, tránh hai phiên cùng token
    // tồn tại trong lúc deploy (Discord coi là token bị chia sẻ).
    const { disconnectAllGateways } = await import("@/lib/gateway");
    for (const sig of ["SIGTERM", "SIGINT"] as const) {
      process.once(sig, () => {
        try { disconnectAllGateways(); } catch { /* ignore */ }
      });
    }

    // Keep the Render free instance awake so /tmp SQLite survives idle periods.
    const { startKeepAlive } = await import("@/lib/keepAlive");
    startKeepAlive();
  }
}
