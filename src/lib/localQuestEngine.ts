/**
 * Engine chạy quest NGAY TRONG TRÌNH DUYỆT người dùng.
 *
 * Kiến trúc owner chốt 22/11/2026:
 *   - Login và enroll quest ẩn: BẮT BUỘC đi qua proxy (server lo, tốn rất ít
 *     dung lượng vì chỉ là 1 request mỗi lần).
 *   - Xử lý quest (enroll thường, video-progress, heartbeat, gateway presence,
 *     claim): chạy ở IP MẠNG THẬT của thiết bị, không qua proxy, không tốn GB.
 *
 * CORS: discord.com/api/v9 trả access-control-allow-origin theo đúng origin gọi
 * tới và cho phép header Authorization, nên trình duyệt gọi thẳng được.
 */

import { buildDiscordHeaders, getDeviceIdentity } from "@/lib/deviceIdentity";

const API = "https://discord.com/api/v9";
const GATEWAY = "wss://gateway.discord.gg/?v=9&encoding=json";

export type EngineLog = (level: "info" | "success" | "warn" | "error", message: string) => void;
export type EngineProgress = (questId: string, progress: number, status: string) => void;

type Quest = Record<string, any>;

let activeStop: (() => void) | null = null;

export function stopLocalEngine(): boolean {
  if (!activeStop) return false;
  activeStop();
  activeStop = null;
  return true;
}

export function isLocalEngineRunning(): boolean {
  return activeStop !== null;
}

function tasksOf(q: Quest): Record<string, any> | undefined {
  return q?.config?.task_config_v2?.tasks || q?.config?.task_config?.tasks;
}

function questType(q: Quest): string {
  const t = tasksOf(q);
  if (!t) return "UNKNOWN";
  for (const k of Object.keys(t)) {
    if (["WATCH_VIDEO", "WATCH_VIDEO_ON_MOBILE", "PLAY_ON_DESKTOP", "PLAY_ON_XBOX", "PLAY_ON_PLAYSTATION", "STREAM_ON_DESKTOP", "PLAY_ACTIVITY", "ACHIEVEMENT_IN_ACTIVITY"].includes(k)) return k;
  }
  return "UNKNOWN";
}

function targetSeconds(q: Quest): number {
  const t = tasksOf(q);
  if (!t) return 900;
  const task: any =
    t.WATCH_VIDEO || t.WATCH_VIDEO_ON_MOBILE || t.PLAY_ON_DESKTOP || t.PLAY_ON_XBOX || t.PLAY_ON_PLAYSTATION || t.PLAY_ACTIVITY || t.ACHIEVEMENT_IN_ACTIVITY;
  if (!task) return 900;
  if (typeof task.target === "number") return task.target;
  if (typeof task.seconds_needed === "number") return task.seconds_needed;
  if (typeof task.minutes_needed === "number") return task.minutes_needed * 60;
  return 900;
}

function appIdOf(q: Quest): string | null {
  const t = tasksOf(q);
  const play = t?.PLAY_ON_DESKTOP || t?.PLAY_ON_XBOX || t?.PLAY_ON_PLAYSTATION;
  const apps = play?.applications;
  if (Array.isArray(apps) && apps[0]?.id) return String(apps[0].id);
  if (play?.application_id) return String(play.application_id);
  return q?.config?.content_id ? String(q.config.content_id) : null;
}

function gameName(q: Quest): string {
  const m = q?.config?.messages || {};
  return m.game_title || m.gameTitle || q?.config?.application?.name || "Quest";
}

function isExpired(q: Quest): boolean {
  const at = q?.config?.expires_at;
  return at ? new Date(at).getTime() < Date.now() : false;
}

