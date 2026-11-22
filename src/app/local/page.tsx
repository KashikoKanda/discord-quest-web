"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * /local — chạy quest NGAY TRÊN MÁY NGƯỜI DÙNG.
 *
 * Toàn bộ request đi thẳng từ trình duyệt của owner tới discord.com, nên IP là
 * IP thật của thiết bị: không proxy, không tốn GB, không lệch IP với lúc tạo
 * token. Server Render không tham gia vào bất kỳ request nào mang token.
 *
 * CORS đã kiểm: discord.com/api/v9 trả access-control-allow-origin theo đúng
 * origin gọi tới và cho phép header Authorization.
 */

const API = "https://discord.com/api/v9";

type Quest = Record<string, any>;

type Line = { t: number; level: "info" | "ok" | "warn" | "err"; msg: string };

type RunState = "idle" | "running" | "done" | "error";

type Job = {
  id: string;
  title: string;
  type: string;
  target: number;
  state: RunState;
  progress: number;
  note: string;
};

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
  const anyTask: any =
    t.WATCH_VIDEO || t.WATCH_VIDEO_ON_MOBILE || t.PLAY_ON_DESKTOP || t.PLAY_ON_XBOX || t.PLAY_ON_PLAYSTATION || t.PLAY_ACTIVITY || t.ACHIEVEMENT_IN_ACTIVITY;
  if (!anyTask) return 900;
  if (typeof anyTask.target === "number") return anyTask.target;
  if (typeof anyTask.seconds_needed === "number") return anyTask.seconds_needed;
  if (typeof anyTask.minutes_needed === "number") return anyTask.minutes_needed * 60;
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
    browser_version: "134.0.0.0",
    os_version: "10",
    referrer: "",
    referring_domain: "",
    release_channel: "stable",
    client_build_number: 350000,
    client_event_source: null,
  };
  try {
    return btoa(unescape(encodeURIComponent(JSON.stringify(raw))));
  } catch {
    return "";
  }
}

function findStoredToken(): string {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      const v = localStorage.getItem(k) || "";
      const m = v.match(/[A-Za-z0-9_-]{20,30}\.[A-Za-z0-9_-]{5,8}\.[A-Za-z0-9_-]{25,50}/);
      if (m) return m[0];
    }
  } catch { /* ignore */ }
  return "";
}

