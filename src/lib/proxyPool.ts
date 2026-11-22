/**
 * ProxyPool Manager — Exclusive Assignment
 *
 * Manages proxy assignments with the following rules:
 * - 1 proxy SID = 1 token duy nhất (không chia sẻ)
 * - 1 token có thể giữ nhiều SID cho các quốc gia khác nhau
 * - Không dùng proxy trong 5 phút → tự trả về kho
 * - Hết SID cho quốc gia → "Hãy quay lại sau ít phút"
 * - Không có proxy cho quốc gia đó → "Chưa thể nhận"
 */

import { findProxies, fetchProxyList, type ProxyEntry } from "./proxyList";
import { isFactoryEnabled } from "./proxyFactory";

// ──────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────

export interface ProxyAssignment {
  /** The token that holds this proxy */
  tokenId: string;
  /** Country code this proxy serves */
  countryCode: string;
  /** The assigned proxy entry */
  proxy: ProxyEntry;
  /** When this proxy was assigned */
  assignedAt: number;
  /** Last time this proxy was used (updated on each use) */
  lastUsed: number;
  /** Timer for auto-release after idle timeout */
  idleTimer: NodeJS.Timeout | null;
}

/** Availability status for a country */
export type ProxyAvailability =
  | { status: "available"; freeSlots: number; totalSlots: number }
  | { status: "full"; freeSlots: 0; totalSlots: number }
  | { status: "no_proxy"; freeSlots: 0; totalSlots: 0 };

// ──────────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────────

/** Idle timeout: 5 minutes (ms) */
const IDLE_TIMEOUT = 5 * 60 * 1000;

/**
 * Một proxy phục vụ tối đa 2 token (2 uid) cho quest ẩn.
 * UID thứ 3 xin cùng proxy đó sẽ bị báo "hết slot".
 * Login KHÔNG đi qua slot này — login random proxy, trùng nhau thoải mái.
 */
export const MAX_TOKENS_PER_PROXY = 2;

// ──────────────────────────────────────────────────
// Global State (persists across hot reloads)
// ──────────────────────────────────────────────────

declare global {
  var proxyPoolAssignments: Map<string, ProxyAssignment> | undefined;
  var proxyPoolCleanupInterval: NodeJS.Timeout | undefined;
}

/** Key: `${tokenId}::${countryCode}` → ProxyAssignment */
function getAssignmentsMap(): Map<string, ProxyAssignment> {
  if (!globalThis.proxyPoolAssignments) {
    globalThis.proxyPoolAssignments = new Map();
  }
  return globalThis.proxyPoolAssignments;
}

/** Ensure cleanup interval is running */
function ensureCleanupInterval() {
  if (globalThis.proxyPoolCleanupInterval) return;

  // Run cleanup every 30 seconds
  globalThis.proxyPoolCleanupInterval = setInterval(() => {
    cleanupIdleAssignments();
  }, 30_000);

  // Don't block process exit
  if (globalThis.proxyPoolCleanupInterval.unref) {
    globalThis.proxyPoolCleanupInterval.unref();
  }
}

// ──────────────────────────────────────────────────
// Core Functions
// ──────────────────────────────────────────────────

/** Result type for assignProxy — distinguishes success from specific failure reasons */
export type AssignProxyResult =
  | { ok: true; assignment: ProxyAssignment }
  | { ok: false; reason: "no_proxy" | "full" };

/**
 * Assign a proxy to a token for a specific country.
 * EXCLUSIVE: 1 proxy SID = 1 token duy nhất.
 *
 * - If the token already has a proxy for this country → return existing (refresh lastUsed)
 * - If not → find a FREE proxy (not assigned to anyone) and assign it exclusively
 * - Returns { ok: false, reason: "no_proxy" } if no proxy exists for that country
 * - Returns { ok: false, reason: "full" } if all SIDs for that country are taken
 */
