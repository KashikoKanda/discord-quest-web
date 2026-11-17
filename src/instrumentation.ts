export async function register() {
  // Only run on server side
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startTokenScheduler } = await import("@/lib/tokenScheduler");
    startTokenScheduler();

    // Keep the Render free instance awake so /tmp SQLite survives idle periods.
    const { startKeepAlive } = await import("@/lib/keepAlive");
    startKeepAlive();
  }
}
