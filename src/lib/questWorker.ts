// QuestWorker - Background quest processor for Discord Quest Auto Completion
// Runs quest processing in-memory on the Next.js server
//
// Updated based on aiko-chan-ai/Discord-Quest-Auto-Completion-Selfbot
// Key changes from aiko:
// - Video quest: uses Math.random() for natural timestamp variation
// - Video quest: sends final video-progress with secondsNeeded if not completed
// - Play/Activity quest: uses while(!completed) loop checking API response
// - Achievement quest: uses Discord Says API (.discordsays.com)
// - Enrollment: passes traffic_metadata_raw and traffic_metadata_sealed
// - STREAM_ON_DESKTOP: skipped (doesn't work in Node)
// - All quests run in parallel (Promise.allSettled)
//
// SPEED OPTIMIZATION (v2):
// - Reduced API queue delay from 1.2-1.8s to 500-800ms (aiko sends directly, no queue)
// - Video quest interval reduced from 7s to 6s with speed=6 (faster completion)
// - Gateway connection before quest start (required for heartbeat/video-progress)
// - Parallel quest processing with independent per-token queues
// - Auto-claim after quest completion

import {
  discordFetch,
  enrollQuest,
  fetchDiscordQuests,
  clearFingerprint,
  initBuildVersion,
  getQuestType,
  getVideoSecondsNeeded,
  getPlayDurationNeeded,
  getApplicationId,
  isQuestCompleted,
  isQuestExpired,
} from "./discord";

import {
  connectGateway,
  disconnectGateway,
  isGatewayReady,
  getSuperProperties,
  getUserAgent,
} from "./gateway";
import { buildSuperProperties } from "./discord";

import { releaseAllForToken } from "./proxyPool";

// ──────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────

interface QuestProgress {
  progress: number;
  status: string;
  startedAt: number;
  lastUpdated: number;
}

interface TokenState {
  token: string;
  status: "idle" | "running" | "error";
  isVerified: boolean;
  questProgress: Map<string, QuestProgress>;
  logs: Array<{ level: string; message: string; timestamp: number }>;
  intervals: Array<NodeJS.Timeout>;
  abortControllers: Map<string, AbortController>;
  // Per-token API queue
  apiQueue: QueueRequest[];
  queueProcessing: boolean;
  // Auto-quest loop state (separate from manual start/stop)
  // When enabled, QuestWorker re-checks Discord every AUTO_LOOP_INTERVAL_MS
  // and processes any not-completed, not-expired quests automatically.
  autoQuestEnabled: boolean;
  autoQuestLoopTimer?: NodeJS.Timeout;
  autoQuestLoopRunning?: boolean; // guards against overlapping loop ticks
}

// How often the auto-quest loop re-checks for unfinished quests
const AUTO_LOOP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes (was 1 minute) — tránh API spam

// ──────────────────────────────────────────────────
// Global State (persists across hot reloads)
// ──────────────────────────────────────────────────

declare global {
  var questWorkerState: Map<string, TokenState> | undefined;
}

function getGlobalState(): Map<string, TokenState> {
  if (!globalThis.questWorkerState) {
    globalThis.questWorkerState = new Map();
  }
  return globalThis.questWorkerState;
}

// ──────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function rnd(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Read progress value from Discord API response
 * Response format: { progress: { PLAY_ON_DESKTOP: { value: 900, ... } } }
 */
function readProgressValue(data: any, questType: string): number | null {
  if (!data || typeof data !== "object") return null;
  const progress = data.progress;
  if (!progress || typeof progress !== "object") return null;
  const taskProg = progress[questType];
  if (!taskProg || typeof taskProg !== "object") return null;
  return typeof taskProg.value === "number" ? taskProg.value : null;
}

/**
 * Check if a quest is completed based on the API response
 * completed_at is at ROOT level of response (not user_status.completed_at)
 */
function isResponseCompleted(data: any): boolean {
  return data?.completed_at != null;
}

// ──────────────────────────────────────────────────
// PER-TOKEN API Queue
// Each token has its own queue so users don't block each other
// ──────────────────────────────────────────────────

const MAX_RETRIES = 3;
const RETRYABLE = new Set([429, 500, 502, 503, 504, 408]);

interface QueueRequest {
  url: string;
  body: unknown;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  attempts: number;
  token: string;
  tokenId: string;
}

/**
 * Enqueue an API call for a specific token's queue
 */
function enqueueApiCall<T = any>(
  tokenId: string,
  url: string,
  body: unknown
): Promise<T> {
  const state = getGlobalState().get(tokenId);
  if (!state) {
    return Promise.reject(new Error("Token chưa đăng ký"));
  }

  return new Promise((resolve, reject) => {
    state.apiQueue.push({ url, body, resolve, reject, attempts: 0, token: state.token, tokenId });
    processTokenQueue(tokenId);
  });
}

/**
 * Process a specific token's API queue
 * Each token processes independently - no blocking between users
 */
async function processTokenQueue(tokenId: string): Promise<void> {
  const state = getGlobalState().get(tokenId);
  if (!state || state.queueProcessing || state.apiQueue.length === 0) return;
  state.queueProcessing = true;

  while (state.apiQueue.length > 0) {
    const req = state.apiQueue.shift();
    if (!req) break;

    try {
      const res = await discordFetch(req.token, req.url, {
        method: "POST",
        body: JSON.stringify(req.body),
      }, req.tokenId);

      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("retry-after") || "5");
        if (req.attempts < MAX_RETRIES) {
          req.attempts++;
          const delay = (retryAfter + Math.pow(2, req.attempts)) * 1000 + rnd(200, 800);
          addLog(tokenId, "warn", `Rate limited, retry ${req.attempts}/${MAX_RETRIES} trong ${(delay / 1000).toFixed(1)}s`);
          await sleep(delay);
          state.apiQueue.unshift(req);
        } else {
          req.reject(new Error(`Rate limited after ${MAX_RETRIES} retries`));
        }
      } else if (RETRYABLE.has(res.status)) {
        if (req.attempts < MAX_RETRIES) {
          req.attempts++;
          const delay = Math.pow(2, req.attempts) * 1000 + rnd(200, 800);
          await sleep(delay);
          state.apiQueue.unshift(req);
        } else {
          req.reject(new Error(`Server error ${res.status} after ${MAX_RETRIES} retries`));
        }
      } else {
        let data: any = null;
        try { data = await res.json(); } catch { /* no body */ }
        req.resolve({ status: res.status, ok: res.ok, data });
      }
    } catch (err) {
      req.reject(err);
    }

    // ─── Anti-spam delay between API calls ───
    // Tăng delay để tránh Discord flag spam → revoke token
    // Trước: 500-800ms → quá nhanh → 50 API calls trong 30s = bot pattern
    // Sau: 1500-3000ms → giống người thật
    await sleep(rnd(1500, 3000));
  }

  state.queueProcessing = false;
}

