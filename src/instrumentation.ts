export async function register() {
  // Only run on server side
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startTokenScheduler } = await import("@/lib/tokenScheduler");
    startTokenScheduler();
  }
}