function superProps(): string {
  const nav = typeof navigator !== "undefined" ? navigator : ({} as Navigator);
  const raw = {
    os: "Windows",
    browser: "Chrome",
    device: "",
    system_locale: nav.language || "en-US",
    browser_user_agent: nav.userAgent || "",
    browser_version: "157.0.0.0",
    os_version: "10",
    referrer: "",
    referring_domain: "",
    release_channel: "stable",
    client_build_number: 678976,
    client_event_source: null,
  };
  try {
    return btoa(unescape(encodeURIComponent(JSON.stringify(raw))));
  } catch {
    return "";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Bắt đầu chạy toàn bộ quest còn dùng được, từ trình duyệt.
 * Trả về promise kết thúc khi xong hoặc bị dừng.
 */
export function startLocalEngine(
  token: string,
  cb: { log: EngineLog; progress: EngineProgress },
  opts: { concurrency?: number } = {},
): Promise<void> {
  const tok = token.trim();
  const concurrency = Math.max(1, Math.min(opts.concurrency ?? 3, 6));
  let stopped = false;
  let ws: WebSocket | null = null;

  activeStop = () => { stopped = true; try { ws?.close(); } catch { /* ignore */ } };

  const headers = () => ({
    ...buildDiscordHeaders(tok),
    "X-Super-Properties": getDeviceIdentity(tok)?.superProperties || superProps(),
  });

  const api = async (path: string, init?: { method?: string; body?: unknown }) => {
    const res = await fetch(`${API}${path}`, {
      method: init?.method || "GET",
      headers: headers(),
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });
    let json: any = null;
    try { json = res.status === 204 ? null : await res.json(); } catch { /* ignore */ }
    return { ok: res.ok, status: res.status, json };
  };

  const openGateway = (activity: { name: string; application_id: string } | null) =>
    new Promise<void>((resolve) => {
      try {
        const sock = new WebSocket(GATEWAY);
        ws = sock;
        let hb: ReturnType<typeof setInterval> | null = null;
        let settled = false;
        const settle = () => { if (!settled) { settled = true; resolve(); } };
        sock.onmessage = (ev) => {
          let msg: any;
          try { msg = JSON.parse(ev.data as string); } catch { return; }
          if (msg.op === 10) {
            const every = msg?.d?.heartbeat_interval || 41250;
            hb = setInterval(() => { try { sock.send(JSON.stringify({ op: 1, d: null })); } catch { /* ignore */ } }, every);
            sock.send(JSON.stringify({
              op: 2,
              d: {
                token: tok,
                capabilities: 125,
                properties: {
                  os: "Windows",
                  browser: "Chrome",
                  device: "",
                  system_locale: "vi-VN",
                  browser_user_agent: navigator.userAgent,
                  os_version: "10",
                  client_build_number: 678976,
                  release_channel: "stable",
                },
                presence: {
                  since: 0,
                  status: "online",
                  afk: false,
                  activities: activity
                    ? [{ name: activity.name, type: 0, application_id: activity.application_id, timestamps: { start: Date.now() } }]
                    : [],
                },
                compress: false,
              },
            }));
          } else if (msg.op === 0 && msg.t === "READY") {
            cb.log("success", "Gateway READY — đang hiện trạng thái chơi game từ máy bạn");
            settle();
          } else if (msg.op === 9) {
            cb.log("warn", "Gateway từ chối phiên, bỏ qua quest chơi game");
            settle();
          }
        };
        sock.onerror = () => settle();
        sock.onclose = () => { if (hb) clearInterval(hb); settle(); };
        setTimeout(settle, 12000);
      } catch {
        resolve();
      }
    });

  const closeGateway = () => { try { ws?.close(); } catch { /* ignore */ } ws = null; };

  const runOne = async (q: Quest) => {
    const id = String(q.id);
    const type = questType(q);
    const target = targetSeconds(q);
    const name = gameName(q);

    if (isExpired(q) || q?.user_status?.claimed_at) return;

    cb.log("info", `▶ ${name} (${type}, ${Math.round(target / 60)} phút) — chạy từ IP máy bạn`);

    if (!q?.user_status?.enrolled_at) {
      const e = await api(`/quests/${id}/enroll`, {
        method: "POST",
        body: { location: 11, is_targeted: false, metadata_sealed: null, traffic_metadata_raw: null, traffic_metadata_sealed: null },
      });
      if (!e.ok && e.status !== 204) {
        cb.log("error", `Nhận quest thất bại: ${e.json?.message || `HTTP ${e.status}`}`);
        return;
      }
    }

    if (q?.user_status?.completed_at) {
      cb.log("info", `${name} đã hoàn thành, nhận thưởng`);
    } else if (type === "WATCH_VIDEO" || type === "WATCH_VIDEO_ON_MOBILE") {
      const started = Date.now();
      let ts = 0;
      while (!stopped && ts < target) {
        await sleep(5000);
        ts = Math.min(target, Math.round((Date.now() - started) / 1000) + 5);
        const r = await api(`/quests/${id}/video-progress`, { method: "POST", body: { timestamp: ts } });
        if (r.status === 401) { cb.log("error", "Token bị Discord từ chối (401) — dừng"); stopped = true; break; }
        cb.progress(id, Math.min(0.99, ts / target), "running");
        if (r.json?.completed_at) break;
      }
    } else if (type === "PLAY_ON_DESKTOP") {
      const appId = appIdOf(q);
      if (!appId) { cb.log("warn", `${name}: không đọc được app id, bỏ qua`); return; }
      await openGateway({ name, application_id: appId });
      const started = Date.now();
      let played = 0;
      while (!stopped && played < target) {
        await sleep(20000);
        played = Math.round((Date.now() - started) / 1000);
        await api(`/quests/${id}/heartbeat`, { method: "POST", body: { terminal: false } });
        cb.progress(id, Math.min(0.99, played / target), "running");
      }
      closeGateway();
    } else {
      cb.log("warn", `${name}: loại ${type} chưa chạy được trong trình duyệt, bỏ qua`);
      return;
    }

    if (stopped) return;

    const c = await api(`/quests/${id}/claim`, { method: "POST", body: {} });
    if (c.ok || c.status === 204) {
      cb.progress(id, 1, "unclaimed");
      cb.log("success", `Đã nhận thưởng: ${name}`);
    } else {
      cb.progress(id, 1, "unclaimed");
      cb.log("warn", `${name}: xong nhưng chưa nhận được thưởng (HTTP ${c.status}), mở Discord bấm nhận`);
    }
  };

  return (async () => {
    try {
      // Thử tối đa 3 lần: Discord hay trả 429/5xx khi vừa mở trang, và một lần
      // lỗi trước đây làm engine kết luận "0 quest" rồi dừng ngay.
      let list = await api("/quests/@me");
      for (let attempt = 2; attempt <= 3 && (!list.ok || !(list.json?.quests?.length)); attempt++) {
        await sleep(1200 * attempt);
        const retry = await api(`/quests/@me?t=${Date.now()}`);
        if (retry.ok) list = retry;
      }
      if (!list.ok) {
        // Nêu đúng lý do Discord từ chối để owner biết sửa gì (401 token chết,
        // 403 thiếu identity, 429 rate limit...), không chỉ "không tải được".
        const why = (list.json && (list.json.message || list.json.error)) || "";
        cb.log("error", `Không tải được danh sách quest (HTTP ${list.status})${why ? ` — ${why}` : ""}`);
        return;
      }
      const all: Quest[] = list.json?.quests || [];
      const expiredCount = all.filter((q) => isExpired(q)).length;
      const claimedCount = all.filter((q) => q?.user_status?.claimed_at).length;
      const queue = all.filter((q) => !isExpired(q) && !q?.user_status?.claimed_at);
      cb.log("info", `Discord trả ${all.length} quest: ${expiredCount} hết hạn, ${claimedCount} đã nhận thưởng, ${queue.length} chạy được`);
      if (!queue.length) {
        const raw = JSON.stringify(list.json || {}).slice(0, 240);
        cb.log("warn", `Không có quest nào chạy được. Discord trả: ${raw}`);
        return;
      }
      cb.log("info", `Có ${queue.length} quest sẽ chạy`);

      const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
        while (queue.length && !stopped) {
          const q = queue.shift();
          if (!q) break;
          try { await runOne(q); } catch (e) {
            cb.log("error", `Lỗi khi chạy quest: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      });
      await Promise.all(workers);
      if (stopped) cb.log("warn", "Đã dừng theo yêu cầu");
      else cb.log("success", "Chạy xong đợt này");
    } finally {
      closeGateway();
      activeStop = null;
    }
  })().catch((e: unknown) => {
    // Bất kỳ lỗi nào cũng phải nhả cờ, nếu không lần bấm sau bị coi là đang chạy.
    activeStop = null;
    cb.log("error", `Engine dừng do lỗi: ${e instanceof Error ? e.message : String(e)}`);
  });
}