// ──────────────────────────────────────────────────
// Logging & Progress
// ──────────────────────────────────────────────────

function addLog(tokenId: string, level: string, message: string) {
  const state = getGlobalState().get(tokenId);
  if (state) {
    state.logs.unshift({ level, message, timestamp: Date.now() });
    if (state.logs.length > 200) state.logs.length = 200;
  }
}

function updateQuestProgress(
  tokenId: string,
  questId: string,
  progress: number,
  status: string
) {
  const state = getGlobalState().get(tokenId);
  if (state) {
    state.questProgress.set(questId, {
      progress,
      status,
      startedAt: state.questProgress.get(questId)?.startedAt || Date.now(),
      lastUpdated: Date.now(),
    });
  }
}

function clearAllIntervals(tokenId: string) {
  const state = getGlobalState().get(tokenId);
  if (state) {
    for (const interval of state.intervals) {
      clearInterval(interval);
    }
    state.intervals = [];
    for (const [, ctrl] of state.abortControllers) {
      ctrl.abort();
    }
    state.abortControllers.clear();
  }
}

// ──────────────────────────────────────────────────
// Quest Processing: WATCH_VIDEO (aiko-style)
// ──────────────────────────────────────────────────

async function doWatchVideoQuest(
  tokenId: string,
  quest: Record<string, unknown>
): Promise<void> {
  const questId = quest.id as string;
  const questType = getQuestType(quest);
  const secondsNeeded = getVideoSecondsNeeded(quest);

  const userStatus = quest.user_status as Record<string, unknown> | undefined;
  const enrolledAt = userStatus?.enrolled_at
    ? new Date(userStatus.enrolled_at as string).getTime()
    : Date.now();

  // aiko: REAL-TIME MODE — gửi timestamp theo thời gian thực để tránh revoke
  // Trước: speed=6, interval=6 → timestamp đi nhanh hơn real time → Discord detect bot
  // Sau: speed=5, interval=5 → 1:1 với real time (5s progress / 5s real)
  // KHÔNG tăng maxFuture quá cao — Discord check timestamp hợp lệ
  const maxFuture = 3; // giảm buffer để timestamp không đi quá xa
  const speed = 5;
  const interval = 5;
  let secondsDone: number = userStatus?.progress
    ? ((userStatus.progress as Record<string, unknown>)[questType] as { value?: number } | undefined)?.value ?? 0
    : 0;

  const config = quest.config as Record<string, unknown> | undefined;
  const questName = (config?.messages as Record<string, string>)?.quest_name || (config?.messages as Record<string, string>)?.game_title || questId;

  addLog(tokenId, "info", `Bắt đầu quest Video: ${questName} (${secondsNeeded}s, đã xem ${secondsDone}s)`);
  updateQuestProgress(tokenId, questId, (secondsDone / secondsNeeded) * 100, "running");

  let completed = false;

  while (true) {
    const state = getGlobalState().get(tokenId);
    if (!state || state.status !== "running") {
      addLog(tokenId, "warn", `Quest ${questName} đã dừng`);
      return;
    }

    const ctrl = state.abortControllers.get(questId);
    if (ctrl?.signal.aborted) {
      addLog(tokenId, "warn", `Quest ${questName} bị abort`);
      updateQuestProgress(tokenId, questId, (secondsDone / secondsNeeded) * 100, "paused");
      return;
    }

    const maxAllowed = Math.floor((Date.now() - enrolledAt) / 1000) + maxFuture;
    const diff = maxAllowed - secondsDone;
    const timestamp = secondsDone + speed;

    if (diff >= speed) {
      try {
        // aiko: timestamp + Math.random() for natural variation
        const sendTimestamp = Math.min(secondsNeeded, timestamp + Math.random());
        const result = await enqueueApiCall(
          tokenId,
          `/quests/${questId}/video-progress`,
          { timestamp: sendTimestamp }
        );

        if (result.status === 401) {
          addLog(tokenId, "error", `Token hết hạn khi gửi video-progress cho quest ${questName}`);
          state.status = "error";
          return;
        }

        // completed_at is at ROOT level of response
        completed = isResponseCompleted(result.data);
        secondsDone = Math.min(secondsNeeded, timestamp);

        // Read actual progress from API response
        const apiProgress = readProgressValue(result.data, questType);
        if (apiProgress !== null) {
          secondsDone = apiProgress;
        }

        const progressPct = Math.min(100, (secondsDone / secondsNeeded) * 100);
        updateQuestProgress(tokenId, questId, progressPct, "running");
        addLog(tokenId, "info", `Quest ${questName}: ${Math.round(secondsDone)}/${secondsNeeded}s (${Math.round(progressPct)}%)`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        addLog(tokenId, "error", `Lỗi video quest ${questName}: ${msg}`);
      }
    }

    // Check if done
    if (timestamp >= secondsNeeded) {
      break;
    }

    await sleep(interval * 1000);
  }

  // aiko: If not completed after loop, send final video-progress with secondsNeeded
  if (!completed) {
    try {
      await enqueueApiCall(tokenId, `/quests/${questId}/video-progress`, {
        timestamp: secondsNeeded,
      });
    } catch { /* ignore */ }
  }

  updateQuestProgress(tokenId, questId, 100, "completed");
  addLog(tokenId, "success", `Quest Video ${questName} hoàn thành!`);
  // Delay nhẹ 1s để UI load hoàn thành trước khi chuyển quest tiếp theo
  await sleep(1000);
}

// ──────────────────────────────────────────────────
// Quest Processing: PLAY_ON_DESKTOP (aiko-style)
// aiko: while(!completed) loop, reads progress from API response each heartbeat
// ──────────────────────────────────────────────────

async function doPlayOnDesktopQuest(
  tokenId: string,
  quest: Record<string, unknown>
): Promise<void> {
  const questId = quest.id as string;
  const questType = getQuestType(quest);
  const appId = getApplicationId(quest);
  const totalDuration = getPlayDurationNeeded(quest);
  // Heartbeat interval — 30s (real Discord client gửi mỗi 30s)
  // Trước: 15s → quá nhanh → Discord detect bot → revoke token
  // Sau: 30s → giống Discord client thật
  const heartbeatInterval = 30;

  const config = quest.config as Record<string, unknown> | undefined;
  const questName = (config?.messages as Record<string, string>)?.quest_name || (config?.messages as Record<string, string>)?.game_title || questId;
  const applicationName = (config?.application as Record<string, unknown>)?.name as string || appId || "unknown";

  // Read existing progress from quest data
  const userStatus = quest.user_status as Record<string, unknown> | undefined;
  let elapsed: number = userStatus?.progress
    ? ((userStatus.progress as Record<string, unknown>)[questType] as { value?: number } | undefined)?.value ?? 0
    : 0;

  addLog(tokenId, "info", `Bắt đầu quest Play: ${questName} (${Math.floor(totalDuration / 60)} phút, app: ${applicationName}, đã chơi ${elapsed}s)`);
  updateQuestProgress(tokenId, questId, (elapsed / totalDuration) * 100, "running");

  // aiko: while(!quest.isCompleted()) loop with heartbeat
  let completed = isQuestCompleted(quest);

  while (!completed) {
    const state = getGlobalState().get(tokenId);
    if (!state || state.status !== "running") {
      addLog(tokenId, "warn", `Quest ${questName} đã dừng`);
      return;
    }

    const ctrl = state.abortControllers.get(questId);
    if (ctrl?.signal.aborted) {
      updateQuestProgress(tokenId, questId, (elapsed / totalDuration) * 100, "paused");
      return;
    }

    try {
      // Read current progress from quest data (updated each heartbeat)
      const currentProgress = userStatus?.progress
        ? ((userStatus.progress as Record<string, unknown>)[questType] as { value?: number } | undefined)?.value ?? 0
        : 0;

      // Send heartbeat with application_id (aiko-style)
      const body: Record<string, unknown> = {
        application_id: appId,
        terminal: false,
      };

      const result = await enqueueApiCall(tokenId, `/quests/${questId}/heartbeat`, body);

      if (result.status === 401) {
        addLog(tokenId, "error", `Token hết hạn khi gửi heartbeat cho quest ${questName}`);
        state.status = "error";
        return;
      }

      // Update quest status from API response (aiko: quest.updateUserStatus(res))
      const apiCompleted = isResponseCompleted(result.data);
      const apiProgress = readProgressValue(result.data, questType);
      if (apiProgress !== null) {
        elapsed = apiProgress;
      } else {
        elapsed = currentProgress + heartbeatInterval;
      }

      // Update userStatus progress from API response for next iteration
      if (result.data?.progress) {
        try {
          (quest.user_status as Record<string, unknown>)!.progress = result.data.progress;
        } catch { /* ignore */ }
      }
      if (result.data?.completed_at) {
        completed = true;
      }

      const progressPct = Math.min(100, (elapsed / totalDuration) * 100);
      updateQuestProgress(tokenId, questId, progressPct, "running");

      addLog(tokenId, "info", `Quest ${questName}: Đang giả lập ${applicationName}. Còn ${Math.ceil((totalDuration - elapsed) / 60)} phút.`);

      await sleep(heartbeatInterval * 1000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog(tokenId, "error", `Lỗi play quest ${questName}: ${msg}`);
      await sleep(5000);
    }
  }

  // aiko: Send terminal heartbeat after completion
  try {
    const terminalBody: Record<string, unknown> = {
      application_id: appId,
      terminal: true,
    };
    await enqueueApiCall(tokenId, `/quests/${questId}/heartbeat`, terminalBody);
  } catch { /* ignore */ }

  updateQuestProgress(tokenId, questId, 100, "completed");
  addLog(tokenId, "success", `Quest Play ${questName} hoàn thành!`);
  // Delay nhẹ 1s để UI load hoàn thành trước khi chuyển quest tiếp theo
  await sleep(1000);
}

// ──────────────────────────────────────────────────
// Quest Processing: PLAY_ACTIVITY (aiko-style)
// ──────────────────────────────────────────────────

async function doPlayActivityQuest(
  tokenId: string,
  quest: Record<string, unknown>
): Promise<void> {
  const questId = quest.id as string;
  const questType = getQuestType(quest);
  const totalDuration = getPlayDurationNeeded(quest);
  // Heartbeat interval — 30s (giống Discord client thật)
  const heartbeatInterval = 30;
  const streamKey = "call:1:1"; // aiko: call:1:1

  const config = quest.config as Record<string, unknown> | undefined;
  const questName = (config?.messages as Record<string, string>)?.quest_name || (config?.messages as Record<string, string>)?.game_title || questId;
  const applicationName = (config?.application as Record<string, unknown>)?.name as string || "Activity";

  // Read existing progress
  const userStatus = quest.user_status as Record<string, unknown> | undefined;
  let elapsed: number = userStatus?.progress
    ? ((userStatus.progress as Record<string, unknown>)[questType] as { value?: number } | undefined)?.value ?? 0
    : 0;

  addLog(tokenId, "info", `Bắt đầu quest Activity: ${questName} (${Math.floor(totalDuration / 60)} phút, đã chơi ${elapsed}s)`);
  updateQuestProgress(tokenId, questId, (elapsed / totalDuration) * 100, "running");

  // aiko: while(!quest.isCompleted()) loop
  let completed = isQuestCompleted(quest);

  while (!completed) {
    const state = getGlobalState().get(tokenId);
    if (!state || state.status !== "running") {
      addLog(tokenId, "warn", `Quest ${questName} đã dừng`);
      return;
    }

    const ctrl = state.abortControllers.get(questId);
    if (ctrl?.signal.aborted) {
      updateQuestProgress(tokenId, questId, (elapsed / totalDuration) * 100, "paused");
      return;
    }

    try {
      const currentProgress = userStatus?.progress
        ? ((userStatus.progress as Record<string, unknown>)[questType] as { value?: number } | undefined)?.value ?? 0
        : 0;

      const result = await enqueueApiCall(
        tokenId,
        `/quests/${questId}/heartbeat`,
        { stream_key: streamKey, terminal: false }
      );

      if (result.status === 401) {
        addLog(tokenId, "error", `Token hết hạn khi gửi heartbeat cho quest ${questName}`);
        state.status = "error";
        return;
      }

      // Update quest from API response (aiko: quest.updateUserStatus(res))
      const apiProgress = readProgressValue(result.data, questType);
      if (apiProgress !== null) {
        elapsed = apiProgress;
      } else {
        elapsed = currentProgress + heartbeatInterval;
      }

      if (result.data?.progress) {
        try {
          (quest.user_status as Record<string, unknown>)!.progress = result.data.progress;
        } catch { /* ignore */ }
      }
      if (result.data?.completed_at) {
        completed = true;
      }

      const progressPct = Math.min(100, (elapsed / totalDuration) * 100);
      updateQuestProgress(tokenId, questId, progressPct, "running");

      addLog(tokenId, "info", `Quest ${questName}: Đang giả lập ${applicationName}. Còn ${Math.ceil((totalDuration - elapsed) / 60)} phút.`);

      await sleep(heartbeatInterval * 1000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog(tokenId, "error", `Lỗi activity quest ${questName}: ${msg}`);
      await sleep(5000);
    }
  }

  // aiko: Send terminal heartbeat after completion
  try {
    await enqueueApiCall(tokenId, `/quests/${questId}/heartbeat`, {
      stream_key: streamKey, terminal: true,
    });
  } catch { /* ignore */ }

  updateQuestProgress(tokenId, questId, 100, "completed");
  addLog(tokenId, "success", `Quest Activity ${questName} hoàn thành!`);
  // Delay nhẹ 1s để UI load hoàn thành trước khi chuyển quest tiếp theo
  await sleep(1000);
}

// ──────────────────────────────────────────────────
// Quest Processing: ACHIEVEMENT_IN_ACTIVITY (aiko-style)
// Uses Discord Says API (.discordsays.com) with proper proxy ticket + headers
// ──────────────────────────────────────────────────

/**
 * Get a proxy ticket from Discord for a specific application.
 * aiko: POST /applications/{appId}/proxy-tickets → { ticket: "..." }
 */
async function getProxyTicket(tokenId: string, applicationId: string): Promise<string | null> {
  try {
    const res = await enqueueApiCall(
      tokenId,
      `/applications/${applicationId}/proxy-tickets`,
      {}
    );
    if (res.ok && res.data?.ticket) {
      return res.data.ticket as string;
    }
    addLog(tokenId, "warn", `Không lấy được proxy ticket (status ${res.status})`);
    return null;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    addLog(tokenId, "warn", `Lỗi lấy proxy ticket: ${msg}`);
    return null;
  }
}

/**
 * Build the activity referrer URL — aiko-style:
 *   https://{appId}.discordsays.com/?instance_id=example-cl-instance&platform=desktop&discord_proxy_ticket={ticket}
 */
async function buildActivityReferrer(tokenId: string, applicationId: string): Promise<string | null> {
  const ticket = await getProxyTicket(tokenId, applicationId);
  if (!ticket) return null;
  const referrer = new URL(`https://${applicationId}.discordsays.com/`);
  referrer.searchParams.set("instance_id", "example-cl-instance");
  referrer.searchParams.set("platform", "desktop");
  referrer.searchParams.set("discord_proxy_ticket", ticket);
  return referrer.toString();
}

/**
 * Build the activity headers for Discord Says API calls.
 *
 * Mirrors aiko's flow exactly:
 *   1. makeDesktopHeaders(false, false)  → UA + sec-ch-ua + pragma + accept-language
 *      (NO x-super-properties, NO origin, NO referer — both flags false)
 *   2. getActivityHeaders(questId, authToken, activityReferrer) → merged on top:
 *      - Content-Type: application/json
 *      - X-Auth-Token: authToken
 *      - X-Discord-Quest-ID: questId
 *      - Referer: activityReferrer
 *
 * Important: do NOT send Authorization (Discord token), x-super-properties,
 * x-debug-options, x-discord-locale, x-discord-timezone, origin — aiko's
 * makeDesktopHeaders(false, false) intentionally omits all of these for the
 * discordsays.com calls. Sending them causes "Env data not found" 500 errors.
 */
async function buildActivityHeaders(
  tokenId: string,
  questId: string,
  authToken: string,
  activityReferrer: string
): Promise<Record<string, string>> {
  // Get the User-Agent (matches the discord client UA used elsewhere)
  let userAgent: string;
  const state = getGlobalState().get(tokenId);
  if (!state) {
    userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9236 Chrome/138.0.7204.251 Electron/37.6.0 Safari/537.36";
  } else if (isGatewayReady(tokenId)) {
    userAgent = getUserAgent(tokenId);
  } else {
    const built = await buildSuperProperties(tokenId);
    userAgent = built.fp.userAgent;
  }

  // aiko: makeDesktopHeaders(false, false) — NO origin, NO referer, NO x-super-properties
  const headers: Record<string, string> = {
    "accept-language": "vi",
    "User-Agent": userAgent,
    "pragma": "no-cache",
    "priority": "u=1, i",
    "sec-ch-ua": '"Not)A;Brand";v="8", "Chromium";v="138"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
  };

  // aiko: getActivityHeaders merged on top via headers.append()
  headers["Content-Type"] = "application/json";
  headers["X-Auth-Token"] = authToken;
  headers["X-Discord-Quest-ID"] = questId;
  headers["Referer"] = activityReferrer;

  return headers;
}

async function doAchievementInActivityQuest(
  tokenId: string,
  quest: Record<string, unknown>
): Promise<void> {
  const questId = quest.id as string;
  const config = quest.config as Record<string, unknown> | undefined;
  const questName = (config?.messages as Record<string, string>)?.quest_name || questId;
  const application = config?.application as Record<string, unknown> | undefined;
  const applicationId = application?.id as string;
  const applicationName = application?.name as string || "Unknown";

  // Get the target from task config
  const tasks = config?.task_config_v2 as Record<string, unknown> | undefined;
  const taskMap = tasks?.tasks as Record<string, unknown> | undefined;
  const achievementTask = taskMap?.ACHIEVEMENT_IN_ACTIVITY as Record<string, unknown> | undefined;
  const questTarget = (achievementTask?.target as number) || 1;

  addLog(tokenId, "info", `Bắt đầu quest Achievement: ${questName} (app: ${applicationName}, target: ${questTarget})`);
  updateQuestProgress(tokenId, questId, 0, "running");

  const state = getGlobalState().get(tokenId);
  if (!state) return;

  try {
    // Step 1: Authorize with the application (OAuth2) - aiko-style
    addLog(tokenId, "info", `Đang xác thực với ${applicationName}...`);

    const query = new URLSearchParams({
      response_type: "code",
      client_id: applicationId,
      scope: "identify applications.commands applications.entitlements",
      state: "",
    });

    const authRes = await enqueueApiCall(
      tokenId,
      `/oauth2/authorize?${query.toString()}`,
      {
        permissions: "0",
        authorize: true,
        integration_type: 1,
        location_context: {
          guild_id: "10000",
          channel_id: "10000",
          channel_type: 10000,
        },
      }
    );

    if (!authRes.ok) {
      addLog(tokenId, "error", `Xác thực OAuth2 thất bại cho ${applicationName}: ${authRes.status}`);
      updateQuestProgress(tokenId, questId, 0, "failed");
      return;
    }

    // Step 2: Extract auth code from response
    const location = authRes.data?.location;
    let authCode: string | null = null;
    if (location) {
      try {
        authCode = new URL(location).searchParams.get("code");
      } catch {
        const match = location.match(/[?&]code=([^&]+)/);
        authCode = match ? match[1] : null;
      }
    }

    if (!authCode) {
      addLog(tokenId, "error", `Không nhận được auth code từ ${applicationName}`);
      updateQuestProgress(tokenId, questId, 0, "failed");
      return;
    }

    addLog(tokenId, "success", `Đã xác thực với ${applicationName}`);
    updateQuestProgress(tokenId, questId, 30, "running");

    // Step 3: Build activity referrer with proxy ticket (aiko-style)
    addLog(tokenId, "info", `Đang lấy proxy ticket...`);
    const activityReferrer = await buildActivityReferrer(tokenId, applicationId);
    if (!activityReferrer) {
      addLog(tokenId, "error", `Không lấy được proxy ticket cho ${applicationName}`);
      updateQuestProgress(tokenId, questId, 0, "failed");
      return;
    }

    // Step 4: Authorize with Discord Says (aiko-style)
    // POST https://{appId}.discordsays.com/.proxy/acf/authorize
    // Headers: X-Discord-Quest-ID, X-Auth-Token (empty), Referer=activityReferrer, Origin, UA, x-super-properties
    addLog(tokenId, "info", `Đang lấy token Discord Says...`);

    const authorizeHeaders = await buildActivityHeaders(tokenId, questId, "", activityReferrer);
    const dsTokenRes = await fetch(
      `https://${applicationId}.discordsays.com/.proxy/acf/authorize`,
      {
        method: "POST",
        headers: authorizeHeaders,
        body: JSON.stringify({ code: authCode }),
      }
    );

    if (!dsTokenRes.ok) {
      const errText = await dsTokenRes.text().catch(() => "");
      addLog(tokenId, "error", `Lấy Discord Says token thất bại: ${dsTokenRes.status} ${errText.slice(0, 150)}`);
      updateQuestProgress(tokenId, questId, 0, "failed");
      return;
    }

    const dsData = await dsTokenRes.json().catch(() => ({})) as { token?: string };
    const dsToken = dsData.token;

    if (!dsToken) {
      addLog(tokenId, "error", `Không nhận được token từ Discord Says`);
      updateQuestProgress(tokenId, questId, 0, "failed");
      return;
    }

    addLog(tokenId, "success", `Đã lấy Discord Says token`);
    updateQuestProgress(tokenId, questId, 50, "running");

    // Step 5: Progress the achievement via Discord Says API (aiko-style)
    // POST https://{appId}.discordsays.com/.proxy/acf/quest/progress
    // Headers: X-Discord-Quest-ID, X-Auth-Token=dsToken, Referer=activityReferrer
    addLog(tokenId, "info", `Đang hoàn thành achievement (target: ${questTarget})...`);

    const progressHeaders = await buildActivityHeaders(tokenId, questId, dsToken, activityReferrer);
    const progressRes = await fetch(
      `https://${applicationId}.discordsays.com/.proxy/acf/quest/progress`,
      {
        method: "POST",
        headers: progressHeaders,
        body: JSON.stringify({
          quest_id: questId,
          progress: questTarget,
        }),
      }
    );

    if (!progressRes.ok) {
      const errText = await progressRes.text().catch(() => "");
      addLog(tokenId, "error", `Hoàn thành achievement thất bại: ${progressRes.status} ${errText.slice(0, 150)}`);
      updateQuestProgress(tokenId, questId, 0, "failed");
      return;
    }

    addLog(tokenId, "success", `Đã hoàn thành achievement!`);
    updateQuestProgress(tokenId, questId, 80, "running");

    // Step 6: Deauthorize the application (cleanup - aiko-style)
    try {
      const tokensRes = await enqueueApiCall(tokenId, "/oauth2/tokens", {});
      if (tokensRes.ok && Array.isArray(tokensRes.data)) {
        const tokenInfo = tokensRes.data.find(
          (t: Record<string, unknown>) =>
            (t.application as Record<string, unknown>)?.id === applicationId
        );
        if (tokenInfo?.id) {
          // Use DELETE method (aiko uses rest.delete)
          await discordFetch(state.token, `/oauth2/tokens/${tokenInfo.id}`, {
            method: "DELETE",
          }, tokenId);
          addLog(tokenId, "info", `Đã huỷ uỷ quyền ${applicationName}`);
        }
      }
    } catch {
      // Deauth failure is not critical
    }

    updateQuestProgress(tokenId, questId, 100, "completed");
    addLog(tokenId, "success", `Quest Achievement ${questName} hoàn thành!`);
    // Delay nhẹ 1s để UI load hoàn thành trước khi chuyển quest tiếp theo
    await sleep(1000);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    addLog(tokenId, "error", `Lỗi achievement quest ${questName}: ${msg}`);
    updateQuestProgress(tokenId, questId, 0, "failed");
  }
}

// ──────────────────────────────────────────────────
// Process a single quest (aiko-style)
// ──────────────────────────────────────────────────

async function processQuest(
  tokenId: string,
  quest: Record<string, unknown>
): Promise<void> {
  const questId = quest.id as string;
  const questType = getQuestType(quest);
  const config = quest.config as Record<string, unknown> | undefined;
  const questName = (config?.messages as Record<string, string>)?.quest_name || (config?.messages as Record<string, string>)?.game_title || questId;

  if (isQuestCompleted(quest)) {
    addLog(tokenId, "info", `Quest ${questName} đã hoàn thành, bỏ qua`);
    return;
  }

  if (isQuestExpired(quest)) {
    addLog(tokenId, "warn", `Quest ${questName} đã hết hạn, bỏ qua`);
    return;
  }

  // Enroll if not enrolled - aiko: acceptQuest with traffic_metadata
  const userStatus = quest.user_status as Record<string, unknown> | undefined;
  if (!userStatus?.enrolled_at) {
    try {
      // aiko: detect isAndroid from task config
      const taskConfig = config?.task_config_v2 as Record<string, unknown> | undefined;
      const taskMap = taskConfig?.tasks as Record<string, unknown> | undefined;
      const isAndroid = Boolean(taskMap?.WATCH_VIDEO_ON_MOBILE) && !Boolean(taskMap?.WATCH_VIDEO);

      addLog(tokenId, "info", `Đang đăng ký quest ${questName} (${isAndroid ? 'Mobile' : 'Desktop'})...`);
      const state = getGlobalState().get(tokenId);
      if (!state) return;
      const res = await enrollQuest(state.token, questId, isAndroid, tokenId, quest);
      if (res.ok || res.status === 204) {
        addLog(tokenId, "success", `Đã đăng ký quest ${questName}`);
        // Update quest user_status from enrollment response
        try {
          const enrollData = await res.json().catch(() => null);
          if (enrollData?.user_status) {
            quest.user_status = enrollData.user_status;
          }
        } catch { /* ignore */ }
        await sleep(2000);
      } else {
        const text = await res.text().catch(() => "");
        addLog(tokenId, "error", `Đăng ký quest ${questName} thất bại: ${res.status} ${text.slice(0, 100)}`);
        return;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog(tokenId, "error", `Lỗi đăng ký quest ${questName}: ${msg}`);
      return;
    }
  }

  const state = getGlobalState().get(tokenId);
  if (!state) return;

  const abortCtrl = new AbortController();
  state.abortControllers.set(questId, abortCtrl);

  try {
    switch (questType) {
      case "WATCH_VIDEO":
      case "WATCH_VIDEO_ON_MOBILE":
        await doWatchVideoQuest(tokenId, quest);
        break;
      case "PLAY_ON_DESKTOP":
      case "PLAY_ON_XBOX":
      case "PLAY_ON_PLAYSTATION":
        await doPlayOnDesktopQuest(tokenId, quest);
        break;
      case "PLAY_ACTIVITY":
        await doPlayActivityQuest(tokenId, quest);
        break;
      case "STREAM_ON_DESKTOP":
        // aiko: STREAM_ON_DESKTOP no longer works in Node
        addLog(tokenId, "warn", `Quest Stream ${questName} không hoạt động trên Node.js, bỏ qua`);
        break;
      case "ACHIEVEMENT_IN_ACTIVITY":
        await doAchievementInActivityQuest(tokenId, quest);
        break;
      default:
        addLog(tokenId, "warn", `Loại quest không xác định: ${questType} - bỏ qua`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    addLog(tokenId, "error", `Lỗi xử lý quest ${questName}: ${msg}`);
    updateQuestProgress(tokenId, questId, 0, "failed");
  }
}

// ──────────────────────────────────────────────────
// Process all quests for a token
// aiko: ALL quests run in parallel (Promise.allSettled)
// ──────────────────────────────────────────────────

async function processAllQuests(tokenId: string, skipAutoClaim: boolean = false, multiQuest: boolean = false): Promise<void> {
  const state = getGlobalState().get(tokenId);
  if (!state) return;

  state.status = "running";
  addLog(tokenId, "info", "Bắt đầu xử lý tất cả quest...");

  try {
    // Connect to Discord Gateway first (required for heartbeat/video-progress APIs)
    addLog(tokenId, "info", "Đang kết nối Discord Gateway...");
    const gatewayOk = await connectGateway(tokenId, state.token);
    if (!gatewayOk) {
      addLog(tokenId, "warn", "Không kết nối được Gateway, tiếp tục không có gateway session...");
    } else {
      addLog(tokenId, "success", "Đã kết nối Discord Gateway!");
    }

    addLog(tokenId, "info", "Đang tải danh sách quest...");
    const { quests } = await fetchDiscordQuests(state.token, tokenId);

    // aiko: filterQuestsValidToDo - only not completed and not expired
    const doableQuests = quests.filter((q: Record<string, unknown>) => {
      if (isQuestCompleted(q)) return false;
      if (isQuestExpired(q)) return false;
      return true;
    });

    addLog(tokenId, "info", `Tìm thấy ${quests.length} quest, ${doableQuests.length} quest cần làm`);

    if (multiQuest) {
      // ─── MULTI MODE: Parallel (như ban đầu) ───
      // Tất cả quest chạy song song cùng lúc
      addLog(tokenId, "info", `Đang làm ${doableQuests.length} quest (song song - multi mode)...`);
      await Promise.allSettled(
        doableQuests.map((quest: Record<string, unknown>) => processQuest(tokenId, quest))
      );
    } else {
      // ─── SINGLE MODE: Sequential (an toàn hơn) ───
      // Làm từng quest cho đến khi hết, delay 8-15s giữa mỗi quest
      addLog(tokenId, "info", `Đang làm ${doableQuests.length} quest (lần lượt - single mode)...`);
      for (let i = 0; i < doableQuests.length; i++) {
        const quest = doableQuests[i];
        const questName = (quest as Record<string, unknown>)?.name as string || `quest ${i + 1}`;
        addLog(tokenId, "info", `[${i + 1}/${doableQuests.length}] Đang làm quest: ${questName}`);
        await processQuest(tokenId, quest);
        // Random delay 8-15s giữa mỗi quest (trừ quest cuối)
        if (i < doableQuests.length - 1) {
          const delay = Math.floor(Math.random() * 7000) + 8000; // 8000-15000ms
          addLog(tokenId, "info", `Nghỉ ${(delay / 1000).toFixed(1)}s trước khi làm quest tiếp theo...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }

    // Manual start path (skipAutoClaim=false) runs the optional post-completion
    // reward claiming. The auto-quest loop passes skipAutoClaim=true.
    if (!skipAutoClaim) {
      const autoClaimEnabled = state.isVerified;
      if (autoClaimEnabled) {
        addLog(tokenId, "info", "Đang tự động nhận thưởng các quest đã hoàn thành...");
        const { claimQuestReward } = await import("./discord");
        // Re-fetch quests to get latest status
        try {
          const { quests: latestQuests } = await fetchDiscordQuests(state.token, tokenId);
          for (const q of latestQuests) {
            const userStatus = q.user_status as Record<string, unknown> | undefined;
            const isCompleted = userStatus?.completed_at != null;
            const isClaimed = userStatus?.claimed_at != null;
            if (isCompleted && !isClaimed) {
              try {
                const res = await claimQuestReward(state.token, q.id as string, q as Record<string, unknown>, tokenId);
                if (res.ok) {
                  addLog(tokenId, "success", `Đã tự động nhận thưởng quest ${(q.config as Record<string, unknown>)?.messages && ((q.config as Record<string, unknown>).messages as Record<string, string>)?.quest_name || (q.id as string).slice(0, 8)}`);
                } else {
                  addLog(tokenId, "warn", `Tự nhận thưởng thất bại cho quest ${(q.id as string).slice(0, 8)}: ${res.status}`);
                }
              } catch {
                // Ignore claim errors
              }
            }
          }
        } catch {
          addLog(tokenId, "warn", "Không thể tải lại danh sách quest để tự nhận thưởng");
        }
      }
    } else {
      addLog(tokenId, "info", "Đã xử lý xong quest.");
    }

    // Disconnect gateway after all quests done
    disconnectGateway(tokenId);

    if (state.status === "running") {
      state.status = "idle";
      addLog(tokenId, "success", "Đã xử lý xong tất cả quest!");
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    state.status = "error";
    addLog(tokenId, "error", `Lỗi: ${msg}`);
  }
}

// ──────────────────────────────────────────────────
// AUTO-QUEST LOOP
// Separate from manual start/stop. When enabled:
//   1. Ticks every AUTO_LOOP_INTERVAL_MS
//   2. Each tick fetches quests from Discord and processes any that are
//      not-completed AND not-expired (skips already-running ones to avoid
//      duplicate work, but DOES pick up quests that finished since last tick)
//   3. Self-stops when no quests remain OR when worker is manually stopped
// ──────────────────────────────────────────────────

function stopAutoQuestLoop(tokenId: string): void {
  const state = getGlobalState().get(tokenId);
  if (!state) return;
  if (state.autoQuestLoopTimer) {
    clearTimeout(state.autoQuestLoopTimer);
    state.autoQuestLoopTimer = undefined;
  }
  state.autoQuestLoopRunning = false;
}

async function runAutoQuestLoopTick(tokenId: string): Promise<void> {
  const state = getGlobalState().get(tokenId);
  if (!state) return;
  if (!state.autoQuestEnabled) return;
  if (state.autoQuestLoopRunning) return; // skip overlap

  state.autoQuestLoopRunning = true;
  try {
    // Don't kick off a new batch if there's already one running
    if (state.status !== "running") {
      addLog(tokenId, "info", "[Auto-Quest] Đang kiểm tra quest chưa hoàn thành...");
      const { quests } = await fetchDiscordQuests(state.token, tokenId);

      const doableQuests = quests.filter((q: Record<string, unknown>) => {
        if (isQuestCompleted(q)) return false;
        if (isQuestExpired(q)) return false;
        return true;
      });

      if (doableQuests.length === 0) {
        addLog(tokenId, "info", "[Auto-Quest] Không có quest nào cần làm, chờ tick tiếp theo.");
      } else {
        addLog(tokenId, "info", `[Auto-Quest] Phát hiện ${doableQuests.length} quest chưa làm, đang xử lý...`);
        // processAllQuests(tokenId, true) → skipAutoClaim=true: only completes quests.
        await processAllQuests(tokenId, true).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          addLog(tokenId, "error", `[Auto-Quest] Lỗi xử lý: ${msg}`);
        });
        // ─── Cooldown sau khi làm quest xong ───
        // Nghỉ 2 phút sau khi làm quest xong trước khi tick tiếp theo
        // Tránh Discord flag spam do API calls dồn dập
        addLog(tokenId, "info", "[Auto-Quest] Nghỉ 2 phút trước khi kiểm tra lại...");
        await new Promise(resolve => setTimeout(resolve, 2 * 60 * 1000));
      }
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    addLog(tokenId, "error", `[Auto-Quest] Lỗi tick: ${msg}`);
  } finally {
    state.autoQuestLoopRunning = false;
    // Schedule next tick — only if still enabled
    if (state.autoQuestEnabled) {
      state.autoQuestLoopTimer = setTimeout(() => {
        runAutoQuestLoopTick(tokenId).catch(() => { /* swallow */ });
      }, AUTO_LOOP_INTERVAL_MS);
    }
  }
}

function startAutoQuestLoop(tokenId: string): void {
  const state = getGlobalState().get(tokenId);
  if (!state) return;
  if (state.autoQuestEnabled && state.autoQuestLoopTimer) return; // already running
  state.autoQuestEnabled = true;
  addLog(tokenId, "success", "[Auto-Quest] Đã bật tự động làm quest.");
  // Kick off first tick immediately
  runAutoQuestLoopTick(tokenId).catch(() => { /* swallow */ });
}

// ──────────────────────────────────────────────────
// Public API
// ──────────────────────────────────────────────────

export const QuestWorker = {
  registerToken(tokenId: string, token: string, isVerified: boolean = false, _autoClaim: boolean = true): void {
    const state = getGlobalState();
    if (state.has(tokenId)) {
      const existing = state.get(tokenId)!;
      existing.token = token;
      existing.isVerified = isVerified;
      return;
    }
    state.set(tokenId, {
      token,
      status: "idle",
      isVerified,
      questProgress: new Map(),
      logs: [],
      intervals: [],
      abortControllers: new Map(),
      apiQueue: [],
      queueProcessing: false,
      autoQuestEnabled: false,
    });
  },

  async removeToken(tokenId: string): Promise<void> {
    stopAutoQuestLoop(tokenId);
    clearAllIntervals(tokenId);
    releaseAllForToken(tokenId);
    await clearFingerprint(tokenId);
    getGlobalState().delete(tokenId);
  },

  startQuests(tokenId: string, questId?: string, multiQuest: boolean = false): { started: boolean; message: string } {
    const state = getGlobalState().get(tokenId);
    if (!state) {
      return { started: false, message: "Token chưa đăng ký" };
    }
    if (state.status === "running") {
      return { started: false, message: "Quest đang chạy" };
    }

    // Ensure build version is loaded
    initBuildVersion().catch(() => {});

    // Connect to Discord Gateway first (required for heartbeat/video-progress APIs)
    const gatewayConnect = connectGateway(tokenId, state.token).then((ok) => {
      if (ok) {
        addLog(tokenId, "success", "Đã kết nối Discord Gateway!");
      } else {
        addLog(tokenId, "warn", "Không kết nối được Gateway, tiếp tục không có gateway session...");
      }
    });

    if (questId) {
      addLog(tokenId, "info", `Bắt đầu xử lý quest ${questId}...`);
      (async () => {
        try {
          await gatewayConnect;
          const { quests } = await fetchDiscordQuests(state.token, tokenId);
          const quest = quests.find((q: Record<string, unknown>) => q.id === questId);
          if (!quest) {
            addLog(tokenId, "error", `Không tìm thấy quest ${questId}`);
            return;
          }
          state.status = "running";
          await processQuest(tokenId, quest);

          // Auto-claim if verified and completed
          if (state.isVerified) {
            const userStatus = quest.user_status as Record<string, unknown> | undefined;
            if (userStatus?.completed_at && !userStatus?.claimed_at) {
              try {
                const { claimQuestReward } = await import("./discord");
                const claimRes = await claimQuestReward(state.token, questId, quest as Record<string, unknown>, tokenId);
                if (claimRes.ok) {
                  addLog(tokenId, "success", `Đã tự động nhận thưởng quest ${questId}`);
                }
              } catch { /* ignore */ }
            }
          }

          disconnectGateway(tokenId);
          if (state.status === "running") state.status = "idle";
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          state.status = "error";
          addLog(tokenId, "error", `Lỗi: ${msg}`);
        }
      })();
    } else {
      // multiQuest = true → parallel (tất cả cùng lúc — như ban đầu)
      // multiQuest = false → sequential (từng quest cho đến khi hết — an toàn hơn)
      processAllQuests(tokenId, false, multiQuest);
    }

    return { started: true, message: multiQuest ? "Đã bắt đầu xử lý tất cả quest (song song)" : "Đã bắt đầu xử lý từng quest (tuần tự)" };
  },

  stopQuests(tokenId: string, questId?: string): { stopped: boolean; message: string } {
    const state = getGlobalState().get(tokenId);
    if (!state) {
      return { stopped: false, message: "Token chưa đăng ký" };
    }

    if (questId) {
      const ctrl = state.abortControllers.get(questId);
      if (ctrl) ctrl.abort();
      const progress = state.questProgress.get(questId);
      if (progress) progress.status = "paused";
      addLog(tokenId, "info", `Đã dừng quest ${questId}`);
      return { stopped: true, message: `Đã dừng quest ${questId}` };
    }

    clearAllIntervals(tokenId);
    state.status = "idle";
    for (const [, progress] of state.questProgress) {
      if (progress.status === "running") progress.status = "paused";
    }
    addLog(tokenId, "info", "Đã dừng tất cả quest");
    return { stopped: true, message: "Đã dừng tất cả quest" };
  },

  async enroll(tokenId: string, questId: string, isMobile: boolean = false): Promise<{ enrolled: boolean; message: string }> {
    const state = getGlobalState().get(tokenId);
    if (!state) return { enrolled: false, message: "Token chưa đăng ký" };

    try {
      const res = await enrollQuest(state.token, questId, isMobile, tokenId);
      if (res.ok || res.status === 204) {
        addLog(tokenId, "success", `Đã đăng ký quest ${questId}`);
        return { enrolled: true, message: "Đã đăng ký" };
      }
      const text = await res.text().catch(() => "");
      return { enrolled: false, message: `Lỗi: ${res.status} ${text.slice(0, 100)}` };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { enrolled: false, message: msg };
    }
  },

  getState(tokenId: string): TokenState | undefined {
    return getGlobalState().get(tokenId);
  },

  getQuestProgress(tokenId: string, questId: string): QuestProgress | undefined {
    return getGlobalState().get(tokenId)?.questProgress.get(questId);
  },

  getAllQuestProgress(tokenId: string): Map<string, QuestProgress> {
    return getGlobalState().get(tokenId)?.questProgress || new Map();
  },

  getLogs(tokenId: string): Array<{ level: string; message: string; timestamp: number }> {
    return getGlobalState().get(tokenId)?.logs || [];
  },

  getStatus(tokenId: string): "idle" | "running" | "error" | "unknown" {
    return getGlobalState().get(tokenId)?.status || "unknown";
  },

  setAutoClaim(tokenId: string, enabled: boolean): { success: boolean; message: string } {
    const state = getGlobalState().get(tokenId);
    if (!state) return { success: false, message: "Token chưa đăng ký" };
    if (enabled && !state.isVerified) {
      return { success: false, message: "Tài khoản chưa xác minh không thể bật auto-claim" };
    }
    return { success: true, message: enabled ? "Auto-claim đã bật" : "Auto-claim đã tắt" };
  },

  getAutoClaim(tokenId: string): boolean {
    const state = getGlobalState().get(tokenId);
    return state?.isVerified ?? false;
  },

  getVerified(tokenId: string): boolean {
    const state = getGlobalState().get(tokenId);
    return state?.isVerified ?? false;
  },

  /**
   * Enable/disable the background auto-quest loop.
   * - enable=true  → register token if needed, start the loop tick
   * - enable=false → stop the loop timer (does NOT abort an in-flight batch)
   * Caller is responsible for guild-membership verification (this method does
   * NOT re-check Discord) — UI must gate the call behind isGuildMember.
   */
  setAutoQuest(tokenId: string, token: string, enabled: boolean, isVerified: boolean): { success: boolean; message: string } {
    // Auto-register the token if missing (so toggling on first time works
    // even without a prior /quests/start call)
    if (!getGlobalState().has(tokenId)) {
      this.registerToken(tokenId, token, isVerified, isVerified);
    }
    const state = getGlobalState().get(tokenId);
    if (!state) return { success: false, message: "Token chưa đăng ký" };

    if (enabled) {
      if (!isVerified) {
        return { success: false, message: "Tài khoản chưa xác minh không thể bật tự động làm quest" };
      }
      startAutoQuestLoop(tokenId);
      return { success: true, message: "Đã bật tự động làm quest" };
    }
    state.autoQuestEnabled = false;
    stopAutoQuestLoop(tokenId);
    addLog(tokenId, "info", "[Auto-Quest] Đã tắt tự động làm quest.");
    return { success: true, message: "Đã tắt tự động làm quest" };
  },

  getAutoQuest(tokenId: string): boolean {
    const state = getGlobalState().get(tokenId);
    return state?.autoQuestEnabled ?? false;
  },

  async claimReward(tokenId: string, questId: string, questData?: Record<string, unknown>): Promise<{ success: boolean; message: string }> {
    const state = getGlobalState().get(tokenId);
    if (!state) return { success: false, message: "Token chưa đăng ký" };

    try {
      const { claimQuestReward } = await import("./discord");
      const res = await claimQuestReward(state.token, questId, questData, tokenId);
      if (res.ok) {
        addLog(tokenId, "success", `Đã nhận thưởng quest ${questId}`);
        return { success: true, message: "Đã nhận thưởng" };
      }
      const text = await res.text().catch(() => "");
      addLog(tokenId, "error", `Nhận thưởng quest ${questId} thất bại: ${res.status}`);
      return { success: false, message: `Lỗi: ${res.status} ${text.slice(0, 100)}` };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: msg };
    }
  },
};