export async function assignProxy(tokenId: string, countryCode: string): Promise<AssignProxyResult> {
  ensureCleanupInterval();

  const cc = countryCode.toUpperCase();
  const key = `${tokenId}::${cc}`;
  const assignments = getAssignmentsMap();

  // Check existing assignment for this token+country
  const existing = assignments.get(key);
  if (existing) {
    // Refresh lastUsed and restart idle timer
    existing.lastUsed = Date.now();
    restartIdleTimer(existing);
    console.log(`[ProxyPool] Reusing existing proxy for ${tokenId.slice(0, 12)} → ${cc}: ${existing.proxy.host}:${existing.proxy.port}`);
    return { ok: true, assignment: existing };
  }

  // Find a FREE proxy for this country (not assigned to any other token)
  const proxy = await findFreeProxy(tokenId, cc);
  if (!proxy) {
    const matchingProxies = await findProxies(cc);
    if (matchingProxies.length === 0) {
      console.warn(`[ProxyPool] No proxy exists for country ${cc}`);
      return { ok: false, reason: "no_proxy" };
    } else {
      console.warn(`[ProxyPool] All ${matchingProxies.length} SIDs for ${cc} are taken`);
      return { ok: false, reason: "full" };
    }
  }

  const assignment: ProxyAssignment = {
    tokenId,
    countryCode: cc,
    proxy,
    assignedAt: Date.now(),
    lastUsed: Date.now(),
    idleTimer: null,
  };

  // Start idle timer
  restartIdleTimer(assignment);

  assignments.set(key, assignment);
  console.log(`[ProxyPool] Assigned proxy for ${tokenId.slice(0, 12)} → ${cc}: ${proxy.host}:${proxy.port} (total assignments: ${assignments.size})`);

  return { ok: true, assignment };
}

/**
 * Check availability for a country.
 * Used by frontend to show correct button state.
 *
 * - "available" → còn SID trống
 * - "full" → hết SID (hiện "Hãy quay lại sau ít phút")
 * - "no_proxy" → không có proxy quốc gia đó (hiện "Chưa thể nhận")
 */
export async function checkAvailability(countryCode: string, tokenId?: string): Promise<ProxyAvailability> {
  const cc = countryCode.toUpperCase();
  const matchingProxies = await findProxies(cc);

  // Pool tĩnh không có nước này → ProxyFactory tạo proxy đúng nước ngay khi
  // người dùng bấm nhận, nên vẫn coi là khả dụng (không còn "Không khả dụng").
  if (matchingProxies.length === 0) {
    if (isFactoryEnabled()) {
      return { status: "available", freeSlots: MAX_TOKENS_PER_PROXY, totalSlots: MAX_TOKENS_PER_PROXY };
    }
    return { status: "no_proxy", freeSlots: 0, totalSlots: 0 };
  }

  const assignments = getAssignmentsMap();

  // proxyKey → set tokenId đang giữ
  const holders = new Map<string, Set<string>>();
  for (const [, a] of assignments) {
    if (a.countryCode !== cc) continue;
    const proxyKey = `${a.proxy.host}:${a.proxy.port}`;
    if (!holders.has(proxyKey)) holders.set(proxyKey, new Set());
    holders.get(proxyKey)!.add(a.tokenId);
  }

  // Mỗi proxy 2 slot; token đã giữ proxy nào thì slot đó coi như của nó
  let freeSlots = 0;
  for (const proxy of matchingProxies) {
    const key = `${proxy.host}:${proxy.port}`;
    const held = holders.get(key);
    const used = held ? held.size : 0;
    const alreadyMine = !!(tokenId && held?.has(tokenId));
    if (alreadyMine) continue; // token này đã có chỗ, không tính thêm slot
    freeSlots += Math.max(MAX_TOKENS_PER_PROXY - used, 0);
  }

  const totalSlots = matchingProxies.length * MAX_TOKENS_PER_PROXY;

  if (freeSlots <= 0) {
    return { status: "full", freeSlots: 0, totalSlots };
  }

  return { status: "available", freeSlots, totalSlots };
}

/**
 * Get existing assignment for a token+country (if any).
 * Does NOT refresh the idle timer — use touchProxy() for that.
 */
