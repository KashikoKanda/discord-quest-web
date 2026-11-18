export async function register() {
  // Only run on server side
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startTokenScheduler } = await import("@/lib/tokenScheduler");
    startTokenScheduler();

    // Nạp build number + client version desktop thật ngay khi khởi động, để
    // request login đầu tiên không dùng version cũ (lệch với build number).
    const { initBuildVersion } = await import("@/lib/discord");
    initBuildVersion().catch(() => { /* không chặn khởi động */ });

    // Keep the Render free instance awake so /tmp SQLite survives idle periods.
    const { startKeepAlive } = await import("@/lib/keepAlive");
    startKeepAlive();
  }
}
