/**
 * Render keep-alive
 *
 * Render free web services sleep after 15 minutes without inbound traffic. When a
 * free instance sleeps (or restarts) the ephemeral disk goes away, so the SQLite
 * file at /tmp is lost. Pinging our own public URL every few minutes keeps the
 * service awake, so the process (and the DB) stays alive between deploys.
 *
 * Adapted from tmx.js: the original file opened its own HTTP server on PORT, but
 * Next.js already listens on PORT here, so this module only pings through the
 * existing server instead of binding a second one.
 *
 * Runs server-side only, started once from instrumentation.ts.
 */

const DEFAULT_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes

type KeepAliveState = { timer?: ReturnType<typeof setInterval> };
const globalForKeepAlive = globalThis as unknown as { __keepAlive?: KeepAliveState };

function intervalMs(): number {
  const raw = Number(process.env.KEEP_ALIVE_INTERVAL_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_INTERVAL_MS;
  return Math.max(30_000, raw); // never hammer the edge harder than 30s
}

function isEnabled(): boolean {
  return process.env.KEEP_ALIVE_DISABLED !== "1";
}

function pingTargets(): string[] {
  const targets = new Set<string>();

  const external = process.env.RENDER_EXTERNAL_URL || process.env.BASE_URL;
  if (external) targets.add(external.replace(/\/+$/, "") + "/");

  const port = process.env.PORT || "3000";
  // Localhost ping alone is not enough on Render (edge traffic is what matters),
  // but it keeps the node process busy and warms the route on other hosts.
  targets.add(`http://127.0.0.1:${port}/`);

  return [...targets];
}

async function ping(url: string) {
  try {
    await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
      headers: { "user-agent": "dqa-keepalive/1.0" },
    });
  } catch {
    // Never throw from the keep-alive loop: a failed ping must not break the app.
  }
}

export function startKeepAlive() {
  if (globalForKeepAlive.__keepAlive?.timer) return; // already running
  if (!isEnabled()) {
    console.log("[KeepAlive] Disabled via KEEP_ALIVE_DISABLED=1");
    return;
  }

  const targets = pingTargets();
  const every = intervalMs();

  const tick = () => {
    for (const url of targets) void ping(url);
  };

  // First ping shortly after boot so the instance is marked active right away.
  setTimeout(tick, 10_000);

  const timer = setInterval(tick, every);
  timer.unref?.();

  globalForKeepAlive.__keepAlive = { timer };

  console.log(
    `[KeepAlive] Started — pinging ${targets.join(", ")} every ${Math.round(every / 1000)}s`,
  );
}

export function stopKeepAlive() {
  const state = globalForKeepAlive.__keepAlive;
  if (!state?.timer) return;
  clearInterval(state.timer);
  globalForKeepAlive.__keepAlive = {};
  console.log("[KeepAlive] Stopped");
}