export function getAssignment(tokenId: string, countryCode: string): ProxyAssignment | null {
  const key = `${tokenId}::${countryCode.toUpperCase()}`;
  return getAssignmentsMap().get(key) || null;
}

/**
 * Mark a proxy as "just used" — resets the 5-minute idle timer.
 * Call this whenever the proxy is actively used (API call, gateway message, etc.)
 */
export function touchProxy(tokenId: string, countryCode: string): void {
  const key = `${tokenId}::${countryCode.toUpperCase()}`;
  const assignment = getAssignmentsMap().get(key);
  if (assignment) {
    assignment.lastUsed = Date.now();
    restartIdleTimer(assignment);
  }
}

/**
 * Release a specific proxy assignment.
 * Called when a token explicitly disconnects or the idle timer fires.
 */
export function releaseProxy(tokenId: string, countryCode: string): void {
  const key = `${tokenId}::${countryCode.toUpperCase()}`;
  const assignments = getAssignmentsMap();
  const assignment = assignments.get(key);
  if (!assignment) return;

  // Clear idle timer
  if (assignment.idleTimer) {
    clearTimeout(assignment.idleTimer);
    assignment.idleTimer = null;
  }

  assignments.delete(key);
  console.log(`[ProxyPool] Released proxy for ${tokenId.slice(0, 12)} → ${countryCode}: ${assignment.proxy.host}:${assignment.proxy.port} (was assigned ${formatDuration(Date.now() - assignment.assignedAt)})`);
}

/**
 * Release ALL proxy assignments for a token.
 * Called when a token is removed / logged out.
 */
export function releaseAllForToken(tokenId: string): void {
  const assignments = getAssignmentsMap();
  const keysToDelete: string[] = [];

  for (const [key, assignment] of assignments) {
    if (assignment.tokenId === tokenId) {
      if (assignment.idleTimer) {
        clearTimeout(assignment.idleTimer);
        assignment.idleTimer = null;
      }
      keysToDelete.push(key);
    }
  }

  for (const key of keysToDelete) {
    const assignment = assignments.get(key);
    if (assignment) {
      console.log(`[ProxyPool] Released proxy for ${tokenId.slice(0, 12)} → ${assignment.countryCode}: ${assignment.proxy.host}:${assignment.proxy.port}`);
    }
    assignments.delete(key);
  }
}

/**
 * Get all current assignments for a token.
 * Returns map of countryCode → ProxyAssignment
 */
export function getTokenAssignments(tokenId: string): Map<string, ProxyAssignment> {
  const result = new Map<string, ProxyAssignment>();
  const assignments = getAssignmentsMap();

  for (const [, assignment] of assignments) {
    if (assignment.tokenId === tokenId) {
      result.set(assignment.countryCode, assignment);
    }
  }

  return result;
}

/**
 * Get pool stats for monitoring / API
 */
export function getPoolStats(): {
  totalAssignments: number;
  assignments: Array<{
    tokenId: string;
    countryCode: string;
    proxyHost: string;
    proxyPort: number;
    assignedAt: string;
    lastUsed: string;
    idleFor: string;
  }>;
  byCountry: Record<string, number>;
} {
  const assignments = getAssignmentsMap();
  const now = Date.now();
  const byCountry: Record<string, number> = {};

  const list: Array<{
    tokenId: string;
    countryCode: string;
    proxyHost: string;
    proxyPort: number;
    assignedAt: string;
    lastUsed: string;
    idleFor: string;
  }> = [];
  for (const [, a] of assignments) {
    byCountry[a.countryCode] = (byCountry[a.countryCode] || 0) + 1;
    list.push({
      tokenId: a.tokenId.slice(0, 12) + "...",
      countryCode: a.countryCode,
      proxyHost: a.proxy.host,
      proxyPort: a.proxy.port,
      assignedAt: new Date(a.assignedAt).toISOString(),
      lastUsed: new Date(a.lastUsed).toISOString(),
      idleFor: formatDuration(now - a.lastUsed),
    });
  }

  return {
    totalAssignments: assignments.size,
    assignments: list,
    byCountry,
  };
}

