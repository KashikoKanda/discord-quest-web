/**
 * Ghi lại "thông số phiên" tại hai thời điểm: lúc đăng nhập và ngay trước khi
 * nhận quest ẩn, rồi so sánh. Mục đích: chứng minh bằng dữ liệu rằng giữa hai
 * bước chỉ có IP thay đổi (nếu có) chứ không có header/identity nào lệch.
 *
 * Mọi thứ lưu trong localStorage của máy owner, KHÔNG gửi token lên server.
 */
import { buildDiscordHeaders } from "@/lib/deviceIdentity";

export type SessionSnapshot = {
  label: "login" | "enroll" | string;
  at: number;
  ip: string;
  userAgent: string;
  language: string;
  timezone: string;
  headers: Record<string, string>;
};

export type SessionDiff = {
  field: string;
  before: string;
  after: string;
  changed: boolean;
};

const STORE_KEY = "dqa_session_trace";
const MAX_SNAPSHOTS = 12;

function keyFor(token: string): string {
  return `${STORE_KEY}_${token.slice(0, 16)}`;
}

function readAll(token: string): SessionSnapshot[] {
  try {
    const raw = localStorage.getItem(keyFor(token));
    const arr = raw ? (JSON.parse(raw) as SessionSnapshot[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function fetchIp(): Promise<string> {
  try {
    const r = await fetch("https://api.ipify.org?format=json", { cache: "no-store" });
    if (!r.ok) return "không đọc được";
    const j = (await r.json()) as { ip?: string };
    return j?.ip || "không đọc được";
  } catch {
    return "không đọc được";
  }
}

/** Chụp lại toàn bộ thông số đang dùng để gọi Discord cho token này. */
export async function recordSnapshot(token: string, label: SessionSnapshot["label"]): Promise<SessionSnapshot> {
  const headers = buildDiscordHeaders(token);
  // Không lưu Authorization: đó là token, không cần cho việc so sánh.
  const safeHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === "authorization") continue;
    safeHeaders[k] = v;
  }
  const snap: SessionSnapshot = {
    label,
    at: Date.now(),
    ip: await fetchIp(),
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    language: typeof navigator !== "undefined" ? navigator.language : "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    headers: safeHeaders,
  };
  try {
    const all = readAll(token);
    all.push(snap);
    localStorage.setItem(keyFor(token), JSON.stringify(all.slice(-MAX_SNAPSHOTS)));
  } catch { /* hết chỗ thì thôi, vẫn trả snapshot */ }
  return snap;
}

/** Snapshot gần nhất có nhãn cho trước (mặc định là lúc login). */
export function lastSnapshot(token: string, label: SessionSnapshot["label"] = "login"): SessionSnapshot | null {
  const all = readAll(token).filter((s) => s.label === label);
  return all.length ? all[all.length - 1] : null;
}

export function allSnapshots(token: string): SessionSnapshot[] {
  return readAll(token);
}

/** So sánh hai snapshot: IP, UA, ngôn ngữ, timezone và từng header. */
export function diffSnapshots(before: SessionSnapshot, after: SessionSnapshot): SessionDiff[] {
  const out: SessionDiff[] = [];
  const push = (field: string, a: string, b: string) => {
    out.push({ field, before: a, after: b, changed: a !== b });
  };
  push("IP", before.ip, after.ip);
  push("User-Agent", before.userAgent, after.userAgent);
  push("Ngôn ngữ", before.language, after.language);
  push("Timezone", before.timezone, after.timezone);
  const keys = new Set([...Object.keys(before.headers), ...Object.keys(after.headers)]);
  for (const k of keys) {
    push(k, before.headers[k] ?? "(không gửi)", after.headers[k] ?? "(không gửi)");
  }
  return out;
}

/** Dòng mô tả ngắn để nhét vào nhật ký. */
export function describeDiff(d: SessionDiff): string {
  const cut = (s: string) => (s.length > 90 ? `${s.slice(0, 90)}…` : s);
  return d.changed
    ? `ĐỔI ${d.field}: "${cut(d.before)}" → "${cut(d.after)}"`
    : `không đổi ${d.field}`;
}