export default function LocalPage() {
  const [token, setToken] = useState("");
  const [me, setMe] = useState<any>(null);
  const [quests, setQuests] = useState<Quest[]>([]);
  const [jobs, setJobs] = useState<Record<string, Job>>({});
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const stopRef = useRef(false);
  const wsRef = useRef<WebSocket | null>(null);

  const log = useCallback((level: Line["level"], msg: string) => {
    setLines((prev) => [...prev.slice(-260), { t: Date.now(), level, msg }]);
  }, []);

  useEffect(() => {
    const t = findStoredToken();
    if (t) setToken(t);
  }, []);

  const headers = useCallback(
    (tok: string) => ({
      Authorization: tok,
      "Content-Type": "application/json",
      "X-Super-Properties": superProps(),
      "X-Discord-Locale": "en-US",
    }),
    []
  );

  const api = useCallback(
    async (tok: string, path: string, init?: { method?: string; body?: unknown }) => {
      const res = await fetch(`${API}${path}`, {
        method: init?.method || "GET",
        headers: headers(tok),
        body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      });
      const text = await res.text();
      let json: any = null;
      try { json = text ? JSON.parse(text) : null; } catch { /* ignore */ }
      return { ok: res.ok, status: res.status, json, text };
    },
    [headers]
  );

  const checkToken = useCallback(async () => {
    const tok = token.trim();
    if (!tok) return;
    setBusy(true);
    try {
      const r = await api(tok, "/users/@me");
      if (r.ok && r.json?.username) {
        setMe(r.json);
        log("ok", `Đăng nhập ${r.json.global_name || r.json.username} — request đi từ IP máy bạn`);
      } else {
        setMe(null);
        log("err", r.status === 401 ? "Discord từ chối token (401). Lấy token mới rồi dán lại." : `Không kiểm tra được token (HTTP ${r.status})`);
      }
    } catch (e) {
      log("err", `Lỗi mạng: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [api, token, log]);

  const loadQuests = useCallback(async () => {
    const tok = token.trim();
    if (!tok) return;
    setBusy(true);
    try {
      const r = await api(tok, "/quests/@me");
      if (!r.ok) {
        log("err", `Không tải được danh sách quest (HTTP ${r.status})`);
        return;
      }
      const list: Quest[] = r.json?.quests || [];
      setQuests(list);
      const live = list.filter((q) => !isExpired(q) && !q.user_status?.claimed_at);
      log("ok", `Tìm thấy ${list.length} quest, ${live.length} còn dùng được`);
      setJobs((prev) => {
        const next = { ...prev };
        for (const q of live) {
          if (!next[q.id]) {
            next[q.id] = {
              id: q.id,
              title: gameName(q),
              type: questType(q),
              target: targetSeconds(q),
              state: "idle",
              progress: 0,
              note: q.user_status?.completed_at ? "đã xong, chờ nhận thưởng" : "",
            };
          }
        }
        return next;
      });
    } catch (e) {
      log("err", `Lỗi mạng: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }, [api, token, log]);

  const patchJob = useCallback((id: string, patch: Partial<Job>) => {
    setJobs((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  // ── Gateway: cần cho PLAY_ON_DESKTOP (presence = đang chơi game) ──
  const openGateway = useCallback(
    (tok: string, activity: { name: string; application_id: string } | null) =>
      new Promise<void>((resolve, reject) => {
        try {
          if (wsRef.current && wsRef.current.readyState <= 1) {
            if (activity) {
              wsRef.current.send(JSON.stringify({
                op: 3,
                d: {
                  since: 0,
                  activities: [{ name: activity.name, type: 0, application_id: activity.application_id, timestamps: { start: Date.now() } }],
                  status: "online",
                  afk: false,
                },
              }));
            }
            resolve();
            return;
          }
          const ws = new WebSocket("wss://gateway.discord.gg/?v=9&encoding=json");
          wsRef.current = ws;
          let hb: ReturnType<typeof setInterval> | null = null;
          ws.onmessage = (ev) => {
            let msg: any;
            try { msg = JSON.parse(ev.data as string); } catch { return; }
            if (msg.op === 10) {
              const every = msg.d?.heartbeat_interval || 41250;
              hb = setInterval(() => {
                try { ws.send(JSON.stringify({ op: 1, d: null })); } catch { /* ignore */ }
              }, every);
              ws.send(JSON.stringify({
                op: 2,
                d: {
                  token: tok,
                  capabilities: 125,
                  properties: {
                    os: "Windows",
                    browser: "Chrome",
                    device: "",
                    system_locale: "en-US",
                    browser_user_agent: navigator.userAgent,
                    os_version: "10",
                    client_build_number: 350000,
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
              log("ok", "Gateway READY — đang hiện trạng thái chơi game");
              resolve();
            } else if (msg.op === 9) {
              reject(new Error("Gateway từ chối phiên (op 9)"));
            }
          };
          ws.onerror = () => reject(new Error("Gateway lỗi kết nối"));
          ws.onclose = () => { if (hb) clearInterval(hb); };
        } catch (e) {
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      }),
    [log]
  );

  const closeGateway = useCallback(() => {
    try { wsRef.current?.close(); } catch { /* ignore */ }
    wsRef.current = null;
  }, []);

  const enroll = useCallback(
    async (tok: string, q: Quest) => {
      const r = await api(tok, `/quests/${q.id}/enroll`, {
        method: "POST",
        body: { location: 11, is_targeted: false, metadata_sealed: null, traffic_metadata_raw: null, traffic_metadata_sealed: null },
      });
      return r;
    },
    [api]
  );

  const claim = useCallback(
    async (tok: string, id: string) => {
      const r = await api(tok, `/quests/${id}/claim`, { method: "POST", body: {} });
      return r;
    },
    [api]
  );

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const runOne = useCallback(
    async (tok: string, q: Quest) => {
      const id = q.id;
      const type = questType(q);
      const target = targetSeconds(q);
      patchJob(id, { state: "running", note: "đang nhận quest" });
      log("info", `▶ ${gameName(q)} (${type}, cần ${Math.round(target / 60)} phút)`);

      if (!q.user_status?.enrolled_at) {
        const e = await enroll(tok, q);
        if (!e.ok && e.status !== 204) {
          const msg = e.json?.message || `HTTP ${e.status}`;
          patchJob(id, { state: "error", note: msg });
          log("err", `Nhận quest thất bại: ${msg}`);
          return;
        }
        log("ok", "Đã nhận quest");
      }

      const started = Date.now();
      let done = false;

      if (type === "WATCH_VIDEO" || type === "WATCH_VIDEO_ON_MOBILE") {
        let ts = 0;
        while (!stopRef.current && ts < target) {
          await sleep(5000);
          ts = Math.min(target, Math.round((Date.now() - started) / 1000) + 5);
          const r = await api(tok, `/quests/${id}/video-progress`, { method: "POST", body: { timestamp: ts } });
          if (!r.ok) {
            if (r.status === 401) { log("err", "Token bị từ chối (401) — dừng"); break; }
            log("warn", `video-progress HTTP ${r.status}, thử tiếp`);
          }
          patchJob(id, { progress: Math.min(1, ts / target) });
          if (r.json?.completed_at) { done = true; break; }
        }
        done = true;
      } else if (type === "PLAY_ON_DESKTOP") {
        const appId = appIdOf(q);
        if (!appId) {
          patchJob(id, { state: "error", note: "không đọc được app id" });
          log("err", "Quest này không có app id, bỏ qua");
          return;
        }
        await openGateway(tok, { name: gameName(q), application_id: appId });
        let played = 0;
        while (!stopRef.current && played < target) {
          await sleep(20000);
          played = Math.round((Date.now() - started) / 1000);
          await api(tok, `/quests/${id}/heartbeat`, { method: "POST", body: { terminal: false } });
          patchJob(id, { progress: Math.min(1, played / target) });
        }
        closeGateway();
        done = true;
      } else {
        patchJob(id, { state: "error", note: "loại quest chưa hỗ trợ chạy trên máy" });
        log("warn", `Loại ${type} cần giả lập client khác, bỏ qua`);
        return;
      }

      if (stopRef.current) {
        patchJob(id, { state: "idle", note: "đã dừng" });
        return;
      }
      if (done) {
        patchJob(id, { state: "done", progress: 1, note: "đang nhận thưởng" });
        const c = await claim(tok, id);
        if (c.ok || c.status === 204) log("ok", `Đã nhận thưởng: ${gameName(q)}`);
        else log("warn", `Chưa nhận được thưởng (HTTP ${c.status}) — mở Discord bấm nhận`);
        patchJob(id, { state: "done", progress: 1, note: c.ok ? "xong" : "xong, nhận thưởng thủ công" });
      }
    },
    [api, enroll, claim, openGateway, closeGateway, patchJob, log]
  );

  const runAll = useCallback(async () => {
    const tok = token.trim();
    if (!tok) return;
    stopRef.current = false;
    setRunning(true);
    log("info", "Bắt đầu chạy trên máy bạn — mọi request đi từ IP thật của thiết bị");
    const list = quests.filter((q) => !isExpired(q) && !q.user_status?.claimed_at);
    // chạy song song tối đa 3 quest để không bị rate limit
    const queue = [...list];
    const workers = Array.from({ length: Math.min(3, queue.length) }, async () => {
      while (queue.length && !stopRef.current) {
        const q = queue.shift();
        if (!q) break;
        try { await runOne(tok, q); } catch (e) { log("err", `Lỗi: ${e instanceof Error ? e.message : String(e)}`); }
      }
    });
    await Promise.all(workers);
    closeGateway();
    setRunning(false);
    if (!stopRef.current) log("ok", "Chạy xong đợt này");
  }, [token, quests, runOne, closeGateway, log]);

  const stopAll = useCallback(() => {
    stopRef.current = true;
    closeGateway();
    log("warn", "Đã dừng theo yêu cầu");
  }, [closeGateway, log]);

  const jobList = useMemo(() => Object.values(jobs), [jobs]);

  return (
    <main className="min-h-screen bg-[#0b0c12] text-white px-4 py-8">
      <div className="max-w-3xl mx-auto">
        <h1 className="text-2xl font-semibold mb-1">Chạy trên máy bạn</h1>
        <p className="text-[13px] text-white/50 mb-6">
          Toàn bộ request đi thẳng từ trình duyệt này tới Discord, dùng IP thật của thiết bị. Không proxy, không tốn GB, không lệch IP với lúc tạo token.
        </p>

        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4 mb-4">
          <label className="block text-[11px] uppercase tracking-wider text-white/50 mb-1.5">Token tài khoản</label>
          <div className="flex gap-2">
            <input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="dán token vào đây"
              className="flex-1 h-11 rounded-lg bg-black/30 border border-white/10 px-3 text-[13px] outline-none focus:border-[#5865F2]/60"
            />
            <button onClick={checkToken} disabled={busy || !token.trim()} className="h-11 px-4 rounded-lg bg-[#5865F2] hover:bg-[#4752C4] text-[13px] font-medium disabled:opacity-50">
              Kiểm tra
            </button>
            <button onClick={loadQuests} disabled={busy || !token.trim()} className="h-11 px-4 rounded-lg bg-white/10 hover:bg-white/15 text-[13px] font-medium disabled:opacity-50">
              Quét quest
            </button>
          </div>
          {me && (
            <div className="mt-3 flex items-center gap-2 text-[12px] text-[#3DD68C]">
              <span className="w-2 h-2 rounded-full bg-[#3DD68C]" />
              {me.global_name || me.username} — token sống, IP máy bạn
            </div>
          )}
        </div>

        <div className="flex gap-2 mb-4">
          <button onClick={runAll} disabled={running || !quests.length} className="h-11 px-5 rounded-lg bg-[#3DD68C] text-[#062b1b] font-semibold text-[13px] disabled:opacity-50">
            {running ? "Đang chạy…" : "Chạy tất cả trên máy tôi"}
          </button>
          <button onClick={stopAll} disabled={!running} className="h-11 px-5 rounded-lg bg-white/10 text-[13px] disabled:opacity-40">
            Dừng
          </button>
        </div>

        <div className="space-y-2 mb-6">
          {jobList.map((j) => (
            <div key={j.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-3">
              <div className="flex items-center justify-between text-[13px]">
                <span className="truncate">{j.title}</span>
                <span className="text-white/40 text-[11px]">{j.type} · {j.note}</span>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full bg-[#5865F2] transition-all" style={{ width: `${Math.round(j.progress * 100)}%` }} />
              </div>
            </div>
          ))}
          {!jobList.length && <p className="text-[12px] text-white/35">Chưa có quest nào. Bấm “Quét quest”.</p>}
        </div>

        <div className="rounded-xl border border-white/10 bg-black/40 p-3 h-64 overflow-auto font-mono text-[11.5px] leading-relaxed">
          {lines.length === 0 && <p className="text-white/30">Log sẽ hiện ở đây.</p>}
          {lines.map((l, i) => (
            <div key={i} className={l.level === "err" ? "text-[#F6606F]" : l.level === "ok" ? "text-[#3DD68C]" : l.level === "warn" ? "text-[#F5B544]" : "text-white/60"}>
              {new Date(l.t).toLocaleTimeString("vi-VN")} · {l.msg}
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