// ──────────────────────────────────────────────────
// Internal Helpers
// ──────────────────────────────────────────────────

/**
 * Find a FREE proxy for a country — one that is NOT assigned to any token.
 * 1 proxy SID = 1 token duy nhất.
 * If all proxies are taken, returns null.
 */
async function findFreeProxy(_tokenId: string, countryCode: string): Promise<ProxyEntry | null> {
  const matchingProxies = await findProxies(countryCode);
  if (matchingProxies.length === 0) return null;

  const assignments = getAssignmentsMap();

  // proxyKey → set tokenId đang giữ proxy đó
  const holders = new Map<string, Set<string>>();
  for (const [, a] of assignments) {
    if (a.countryCode !== countryCode) continue;
    const proxyKey = `${a.proxy.host}:${a.proxy.port}`;
    if (!holders.has(proxyKey)) holders.set(proxyKey, new Set());
    holders.get(proxyKey)!.add(a.tokenId);
  }

  // Chọn proxy còn slot (đã có token này hoặc chưa đủ MAX_TOKENS_PER_PROXY uid)
  for (const proxy of matchingProxies) {
    const proxyKey = `${proxy.host}:${proxy.port}`;
    const current = holders.get(proxyKey);
    if (!current || current.size < MAX_TOKENS_PER_PROXY) {
      return proxy;
    }
  }

  // Tất cả proxy của country này đã đủ 2 uid
  return null;
}

/**
 * Chọn proxy NGẪU NHIÊN cho việc login.
 *
 * Login không quan tâm slot: nhiều lần login hoàn toàn có thể rơi vào cùng
 * một proxy (IP trùng nhau là chuyện bình thường, giống nhiều người dùng
 * chung một mạng). Chỉ quest ẩn mới bị giới hạn 2 uid/proxy.
 */
export async function pickLoginProxy(countryCode?: string): Promise<ProxyEntry | null> {
  const cc = countryCode && countryCode !== "auto" ? countryCode.toUpperCase() : undefined;
  let list = cc ? await findProxies(cc) : [];
  if (list.length === 0) {
    const all = await fetchProxyList();
    list = cc ? all.filter((p) => p.countryCode.toUpperCase() === cc) : all;
  }
  if (list.length === 0) return null;
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * Restart the idle timer for an assignment.
 * After IDLE_TIMEOUT ms of no activity, the proxy is released.
 */
function restartIdleTimer(assignment: ProxyAssignment): void {
  // Clear existing timer
  if (assignment.idleTimer) {
    clearTimeout(assignment.idleTimer);
  }

  // Set new timer
  assignment.idleTimer = setTimeout(() => {
    console.log(`[ProxyPool] Idle timeout for ${assignment.tokenId.slice(0, 12)} → ${assignment.countryCode} (idle ${formatDuration(IDLE_TIMEOUT)})`);
    releaseProxy(assignment.tokenId, assignment.countryCode);
  }, IDLE_TIMEOUT);

  // Don't block process exit
  if (assignment.idleTimer.unref) {
    assignment.idleTimer.unref();
  }
}

/**
 * Cleanup: release all assignments that have been idle longer than IDLE_TIMEOUT.
 * This is a safety net in case the timer mechanism fails.
 */
function cleanupIdleAssignments(): void {
  const assignments = getAssignmentsMap();
  const now = Date.now();

  for (const [key, assignment] of assignments) {
    const idleMs = now - assignment.lastUsed;
    if (idleMs >= IDLE_TIMEOUT) {
      console.log(`[ProxyPool] Cleanup: releasing idle proxy for ${assignment.tokenId.slice(0, 12)} → ${assignment.countryCode} (idle ${formatDuration(idleMs)})`);
      releaseProxy(assignment.tokenId, assignment.countryCode);
    }
  }
}

/**
 * Format duration in human-readable form
 */
function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainMinutes = minutes % 60;
  return `${hours}h ${remainMinutes}m`;
}
