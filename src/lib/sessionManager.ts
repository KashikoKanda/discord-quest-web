/**
 * Session Manager — Multi-Session Allowance
 *
 * Quy tắc: 1 token có thể đăng nhập từ nhiều browser/tab/device cùng lúc.
 * - Login từ browser khác → CHO PHÉP (không reject, không evict session cũ)
 * - Mỗi browser có sessionId riêng, được track trong Set<sessionId>
 * - Heartbeat mỗi 30s để giữ session active (cho stats + cleanup resource)
 * - Khi logout, chỉ remove sessionId đó, không ảnh hưởng session khác
 *
 * Lịch sử: trước đây file này enforce single-login (reject login từ nơi khác),
 * giờ đã chuyển sang multi-session theo yêu cầu user.
 */

interface SessionEntry {
  tokenId: string;
  sessionId: string;
  lastSeen: number;
  createdAt: number;
  userAgent?: string;
}

const HEARTBEAT_TIMEOUT = 5 * 60 * 1000; // 5 phút (đã tăng từ 60s vì không còn eviction)
const CLEANUP_INTERVAL = 30 * 1000; // 30s

declare global {
  var sessionRegistry: Map<string, Map<string, SessionEntry>> | undefined;
  // Map<tokenId, Map<sessionId, SessionEntry>> — nhiều sessionId mỗi tokenId
  var sessionCleanupInterval: NodeJS.Timeout | undefined;
}

function getRegistry(): Map<string, Map<string, SessionEntry>> {
  if (!globalThis.sessionRegistry) {
    globalThis.sessionRegistry = new Map();
  }
  return globalThis.sessionRegistry;
}

function ensureCleanup() {
  if (globalThis.sessionCleanupInterval) return;
  globalThis.sessionCleanupInterval = setInterval(() => {
    const now = Date.now();
    const reg = getRegistry();
    let deleted = 0;
    for (const [tokenId, sessions] of reg) {
      for (const [sid, entry] of sessions) {
        if (now - entry.lastSeen > HEARTBEAT_TIMEOUT) {
          sessions.delete(sid);
          deleted++;
        }
      }
      // Nếu token không còn session nào active → xóa luôn tokenId entry
      if (sessions.size === 0) {
        reg.delete(tokenId);
      }
    }
    if (deleted > 0) {
      console.log(`[SessionManager] Cleaned up ${deleted} expired sessions`);
    }
  }, CLEANUP_INTERVAL);
  if (globalThis.sessionCleanupInterval.unref) {
    globalThis.sessionCleanupInterval.unref();
  }
}

/**
 * Register a new session for the given tokenId.
 * Multi-session: luôn return ok=true (cho phép nhiều session cùng token).
 */
export function registerSession(
  tokenId: string,
  sessionId: string,
  userAgent?: string
): { ok: true } {
  ensureCleanup();
  const reg = getRegistry();
  const now = Date.now();

  if (!reg.has(tokenId)) {
    reg.set(tokenId, new Map());
  }
  const sessions = reg.get(tokenId)!;

  // Refresh existing session nếu đã có
  const existing = sessions.get(sessionId);
  if (existing) {
    existing.lastSeen = now;
    existing.userAgent = userAgent;
  } else {
    // Tạo session mới — KHÔNG reject ngay cả khi đã có session khác
    sessions.set(sessionId, {
      tokenId,
      sessionId,
      lastSeen: now,
      createdAt: now,
      userAgent,
    });
    console.log(`[SessionManager] Registered session for ${tokenId.slice(0, 12)}... (${sessionId.slice(0, 8)}) — total: ${sessions.size}`);
  }
  return { ok: true };
}

/**
 * Heartbeat — chỉ check session có tồn tại không.
 * KHÔNG reject khi có session khác active (multi-session allowed).
 */
export function heartbeat(
  tokenId: string,
  sessionId: string
): { ok: boolean; reason?: "session_not_found" } {
  const reg = getRegistry();
  const sessions = reg.get(tokenId);
  if (!sessions) {
    return { ok: false, reason: "session_not_found" };
  }
  const entry = sessions.get(sessionId);
  if (!entry) {
    return { ok: false, reason: "session_not_found" };
  }
  entry.lastSeen = Date.now();
  return { ok: true };
}

/**
 * Remove a specific session (logout from this browser only).
 * Other sessions of the same token remain active.
 */
export function removeSession(tokenId: string, sessionId: string): void {
  const reg = getRegistry();
  const sessions = reg.get(tokenId);
  if (!sessions) return;
  sessions.delete(sessionId);
  if (sessions.size === 0) {
    reg.delete(tokenId);
    console.log(`[SessionManager] Removed last session for ${tokenId.slice(0, 12)}... (token now offline)`);
  } else {
    console.log(`[SessionManager] Removed session ${sessionId.slice(0, 8)} for ${tokenId.slice(0, 12)}... (${sessions.size} still active)`);
  }
}

/**
 * Force-remove ALL sessions of a token (used when token expired).
 */
export function forceRemoveSession(tokenId: string): void {
  const reg = getRegistry();
  const sessions = reg.get(tokenId);
  if (sessions) {
    const count = sessions.size;
    sessions.clear();
    reg.delete(tokenId);
    console.log(`[SessionManager] Force-removed ${count} sessions for ${tokenId.slice(0, 12)}...`);
  }
}

/**
 * Get session info for a specific sessionId.
 */
export function getSessionInfo(tokenId: string, sessionId?: string): SessionEntry | null {
  const reg = getRegistry();
  const sessions = reg.get(tokenId);
  if (!sessions) return null;
  if (sessionId) {
    return sessions.get(sessionId) || null;
  }
  // Trả về session mới nhất nếu không chỉ định sessionId
  let latest: SessionEntry | null = null;
  for (const entry of sessions.values()) {
    if (!latest || entry.lastSeen > latest.lastSeen) {
      latest = entry;
    }
  }
  return latest;
}

/**
 * Get all active sessions for a tokenId (for stats/debugging).
 */
export function getAllSessionsForToken(tokenId: string): SessionEntry[] {
  const reg = getRegistry();
  const sessions = reg.get(tokenId);
  if (!sessions) return [];
  return Array.from(sessions.values());
}

export function generateSessionId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
