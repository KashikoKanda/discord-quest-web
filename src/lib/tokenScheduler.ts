/**
 * Token Health Scheduler
 * Checks all stored tokens every 24h and deletes expired ones.
 * Runs server-side only.
 */

const CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours
let timerRef: ReturnType<typeof setInterval> | null = null;

async function runCleanup() {
  try {
    const baseUrl = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
    const res = await fetch(`${baseUrl}/api/auth/cleanup`, { method: "POST" });
    const data = await res.json();
    console.log(`[TokenScheduler] Cleanup result:`, data);
  } catch (err) {
    console.error("[TokenScheduler] Cleanup failed:", err);
  }
}

export function startTokenScheduler() {
  if (timerRef) return; // Already running

  // Run first check after 30s (let server start first)
  setTimeout(() => {
    runCleanup();
    // Then every 24h
    timerRef = setInterval(runCleanup, CHECK_INTERVAL);
  }, 30_000);

  console.log("[TokenScheduler] Started — checking tokens every 24h");
}

export function stopTokenScheduler() {
  if (timerRef) {
    clearInterval(timerRef);
    timerRef = null;
    console.log("[TokenScheduler] Stopped");
  }
}
